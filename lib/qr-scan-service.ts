import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { enqueue, hasPendingScan } from "./offline-sync";
import { enforceSessionCutoff, Session } from "./session-manager";
import { supabase } from "./supabase";
import { getSession } from "./auth";

export type AttendanceStatus = "present" | "late" | "blocked";

export interface CadetInfo {
  id: string;
  full_name: string;
  id_number: string;
  platoon: string | null;
}

const QR_CADET_CACHE_KEY = "rotc_qr_cadet_cache";

type CachedCadet = CadetInfo & { role?: string };
type CadetCacheMap = Record<string, CachedCadet>;

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

async function readCadetCache(): Promise<CadetCacheMap> {
  try {
    const raw = await storage.getItem(QR_CADET_CACHE_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as CadetCacheMap) ?? {};
  } catch {
    return {};
  }
}

async function writeCadetCache(map: CadetCacheMap): Promise<void> {
  await storage.setItem(QR_CADET_CACHE_KEY, JSON.stringify(map));
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

export interface ScanParams {
  qrToken: string;
  session: Session | null;
  scannedBy: string; // user ID of the officer/admin scanning
  scannedByRole: string;
}

export type ScanResult =
  | { outcome: "present" | "late"; cadet: CadetInfo; timestamp: string }
  | { outcome: "duplicate"; cadet: CadetInfo }
  | { outcome: "blocked"; reason: "cutoff_passed" }
  | {
      outcome: "invalid";
      reason: "bad_token" | "self_scan" | "no_open_session" | "cadet_mismatch" | "officer_scanned_officer";
      cadet?: CadetInfo;
    };

type ParsedQr = {
  token: string;
  cadetId?: string;
};

function parseQrPayload(raw: string): ParsedQr {
  const trimmed = raw.trim();
  if (!trimmed) return { token: "" };

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { token?: string; cadet_id?: string };
      if (parsed?.token) {
        return { token: parsed.token.trim(), cadetId: parsed.cadet_id?.trim() };
      }
    } catch {
      // fallback to raw token mode below
    }
  }

  return { token: trimmed };
}

async function logScanAudit(payload: {
  scanned_by: string;
  session_id: string | null;
  cadet_id: string | null;
  outcome: string;
  status: string | null;
  reason: string | null;
  payload_preview: string;
}): Promise<void> {
  const { error } = await supabase.from("scan_audit_logs").insert(payload);
  if (error) {
    // Keep scanning flow uninterrupted if audit logging fails.
    console.warn("scan_audit_logs insert failed:", error.message);
  }
}

export function resolveAttendanceStatus(
  scanTime: Date,
  session: Session,
): AttendanceStatus {
  const toSeconds = (hhmmOrHhmmss: string): number => {
    const parts = hhmmOrHhmmss.split(":");
    const h = Number(parts[0] ?? 0);
    const m = Number(parts[1] ?? 0);
    const s = Number(parts[2] ?? 0);
    return h * 3600 + m * 60 + s;
  };

  const scanSeconds =
    scanTime.getHours() * 3600 + scanTime.getMinutes() * 60 + scanTime.getSeconds();
  const lateSeconds = toSeconds(session.late_time);
  const cutoffSeconds = toSeconds(session.cutoff_time);

  if (scanSeconds >= cutoffSeconds) return "blocked";
  if (scanSeconds >= lateSeconds) return "late";
  return "present";
}

