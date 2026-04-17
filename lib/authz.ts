import { Alert } from "react-native";
import type { Href } from "expo-router";
import { getSession, logout, type UserSession } from "./auth";
import { supabase } from "./supabase";

type AppRole = UserSession["role"];

export function routeForRole(role: AppRole): "/admin-simple" | "/officer" | "/cadet" {
  if (role === "admin") return "/admin-simple";
  if (role === "officer") return "/officer";
  return "/cadet";
}

export async function requireRole(
  router: { replace: (href: Href) => void },
  allowedRoles: AppRole[],
  restrictedMessage?: string,
): Promise<UserSession | null> {
  const user = await getSession();
  if (!user) {
    router.replace("/");
    return null;
  }

  if (!allowedRoles.includes(user.role)) {
    if (restrictedMessage) {
      Alert.alert("Restricted", restrictedMessage);
    }
    router.replace(routeForRole(user.role));
    return null;
  }

  // Re-verify is_active from the database to catch deactivated accounts
  try {
    const { data } = await supabase
      .from("users")
      .select("is_active")
      .eq("id", user.id)
      .single();

    if (data && data.is_active === false) {
      Alert.alert(
        "Account Deactivated",
        "Your account has been deactivated. Contact your commanding officer.",
      );
      await logout();
      router.replace("/");
      return null;
    }
  } catch {
    // If network fails, allow through (field mode compatibility)
  }

  return user;
}
