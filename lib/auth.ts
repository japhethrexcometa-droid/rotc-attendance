import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { supabase } from "./supabase";

const SESSION_KEY = "rotc_user_session";
const OFFLINE_AUTH_CACHE_KEY = "rotc_offline_auth_cache";

// Web-compatible storage
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
        removeItem: (key: string) => {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(key);
          }
          return Promise.resolve();
        },
      }
    : AsyncStorage;

// Types
export interface UserSession {
  id: string;
  id_number: string;
  full_name: string;
  role: "admin" | "officer" | "cadet";
  platoon: string | null;
  qr_token: string | null;
  photo_url: string | null;
}

export type AuthResult =
  | { success: true; user: UserSession }
  | { success: false; error: string };

type OfflineAuthCache = Record<
  string,
  {
    password_hash: string;
    user: UserSession;
    updated_at: string;
  }
>;

function isLikelyNetworkError(message?: string): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("network") ||
    m.includes("fetch") ||
    m.includes("failed to fetch") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("request failed") ||
    m.includes("typeerror") ||
    m.includes("offline")
  );
}

async function readOfflineAuthCache(): Promise<OfflineAuthCache> {
  try {
    const raw = await storage.getItem(OFFLINE_AUTH_CACHE_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as OfflineAuthCache) ?? {};
  } catch {
    return {};
  }
}

async function writeOfflineAuthCache(cache: OfflineAuthCache): Promise<void> {
  await storage.setItem(OFFLINE_AUTH_CACHE_KEY, JSON.stringify(cache));
}

export async function hashPassword(plain: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, plain);
}

export async function login(
  idNumber: string,
  password: string,
): Promise<AuthResult> {
  const normalizedId = idNumber.trim();
  const password_hash = await hashPassword(password);

  const { data, error } = await supabase
    .from("users")
    .select("id, id_number, full_name, role, platoon, qr_token, photo_url, is_active")
    .eq("id_number", normalizedId)
    .eq("password_hash", password_hash)
    .maybeSingle();

  if (error) {
    console.error("Supabase Login Error:", error);
    if (isLikelyNetworkError(error.message)) {
      const offlineCache = await readOfflineAuthCache();
      const cached = offlineCache[normalizedId];
      if (cached && cached.password_hash === password_hash) {
        await storage.setItem(SESSION_KEY, JSON.stringify(cached.user));
        return { success: true, user: cached.user };
      }
      return {
        success: false,
        error:
          "Offline login unavailable for this account. Login once online to enable offline mode.",
      };
    }
    return { success: false, error: `Connection Error: ${error.message}` };
  }

  // Block deactivated accounts from logging in
  if (data && data.is_active === false) {
    return {
      success: false,
      error:
        "Your account has been deactivated. Contact your commanding officer.",
    };
  }

  if (!data) {
    // Compatibility fallback: older imports may have stored an unusable password hash.
    // Allow cadets to log in with default password format while DB records are repaired.
    const { data: fallbackRow, error: fallbackError } = await supabase
      .from("users")
      .select("id, id_number, full_name, role, platoon, qr_token, photo_url")
      .eq("id_number", normalizedId)
      .maybeSingle();

    if (!fallbackError && fallbackRow) {
      const defaultPassword = `ROTC${normalizedId.slice(-4)}`;
      const canUseFallback =
        fallbackRow.role === "cadet" && password === defaultPassword;

      if (canUseFallback) {
        const fallbackUser: UserSession = {
          id: fallbackRow.id,
          id_number: fallbackRow.id_number,
          full_name: fallbackRow.full_name,
          role: fallbackRow.role,
          platoon: fallbackRow.platoon ?? null,
          qr_token: fallbackRow.qr_token ?? null,
          photo_url: fallbackRow.photo_url ?? null,
        };
        await storage.setItem(SESSION_KEY, JSON.stringify(fallbackUser));
        return { success: true, user: fallbackUser };
      }
    }

    // Dev bootstrap fallback when remote DB has no seeded users yet.
    if (normalizedId === "admin" && password === "admin123") {
      const fallbackAdmin: UserSession = {
        id: "bootstrap-admin",
        id_number: "admin",
        full_name: "S1 Admin",
        role: "admin",
        platoon: null,
        qr_token: null,
        photo_url: null,
      };
      await storage.setItem(SESSION_KEY, JSON.stringify(fallbackAdmin));
      return { success: true, user: fallbackAdmin };
    }
    return { success: false, error: "Account not found." };
  }

  const user: UserSession = {
    id: data.id,
    id_number: data.id_number,
    full_name: data.full_name,
    role: data.role,
    platoon: data.platoon ?? null,
    qr_token: data.qr_token ?? null,
    photo_url: data.photo_url ?? null,
  };

  await storage.setItem(SESSION_KEY, JSON.stringify(user));
  const offlineCache = await readOfflineAuthCache();
  offlineCache[normalizedId] = {
    password_hash,
    user,
    updated_at: new Date().toISOString(),
  };
  await writeOfflineAuthCache(offlineCache);

  return { success: true, user };
}

export async function logout(): Promise<void> {
  await storage.removeItem(SESSION_KEY);
}

export async function getSession(): Promise<UserSession | null> {
  const raw = await storage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.id_number || !parsed?.role) return null;
    return parsed as UserSession;
  } catch {
    return null;
  }
}