export async function processQRScan(params: ScanParams): Promise<ScanResult> {
  // 1. No open session
  if (params.session === null) {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: null,
      cadet_id: null,
      outcome: "invalid",
      status: null,
      reason: "no_open_session",
      payload_preview: params.qrToken.slice(0, 120),
    });
    return { outcome: "invalid", reason: "no_open_session" };
  }

  const { session: activeSession } = await enforceSessionCutoff(params.session);
  if (!activeSession) {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: params.session.id,
      cadet_id: null,
      outcome: "blocked",
      status: null,
      reason: "cutoff_passed",
      payload_preview: params.qrToken.slice(0, 120),
    });
    return { outcome: "blocked", reason: "cutoff_passed" };
  }

  const parsedQr = parseQrPayload(params.qrToken);

  // 2. Lookup qr_token in users table
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, full_name, id_number, platoon, role")
    .eq("qr_token", parsedQr.token)
    .single();

  let resolvedUser: any = user;

  if ((userError || !user) && isLikelyNetworkError(userError?.message)) {
    const cache = await readCadetCache();
    const cached = cache[parsedQr.token];
    if (cached) {
      resolvedUser = {
        id: cached.id,
        full_name: cached.full_name,
        id_number: cached.id_number,
        platoon: cached.platoon,
        role: cached.role ?? "cadet",
      };
    }
  }

  // 3. Token not found
  if (!resolvedUser) {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: activeSession.id,
      cadet_id: null,
      outcome: "invalid",
      status: null,
      reason: "bad_token",
      payload_preview: params.qrToken.slice(0, 120),
    });
    return { outcome: "invalid", reason: "bad_token" };
  }

  if (parsedQr.cadetId && parsedQr.cadetId !== resolvedUser.id) {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: activeSession.id,
      cadet_id: resolvedUser.id,
      outcome: "invalid",
      status: null,
      reason: "cadet_mismatch",
      payload_preview: params.qrToken.slice(0, 120),
    });
    return { outcome: "invalid", reason: "cadet_mismatch" };
  }

  const cadet: CadetInfo = {
    id: resolvedUser.id,
    full_name: resolvedUser.full_name,
    id_number: resolvedUser.id_number,
    platoon: resolvedUser.platoon ?? null,
  };

  // 4. Self-scan check
  if (resolvedUser.id === params.scannedBy) {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: activeSession.id,
      cadet_id: resolvedUser.id,
      outcome: "invalid",
      status: null,
      reason: "self_scan",
      payload_preview: params.qrToken.slice(0, 120),
    });
    return { outcome: "invalid", reason: "self_scan", cadet };
  }

  // 4b. Officer scanning an officer check
  if (resolvedUser.role === "officer") {
    if (params.scannedByRole !== "admin") {
      await logScanAudit({
        scanned_by: params.scannedBy,
        session_id: activeSession.id,
        cadet_id: resolvedUser.id,
        outcome: "invalid",
        status: null,
        reason: "officer_scanned_officer",
        payload_preview: params.qrToken.slice(0, 120),
      });
      return { outcome: "invalid", reason: "officer_scanned_officer", cadet };
    }
  }

  const cadetCache = await readCadetCache();
  cadetCache[parsedQr.token] = {
    ...cadet,
    role: resolvedUser.role,
  };
  await writeCadetCache(cadetCache);

  // 5. Check for existing attendance record
  const { data: existing } = await supabase
    .from("attendance")
    .select("id")
    .eq("cadet_id", resolvedUser.id)
    .eq("session_id", activeSession.id)
    .single();

  // 6. Duplicate
  if (existing) {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: activeSession.id,
      cadet_id: resolvedUser.id,
      outcome: "duplicate",
      status: null,
      reason: null,
      payload_preview: params.qrToken.slice(0, 120),
    });
    return { outcome: "duplicate", cadet };
  }

  // 6b. Duplicate in offline queue (prevents re-scan while pending sync)
  const pendingDuplicate = await hasPendingScan(
    resolvedUser.id,
    activeSession.id,
  );
  if (pendingDuplicate) {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: activeSession.id,
      cadet_id: resolvedUser.id,
      outcome: "duplicate",
      status: null,
      reason: "pending_duplicate",
      payload_preview: params.qrToken.slice(0, 120),
    });
    return { outcome: "duplicate", cadet };
  }

  // 7. Resolve attendance status
  const status = resolveAttendanceStatus(new Date(), activeSession);

  // 8. Blocked
  if (status === "blocked") {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: activeSession.id,
      cadet_id: resolvedUser.id,
      outcome: "blocked",
      status: null,
      reason: "cutoff_passed",
      payload_preview: params.qrToken.slice(0, 120),
    });
    return { outcome: "blocked", reason: "cutoff_passed" };
  }

  const now = new Date();
  const scanTime = now.toISOString();

  // 9. Try to INSERT attendance
  const { error: insertError } = await supabase.from("attendance").insert({
    cadet_id: resolvedUser.id,
    session_id: activeSession.id,
    status,
    scanned_by: params.scannedBy,
    scan_time: scanTime,
  });

  // 10. If INSERT fails, enqueue for offline sync
  if (insertError) {
    await enqueue({
      localId: `${resolvedUser.id}_${activeSession.id}_${Date.now()}`,
      cadet_id: resolvedUser.id,
      session_id: activeSession.id,
      status,
      scan_time: scanTime,
      scanned_by: params.scannedBy,
      synced: false,
    });
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: activeSession.id,
      cadet_id: resolvedUser.id,
      outcome: "accepted_offline",
      status,
      reason: "queued_for_sync",
      payload_preview: params.qrToken.slice(0, 120),
    });
  } else {
    await logScanAudit({
      scanned_by: params.scannedBy,
      session_id: activeSession.id,
      cadet_id: resolvedUser.id,
      outcome: "accepted",
      status,
      reason: null,
      payload_preview: params.qrToken.slice(0, 120),
    });
  }

  // 11. Return result
  const timestamp = now.toLocaleTimeString("en-GB", { hour12: false });
  return { outcome: status, cadet, timestamp };
}
