import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
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

export async function loadFieldModePreference(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(FIELD_MODE_KEY);
    strictFieldMode = v === "1" || v === "true";
  } catch {
    strictFieldMode = false;
  }
  return strictFieldMode;
}

export async function setFieldModeStrict(enabled: boolean): Promise<void> {
  strictFieldMode = enabled;
  await AsyncStorage.setItem(FIELD_MODE_KEY, enabled ? "1" : "0");
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
 */
export function startFieldModeConnectivity(): () => void {
  void loadFieldModePreference();

  const unsub = NetInfo.addEventListener((state) => {
    applyNetState(state);
    emit();
  });

  void NetInfo.fetch().then((state) => {
    applyNetState(state);
    emit();
  });

  return () => {
    unsub();
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
