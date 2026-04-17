import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { Platform } from "react-native";
import "react-native-url-polyfill/auto";

// Connection strategy:
// - Default to remote Supabase for reliable Expo Go testing.
// - Use local Supabase only when explicitly enabled via env flag.
const USE_LOCAL =
  process.env.EXPO_PUBLIC_USE_LOCAL_SUPABASE === "true" ||
  process.env.EXPO_PUBLIC_USE_LOCAL_SUPABASE === "1";

function getDevHost(): string | null {
  // Expo provides the dev server host through Constants in Expo Go / dev builds.
  // We use it to build LAN-reachable URLs when testing on a physical device.
  const candidates: (string | undefined)[] = [
    Constants.expoConfig?.hostUri,
    // Older SDKs / classic manifests
    (Constants as any).manifest?.debuggerHost,
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost,
  ];

  for (const v of candidates) {
    if (!v) continue;
    const host = String(v).split("://").pop()!.split("/")[0].split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") return host;
  }
  return null;
}

// Local Credentials (from Supabase CLI)
const LOCAL_ANON_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const LOCAL_URL =
  process.env.EXPO_PUBLIC_LOCAL_SUPABASE_URL ||
  (Platform.OS === "web"
    ? "http://127.0.0.1:54321"
    : `http://${getDevHost() ?? "127.0.0.1"}:54321`);

// Remote Credentials
const REMOTE_URL = "https://pfkmqrwpdkxgwdnwfrgk.supabase.co";
const REMOTE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBma21xcndwZGt4Z3dkbndmcmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODkwMjUsImV4cCI6MjA5MTY2NTAyNX0.e2mpHp47t1DRV0CIxxWbh_v2Ty-JbdMmD8ZPFLBhyoE";

const supabaseUrl = USE_LOCAL ? LOCAL_URL : REMOTE_URL;
const supabaseAnonKey = USE_LOCAL ? LOCAL_ANON_KEY : REMOTE_ANON_KEY;

// Use localStorage for web, AsyncStorage for native
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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
