import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { isLikelyNetworkErrorMessage } from "./field-mode";
import { supabase } from "./supabase";

export interface Session {
  id: string;
  session_date: string; // YYYY-MM-DD
  session_type: "AM" | "PM";
  start_time: string; // HH:MM
  late_time: string; // HH:MM
  cutoff_time: string; // HH:MM
  status: "OPEN" | "CLOSED";
  created_by: string | null;
}

const SCANNABLE_SESSION_CACHE_KEY = "rotc_scannable_session_cache";
const TODAY_SESSIONS_CACHE_PREFIX = "rotc_today_sessions_";
const PENDING_SESSION_MUTATIONS_KEY = "rotc_pending_session_mutations";

type PendingSessionMutation =
  | {
      id: string;
      type: "upsert";
      sessionId?: string;
      payload: {
        session_date: string;
        session_type: "AM" | "PM";
        status: "OPEN" | "CLOSED";
        start_time: string;
        late_time: string;
        cutoff_time: string;
      };
    }
  | {
      id: string;
      type: "close";
      sessionId: string;
    };

const storage =
  Platform.OS === "web"
    ? {
        getItem: (key: string) => {
          if (typeof window !== "undefined") {
            return Promise.resolve(window.localStorage.getItem(key));
          }
          return Promise.resolve(null);
        },
        setItem: (key: string, value: string) => {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(key, value);
          }
          return Promise.resolve();
        },
      }
    : AsyncStorage;

export interface CreateSessionParams {
  session_date: string;
  session_type: "AM" | "PM";
  start_time: string;
  late_time: string;
  cutoff_time: string;
  created_by?: string;
}

export type SessionResult =
  | { success: true; session: Session }
  | { success: false; error: string };

export async function createSession(
  params: CreateSessionParams,
): Promise<SessionResult> {
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      session_date: params.session_date,
      session_type: params.session_type,
      start_time: params.start_time,
      late_time: params.late_time,
      cutoff_time: params.cutoff_time,
      created_by: params.created_by ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        error: "A session for this date and type already exists.",
      };
    }
    return { success: false, error: error.message };
  }

  return { success: true, session: data as Session };
}

export async function getOpenSession(
  date: string,
  type: "AM" | "PM",
): Promise<Session | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("session_date", date)
    .eq("session_type", type)
    .eq("status", "OPEN")
    .single();

  if (error || !data) return null;
  return data as Session;
}

export async function getTodaySessions(): Promise<Session[]> {
  const today = todayLocalDate();

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("session_date", today);

  if (error || !data) {
    return getCachedTodaySessions(today);
  }
  const sessions = data as Session[];
  await cacheTodaySessions(today, sessions);
  return sessions;
}

export async function closeSession(
  sessionId: string,
): Promise<{ success: boolean; absentsMarked: number; error?: string }> {
  const { error } = await supabase
    .from("sessions")
    .update({ status: "CLOSED" })
    .eq("id", sessionId);

  if (error) {
    if (isLikelyNetworkError(error.message)) {
      const pending = await readPendingSessionMutations();
      pending.push({ id: `close_${sessionId}_${Date.now()}`, type: "close", sessionId });
      await writePendingSessionMutations(pending);
      return { success: true, absentsMarked: 0 };
    }
    return { success: false, absentsMarked: 0, error: error.message };
  }

  const absentsMarked = await autoMarkAbsents(sessionId);
  return { success: true, absentsMarked };
}

function toMinutes(hhmm: string): number {
  const parts = hhmm.split(":");
  const hour = Number(parts[0] ?? 0);
  const minute = Number(parts[1] ?? 0);
  return hour * 60 + minute;
}

function todayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function getCachedScannableSession(): Promise<Session | null> {
  try {
    const raw = await storage.getItem(SCANNABLE_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.id || !parsed?.session_date) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function setCachedScannableSession(session: Session | null): Promise<void> {
  if (!session) return;
  await storage.setItem(SCANNABLE_SESSION_CACHE_KEY, JSON.stringify(session));
}

async function clearCachedScannableSession(): Promise<void> {
  await storage.setItem(SCANNABLE_SESSION_CACHE_KEY, "");
}

function getTodaySessionsCacheKey(date: string): string {
  return `${TODAY_SESSIONS_CACHE_PREFIX}${date}`;
}

async function cacheTodaySessions(date: string, sessions: Session[]): Promise<void> {
  await storage.setItem(getTodaySessionsCacheKey(date), JSON.stringify(sessions));
}

async function getCachedTodaySessions(date: string): Promise<Session[]> {
  try {
    const raw = await storage.getItem(getTodaySessionsCacheKey(date));
    if (!raw) return [];
    return (JSON.parse(raw) as Session[]) ?? [];
  } catch {
    return [];
  }
}

async function readPendingSessionMutations(): Promise<PendingSessionMutation[]> {
  try {
    const raw = await storage.getItem(PENDING_SESSION_MUTATIONS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as PendingSessionMutation[]) ?? [];
  } catch {
    return [];
  }
}

async function writePendingSessionMutations(
  list: PendingSessionMutation[],
): Promise<void> {
  await storage.setItem(PENDING_SESSION_MUTATIONS_KEY, JSON.stringify(list));
}

function isLikelyNetworkError(message?: string): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("network") ||
    m.includes("fetch") ||
    m.includes("failed to fetch") ||
    m.includes("timed out")
  );
}

