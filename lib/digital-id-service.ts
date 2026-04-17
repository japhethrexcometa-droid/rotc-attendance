import { supabase } from "./supabase";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";

export interface CadetIDData {
  id: string;
  id_number: string;
  full_name: string;
  role?: "admin" | "officer" | "cadet";
  platoon: string | null;
  year_level: string | null;
  qr_token: string | null;
  photo_url: string | null;
  is_active: boolean;
}

const CONFIGURED_PORTAL_URL =
  process.env.EXPO_PUBLIC_DIGITAL_ID_PORTAL_URL?.trim() ?? "";

function normalizeDigitalIdPath(baseUrl: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return normalized.endsWith("/digital-id")
    ? normalized
    : `${normalized}/digital-id`;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function getWebPortalBaseUrl(): string {
  if (CONFIGURED_PORTAL_URL.length === 0) return "";
  if (!isHttpUrl(CONFIGURED_PORTAL_URL)) return "";
  return normalizeDigitalIdPath(CONFIGURED_PORTAL_URL);
}

function getAppPortalBaseUrl(): string {
  // Works for testing as long as the app is installed on the device.
  return Linking.createURL("/digital-id");
}

const CADET_PUBLIC_SELECT =
  "id, id_number, full_name, role, platoon, year_level, qr_token, photo_url, is_active";

function sanitizeCadetSearchQuery(query: string): string {
  return query.replace(/[%(),]/g, "").trim();
}

export async function listPublicCadets(
  limit = 50,
): Promise<CadetIDData[]> {
  const { data, error } = await supabase
    .from("users")
    .select(CADET_PUBLIC_SELECT)
    .eq("role", "cadet")
    .eq("is_deleted", false)
    .order("full_name", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CadetIDData[];
}

export async function getCadetByIdOrName(
  query: string,
  limit = 50,
): Promise<CadetIDData[]> {
  const safeQuery = sanitizeCadetSearchQuery(query);

  if (!safeQuery) {
    return listPublicCadets(limit);
  }

  const { data, error } = await supabase
    .from("users")
    .select(CADET_PUBLIC_SELECT)
    .eq("role", "cadet")
    .eq("is_deleted", false)
    .or(`full_name.ilike.%${safeQuery}%,id_number.ilike.%${safeQuery}%`)
    .order("full_name", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CadetIDData[];
}

export async function getCadetById(
  cadetId: string,
): Promise<CadetIDData | null> {
  const { data, error } = await supabase
    .from("users")
    .select(CADET_PUBLIC_SELECT)
    .eq("id", cadetId)
    .eq("is_deleted", false)
    .single();

  if (error) return null;
  return data as CadetIDData;
}

export async function ensureCadetQrToken(
  cadetId: string,
  currentToken: string | null,
): Promise<string> {
  if (currentToken && currentToken.trim().length > 0) {
    return currentToken;
  }

  const raw = `${cadetId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const generatedToken = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    raw,
  );

  const { error } = await supabase
    .from("users")
    .update({ qr_token: generatedToken })
    .eq("id", cadetId);

  if (error) throw error;
  return generatedToken;
}

export async function ensureUserQrToken(
  userId: string,
  currentToken: string | null,
): Promise<string> {
  return ensureCadetQrToken(userId, currentToken);
}

export async function uploadPhoto(
  cadetId: string,
  imageUri: string,
): Promise<string> {
  // Use fetch to get a blob from the local URI - this is standard in React Native
  const response = await fetch(imageUri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from("cadet-photos")
    .upload(`${cadetId}.jpg`, blob, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const publicUrl = supabase.storage
    .from("cadet-photos")
    .getPublicUrl(`${cadetId}.jpg`).data.publicUrl;

  const { error: updateError } = await supabase
    .from("users")
    .update({ photo_url: publicUrl })
    .eq("id", cadetId);

  if (updateError) throw updateError;

  return publicUrl;
}

export async function uploadPhotoWithCredentials(
  cadetId: string,
  idNumber: string,
  password: string,
  imageUri: string,
): Promise<string> {
  const response = await fetch(imageUri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from("cadet-photos")
    .upload(`${cadetId}.jpg`, blob, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const publicUrl = supabase.storage
    .from("cadet-photos")
    .getPublicUrl(`${cadetId}.jpg`).data.publicUrl;

  const { data, error } = await supabase.rpc("set_user_photo_by_credentials", {
    p_id_number: idNumber,
    p_password: password,
    p_photo_url: publicUrl,
  });

  if (error) throw error;
  if (data !== true) {
    throw new Error("Verification failed. Please check your ID number and password.");
  }

  return publicUrl;
}

export function getShareableLink(cadetId: string): string {
  const base = getWebPortalBaseUrl() || getAppPortalBaseUrl();
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}id=${encodeURIComponent(cadetId)}`;
}

export function getDigitalIdPortalLink(): string {
  return getWebPortalBaseUrl() || getAppPortalBaseUrl();
}

export function getDigitalIdPortalWebLink(): string {
  return getWebPortalBaseUrl();
}

export function getDigitalIdPortalAppLink(): string {
  return getAppPortalBaseUrl();
}

export function isPortalUsingDeepLinkFallback(): boolean {
  return getWebPortalBaseUrl().length === 0;
}
