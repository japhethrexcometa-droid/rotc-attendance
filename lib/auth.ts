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

  // Step 1: Check if the ID number exists at all
  const { data: idRow, error: idError } = await supabase
    .from("users")
    .select("id, id_number, full_name, role, platoon, qr_token, photo_url, password_hash, is_active")
    .eq("id_number", normalizedId)
    .maybeSingle();

  if (idError) {
    console.error("Supabase Login Error:", idError);
    if (isLikelyNetworkError(idError.message)) {
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
    return { success: false, error: `Connection Error: ${idError.message}` };
  }

  // Dev bootstrap fallback
  if (!idRow && normalizedId === "admin" && password === "admin123") {
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

  // Step 2: ID not found at all
  if (!idRow) {
    return { success: false, error: "wrong_id" };
  }

  // Step 3: Account deactivated
  if (idRow.is_active === false) {
    return {
      success: false,
      error: "Your account has been deactivated. Contact your commanding officer.",
    };
  }

  // Step 4: Check password
  const passwordMatches = idRow.password_hash === password_hash;

  if (!passwordMatches) {
    // Compatibility fallback for cadets with default password
    const defaultPassword = `ROTC${normalizedId.slice(-4)}`;
    const canUseFallback = idRow.role === "cadet" && password === defaultPassword;
    if (!canUseFallback) {
      return { success: false, error: "wrong_password" };
    }
  }

  // Step 5: Return null (should not reach here) — kept for safety
  const data = idRow;

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