export async function enforceSessionCutoff(
  session: Session,
): Promise<{ session: Session | null; autoClosed: boolean }> {
  if (session.status !== "OPEN") {
    return { session, autoClosed: false };
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const cutoffMinutes = toMinutes(session.cutoff_time);

  if (nowMinutes < cutoffMinutes) {
    return { session, autoClosed: false };
  }

  const result = await closeSession(session.id);
  if (!result.success) {
    return { session, autoClosed: false };
  }

  return { session: null, autoClosed: true };
}

export async function getCurrentScannableSession(): Promise<Session | null> {
  const today = todayLocalDate();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("session_date", today)
    .eq("status", "OPEN")
    .order("session_type", { ascending: true });

  // Network error → fall back to cache (offline mode)
  if (error && isLikelyNetworkErrorMessage(error.message)) {
    const cached = await getCachedScannableSession();
    if (!cached || cached.session_date !== today || cached.status !== "OPEN") return null;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const cutoffMinutes = toMinutes(cached.cutoff_time);
    if (nowMinutes >= cutoffMinutes) return null;
    return cached;
  }

  // Successful query but no open sessions → clear cache and return null
  if (!data || data.length === 0) {
    await clearCachedScannableSession();
    return null;
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // 1. Filter out sessions that are already past their cutoff
  const activeSessions = (data as Session[]).filter(
    (row) => nowMinutes < toMinutes(row.cutoff_time)
  );

  // 2. Perform cleanup for sessions that are past cutoff
  for (const row of (data as Session[])) {
    if (nowMinutes >= toMinutes(row.cutoff_time)) {
      await enforceSessionCutoff(row);
    }
  }

  // 3. If no sessions are valid, return null
  if (activeSessions.length === 0) {
    await clearCachedScannableSession();
    return null;
  }

  // 4. Sort valid sessions by which one is "most relevant" to current time
  const orderedSessions = [...activeSessions].sort((a, b) => {
    // Session is considered "started" if we are within 45 mins of start_time
    const aStarted = nowMinutes >= toMinutes(a.start_time) - 45;
    const bStarted = nowMinutes >= toMinutes(b.start_time) - 45;

    if (aStarted && !bStarted) return -1;
    if (!aStarted && bStarted) return 1;

    // Fallback: Use 12:00 PM threshold
    const preferredType: "AM" | "PM" = now.getHours() < 12 ? "AM" : "PM";
    if (a.session_type === preferredType && b.session_type !== preferredType) return -1;
    if (b.session_type === preferredType && a.session_type !== preferredType) return 1;

    return 0;
  });

  const selectedSession = orderedSessions[0];
  await setCachedScannableSession(selectedSession);
  return selectedSession;
}

export async function autoCloseExpiredSessions(
  date = todayLocalDate(),
): Promise<{ closed: number; absentsMarked: number }> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("session_date", date)
    .eq("status", "OPEN");

  if (error || !data || data.length === 0) {
    return { closed: 0, absentsMarked: 0 };
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let closed = 0;
  let absentsMarked = 0;

  for (const session of data as Session[]) {
    const cutoffMinutes = toMinutes(session.cutoff_time);
    if (nowMinutes >= cutoffMinutes) {
      const result = await closeSession(session.id);
      if (result.success) {
        closed += 1;
        absentsMarked += result.absentsMarked;
      }
    }
  }

  return { closed, absentsMarked };
}

export async function upsertSessionWindow(params: {
  sessionId?: string;
  payload: {
    session_date: string;
    session_type: "AM" | "PM";
    status: "OPEN" | "CLOSED";
    start_time: string;
    late_time: string;
    cutoff_time: string;
  };
}): Promise<{ success: boolean; queuedOffline?: boolean; error?: string }> {
  const q = params.sessionId
    ? supabase.from("sessions").update(params.payload).eq("id", params.sessionId)
    : supabase.from("sessions").insert(params.payload);
  const { error } = await q;
  if (!error) {
    await getTodaySessions();
    return { success: true };
  }
  if (!isLikelyNetworkError(error.message)) {
    return { success: false, error: error.message };
  }

  const pending = await readPendingSessionMutations();
  pending.push({
    id: `upsert_${Date.now()}`,
    type: "upsert",
    sessionId: params.sessionId,
    payload: params.payload,
  });
  await writePendingSessionMutations(pending);

  const cached = await getCachedTodaySessions(params.payload.session_date);
  const idx = cached.findIndex((s) => s.session_type === params.payload.session_type);
  const simulated: Session = {
    id: params.sessionId ?? `offline_${params.payload.session_type}_${Date.now()}`,
    session_date: params.payload.session_date,
    session_type: params.payload.session_type,
    start_time: params.payload.start_time,
    late_time: params.payload.late_time,
    cutoff_time: params.payload.cutoff_time,
    status: params.payload.status,
    created_by: null,
  };
  if (idx >= 0) cached[idx] = simulated;
  else cached.push(simulated);
  await cacheTodaySessions(params.payload.session_date, cached);

  return { success: true, queuedOffline: true };
}

export async function syncPendingSessionMutations(): Promise<void> {
  const pending = await readPendingSessionMutations();
  if (pending.length === 0) return;

  const remaining: PendingSessionMutation[] = [];
  for (const op of pending) {
    if (op.type === "upsert") {
      const q = op.sessionId
        ? supabase.from("sessions").update(op.payload).eq("id", op.sessionId)
        : supabase.from("sessions").insert(op.payload);
      const { error } = await q;
      if (error) {
        if (isLikelyNetworkError(error.message)) remaining.push(op);
      }
      continue;
    }

    const { error } = await supabase
      .from("sessions")
      .update({ status: "CLOSED" })
      .eq("id", op.sessionId);
    if (error) {
      if (isLikelyNetworkError(error.message)) remaining.push(op);
      continue;
    }
    await autoMarkAbsents(op.sessionId);
  }

  await writePendingSessionMutations(remaining);
}

export async function autoMarkAbsents(sessionId: string): Promise<number> {
  // Include both cadets and officers so officers also get attendance tracked
  // Filter out soft-deleted and inactive users
  const { data: allUsers, error: usersError } = await supabase
    .from("users")
    .select("id, role, is_active, is_deleted")
    .in("role", ["cadet", "officer"])
    .eq("is_deleted", false);

  if (usersError || !allUsers || allUsers.length === 0) return 0;

  const activeUsers = (allUsers as { id: string; is_active: boolean | null }[])
    .filter((c) => c.is_active !== false);
  if (activeUsers.length === 0) return 0;

  const { data: attended, error: attendedError } = await supabase
    .from("attendance")
    .select("cadet_id")
    .eq("session_id", sessionId);

  if (attendedError) return 0;

  const attendedIds = new Set(
    (attended ?? []).map((r: { cadet_id: string }) => r.cadet_id),
  );
  const absentUsers = activeUsers.filter(
    (c: { id: string }) => !attendedIds.has(c.id),
  );

  if (absentUsers.length === 0) return 0;

  const absentRecords = absentUsers.map((c: { id: string }) => ({
    cadet_id: c.id,
    session_id: sessionId,
    status: "absent",
  }));

  const { error: upsertError } = await supabase
    .from("attendance")
    .upsert(absentRecords, {
      onConflict: "cadet_id,session_id",
      ignoreDuplicates: true,
    });

  if (upsertError) {
    console.warn("autoMarkAbsents upsert failed:", upsertError.message);
    return 0;
  }

  return absentUsers.length;
}
