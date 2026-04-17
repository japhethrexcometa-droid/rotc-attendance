// Temporary mock auth service for testing
import { Platform } from "react-native";

const SESSION_KEY = "rotc_user_session";

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    : require("@react-native-async-storage/async-storage").default;

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

export async function hashPassword(plain: string): Promise<string> {
  // Mock hash for testing
  return "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
}

export async function login(
  idNumber: string,
  password: string,
): Promise<AuthResult> {
  console.log("Mock login attempt:", { idNumber, password });

  // Mock successful login for admin
  if (idNumber === "admin" && password === "admin123") {
    const user: UserSession = {
      id: "mock-admin-id",
      id_number: "admin",
      full_name: "S1 Admin",
      role: "admin",
      platoon: null,
      qr_token: "mock-qr-token",
      photo_url: null,
    };

    await storage.setItem(SESSION_KEY, JSON.stringify(user));
    console.log("Mock login successful");
    return { success: true, user };
  }

  console.log("Mock login failed");
  return { success: false, error: "Invalid credentials. Please try again." };
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
