import { Alert, Platform } from "react-native";

const FIELD_MODE_KEY = "rotc_field_mode_strict";

let strictFieldMode = false;
/** null = not yet known */
let online: boolean | null = null;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeFieldMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Web-safe storage ────────────────────────────────────────────────────────
const storage =
  Platform.OS === "web"
    ? {
        getItem: (key: string) =>
          Promise.resolve(
            typeof window !== "undefined"
              ? window.localStorage.getItem(key)
              : null,
          ),
        setItem: (key: string, value: string) => {
          if (typeof window !== "undefined")
            window.localStorage.setItem(key, value);
          return Promise.resolve();
        },
      }
    : {
        getItem: async (key: string) => {
          const AsyncStorage = await import(
            "@react-native-async-storage/async-storage"
          ).then((m) => m.default);
          return AsyncStorage.getItem(key);
        },
        setItem: async (key: string, value: string) => {
          const AsyncStorage = await import(
            "@react-native-async-storage/async-storage"
          ).then((m) => m.default);
          return AsyncStorage.setItem(key, value);
        },
      };

export async function loadFieldModePreference(): Promise<boolean> {
  try {
    const v = await storage.getItem(FIELD_MODE_KEY);
    strictFieldMode = v === "1" || v === "true";
  } catch {
    strictFieldMode = false;
  }
  return strictFieldMode;
}

export async function setFieldModeStrict(enabled: boolean): Promise<void> {
  strictFieldMode = enabled;
  await storage.setItem(FIELD_MODE_KEY, enabled ? "1" : "0");
  emit();
}

export function isFieldModeStrictSync(): boolean {
  return strictFieldMode;
}

export function isOnlineSync(): boolean | null {
  return online;
}

/**
 * When true, avoid alarming Supabase/network error popups (field / offline).
 */
export function shouldSilenceRemoteFailureAlerts(): boolean {
  if (strictFieldMode) return true;
  if (online === false) return true;
  return false;
}

function applyNetState(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}) {
  if (Platform.OS === "web") {
    online = state.isConnected !== false;
    return;
  }
  const connected = state.isConnected === true;
  const reachable = state.isInternetReachable;
  if (!connected) {
    online = false;
    return;
  }
  if (reachable === false) {
    online = false;
    return;
  }
  if (reachable === true || reachable === null) {
    online = true;
  }
}

/**
 * Call once from root layout. Subscribes to connectivity updates.
 * Works on both native (NetInfo) and web (navigator.onLine + events).
 */
export function startFieldModeConnectivity(): () => void {
  void loadFieldModePreference();

  let nativeUnsub: (() => void) | null = null;
  let webCleanup: (() => void) | null = null;

  // 1. Try native NetInfo (lazily imported to avoid web crashes)
  import("@react-native-community/netinfo")
    .then((NetInfo) => {
      nativeUnsub = NetInfo.default.addEventListener((state) => {
        applyNetState(state);
        emit();
      });

      void NetInfo.default.fetch().then((state) => {
        applyNetState(state);
        emit();
      });
    })
    .catch(() => {
      // NetInfo not available — web fallback handles it
    });

  // 2. Web fallback: browser online/offline events
  if (Platform.OS === "web" && typeof window !== "undefined") {
    // Set initial state immediately
    online = navigator.onLine;
    emit();

    const handleOnline = () => {
      online = true;
      emit();
    };
    const handleOffline = () => {
      online = false;
      emit();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Poll every 10s as a safety net for connectivity state
    const pollId = setInterval(() => {
      const prev = online;
      online = navigator.onLine;
      if (prev !== online) emit();
    }, 10000);

    webCleanup = () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(pollId);
    };
  }

  return () => {
    if (nativeUnsub) nativeUnsub();
    if (webCleanup) webCleanup();
  };
}

export function isLikelyNetworkErrorMessage(message?: string): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("network") ||
    m.includes("fetch") ||
    m.includes("failed to fetch") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("request failed") ||
    m.includes("typeerror") ||
    m.includes("offline") ||
    m.includes("internet") ||
    m.includes("connection")
  );
}

/**
 * Use for Supabase / network failures. In field mode or offline, logs only — no scary alert.
 */
export function alertRemoteFailure(
  title: string,
  technical?: string,
  softBody = "No internet or server unavailable. Try again when you have signal.",
): void {
  if (shouldSilenceRemoteFailureAlerts()) {
    console.warn(`[field-mode suppressed] ${title}`, technical ?? "");
    return;
  }
  Alert.alert(title, technical || softBody);
}
