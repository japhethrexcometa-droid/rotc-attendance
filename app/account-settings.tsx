import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  User2,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getSession, hashPassword, type UserSession } from "../lib/auth";
import { supabase } from "../lib/supabase";

// ── Web-compatible storage (mirrors auth.ts) ──────────────────────────────────
const SESSION_KEY = "rotc_user_session";
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

export default function AccountSettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // ID Number change
  const [newIdNumber, setNewIdNumber] = useState("");
  const [idError, setIdError] = useState("");

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwError, setPwError] = useState("");

  useEffect(() => {
    (async () => {
      const s = await getSession();
      if (!s) {
        router.replace("/");
        return;
      }
      setUser(s);
      setNewIdNumber(s.id_number);
    })();
  }, [router]);

  // ── Password strength ──────────────────────────────────────────────────────
  function passwordStrength(pw: string): {
    label: string;
    color: string;
    width: number;
  } {
    if (!pw) return { label: "", color: "#E0E0E0", width: 0 };
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 1) return { label: "Weak", color: "#E53935", width: 25 };
    if (score === 2) return { label: "Fair", color: "#FFA000", width: 50 };
    if (score === 3) return { label: "Good", color: "#43A047", width: 75 };
    return { label: "Strong", color: "#1B5E20", width: 100 };
  }

  // ── Save ID Number ─────────────────────────────────────────────────────────
  async function handleSaveIdNumber() {
    setIdError("");
    setSuccessMsg("");
    const trimmed = newIdNumber.trim();
    if (!trimmed) {
      setIdError("ID Number/Username cannot be empty.");
      return;
    }
    if (trimmed === user?.id_number) {
      setIdError("No change detected — enter a different ID Number.");
      return;
    }

    // Check if the new ID is already taken
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("id_number", trimmed)
      .maybeSingle();

    if (existing) {
      setIdError("That ID Number is already in use. Choose a different one.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("users")
        .update({ id_number: trimmed })
        .eq("id", user!.id);

      if (error) throw error;

      // Update local session cache
      const updated: UserSession = { ...user!, id_number: trimmed };
      await storage.setItem(SESSION_KEY, JSON.stringify(updated));
      setUser(updated);
      setSuccessMsg("ID Number updated successfully.");
    } catch (err: any) {
      setIdError(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Save Password ──────────────────────────────────────────────────────────
  async function handleSavePassword() {
    setPwError("");
    setSuccessMsg("");

    if (!currentPassword) {
      setPwError("Enter your current password to confirm your identity.");
      return;
    }
    if (!newPassword) {
      setPwError("New password cannot be empty.");
      return;
    }
    if (newPassword.length < 6) {
      setPwError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("Passwords do not match. Please re-enter.");
      return;
    }

    setSaving(true);
    try {
      // Verify current password by fetching the stored hash
      const { data: row, error: fetchErr } = await supabase
        .from("users")
        .select("password_hash")
        .eq("id", user!.id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      const currentHash = await hashPassword(currentPassword);
      if (row?.password_hash !== currentHash) {
        // Fallback: cadet default password check
        const defaultPw = `ROTC${user!.id_number.slice(-4)}`;
        if (!(user?.role === "cadet" && currentPassword === defaultPw)) {
          setPwError(
            "Current password is incorrect. Please try again.",
          );
          setSaving(false);
          return;
        }
      }

      const newHash = await hashPassword(newPassword);
      const { error } = await supabase
        .from("users")
        .update({ password_hash: newHash })
        .eq("id", user!.id);

      if (error) throw error;

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccessMsg("Password updated successfully. Use your new password next login.");
    } catch (err: any) {
      setPwError(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#1F3D2B" />
      </View>
    );
  }

  const strength = passwordStrength(newPassword);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <LinearGradient
        colors={["#0F2016", "#1F3D2B", "#2C533A"]}
        style={styles.header}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft color="#FFF" size={22} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>ACCOUNT SETTINGS</Text>
          <Text style={styles.headerSub}>Update your credentials securely</Text>
        </View>
        <View style={styles.rolePill}>
          <ShieldCheck color="#D4A353" size={12} style={{ marginRight: 4 }} />
          <Text style={styles.roleText}>{user.role.toUpperCase()}</Text>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Current identity */}
        <View style={styles.identityCard}>
          <View style={styles.identityIcon}>
            <User2 color="#1F3D2B" size={22} />
          </View>
          <View>
            <Text style={styles.identityName}>{user.full_name}</Text>
            <Text style={styles.identityMeta}>
              Current ID: {user.id_number}
              {user.platoon ? `  •  ${user.platoon}` : ""}
            </Text>
          </View>
        </View>

        {/* Success banner */}
        {!!successMsg && (
          <View style={styles.successBanner}>
            <Check color="#2E7D32" size={16} style={{ marginRight: 6 }} />
            <Text style={styles.successText}>{successMsg}</Text>
          </View>
        )}

        {/* ── Section 1: Change ID Number ─────────────────────────────────── */}
        <Text style={styles.sectionLabel}>CHANGE ID NUMBER / USERNAME</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>New ID Number / Username</Text>
          <TextInput
            style={[styles.input, !!idError && styles.inputError]}
            value={newIdNumber}
            onChangeText={(t) => {
              setNewIdNumber(t);
              setIdError("");
            }}
            placeholder="Enter new ID number"
            placeholderTextColor="#A0B3A6"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!!idError && <Text style={styles.errorText}>{idError}</Text>}

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSaveIdNumber}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>SAVE ID NUMBER</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.fieldHint}>
            ⚠️ Your new ID is what you will use to log in. Remember it before saving.
          </Text>
        </View>

        {/* ── Section 2: Change Password ──────────────────────────────────── */}
        <Text style={styles.sectionLabel}>CHANGE PASSWORD</Text>
        <View style={styles.card}>
          {/* Current password */}
          <Text style={styles.fieldLabel}>Current Password</Text>
          <View style={styles.pwRow}>
            <TextInput
              style={[styles.input, styles.inputFlex, !!pwError && styles.inputError]}
              value={currentPassword}
              onChangeText={(t) => {
                setCurrentPassword(t);
                setPwError("");
              }}
              placeholder="Enter current password"
              placeholderTextColor="#A0B3A6"
              secureTextEntry={!showCurrent}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowCurrent((v) => !v)}
            >
              {showCurrent ? (
                <EyeOff color="#6E7A71" size={18} />
              ) : (
                <Eye color="#6E7A71" size={18} />
              )}
            </TouchableOpacity>
          </View>

          {/* New password */}
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>New Password</Text>
          <View style={styles.pwRow}>
            <TextInput
              style={[styles.input, styles.inputFlex, !!pwError && styles.inputError]}
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                setPwError("");
              }}
              placeholder="Enter new password"
              placeholderTextColor="#A0B3A6"
              secureTextEntry={!showNew}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowNew((v) => !v)}
            >
              {showNew ? (
                <EyeOff color="#6E7A71" size={18} />
              ) : (
                <Eye color="#6E7A71" size={18} />
              )}
            </TouchableOpacity>
          </View>

          {/* Password strength meter */}
          {!!newPassword && (
            <View style={styles.strengthWrap}>
              <View style={styles.strengthBar}>
                <View
                  style={[
                    styles.strengthFill,
                    {
                      width: `${strength.width}%` as any,
                      backgroundColor: strength.color,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.strengthLabel, { color: strength.color }]}>
                {strength.label}
              </Text>
            </View>
          )}

          {/* Confirm password */}
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Confirm New Password</Text>
          <View style={styles.pwRow}>
            <TextInput
              style={[styles.input, styles.inputFlex, !!pwError && styles.inputError]}
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                setPwError("");
              }}
              placeholder="Re-enter new password"
              placeholderTextColor="#A0B3A6"
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowConfirm((v) => !v)}
            >
              {showConfirm ? (
                <EyeOff color="#6E7A71" size={18} />
              ) : (
                <Eye color="#6E7A71" size={18} />
              )}
            </TouchableOpacity>
          </View>

          {!!pwError && <Text style={styles.errorText}>{pwError}</Text>}

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSavePassword}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <View style={styles.saveBtnInner}>
                <KeyRound color="#FFF" size={16} style={{ marginRight: 8 }} />
                <Text style={styles.saveBtnText}>SAVE PASSWORD</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.fieldHint}>
            Use at least 8 characters with uppercase, numbers, and symbols for a strong password.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8F9F7" },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8F9F7",
  },

  // Header
  header: {
    paddingTop: Platform.OS === "ios" ? 16 : 36,
    paddingBottom: 22,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1,
  },
  headerSub: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleText: {
    color: "#D4A353",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  // Body
  body: { flex: 1 },
  bodyContent: { padding: 20, paddingBottom: 60 },

  // Identity card
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#EAECE6",
    gap: 14,
  },
  identityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#E8EDEA",
    alignItems: "center",
    justifyContent: "center",
  },
  identityName: { fontSize: 15, fontWeight: "800", color: "#1F3D2B" },
  identityMeta: { fontSize: 12, color: "#6E7A71", marginTop: 3 },

  // Success banner
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F5E9",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#A5D6A7",
  },
  successText: { color: "#2E7D32", fontWeight: "700", fontSize: 13, flex: 1 },

  // Section label
  sectionLabel: {
    fontSize: 10,
    fontWeight: "900",
    color: "#A0B3A6",
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 6,
  },

  // Cards
  card: {
    backgroundColor: "#FFF",
    borderRadius: 18,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: "#EAECE6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1F3D2B",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#D0D6D1",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1F3D2B",
    backgroundColor: "#F8F9F7",
  },
  inputFlex: { flex: 1 },
  inputError: { borderColor: "#E53935" },
  errorText: {
    color: "#E53935",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
  },
  fieldHint: {
    color: "#8A9A8E",
    fontSize: 11,
    marginTop: 14,
    lineHeight: 17,
  },

  // Password row
  pwRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn: {
    width: 42,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },

  // Strength meter
  strengthWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 10,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    backgroundColor: "#E0E0E0",
    borderRadius: 2,
    overflow: "hidden",
  },
  strengthFill: { height: "100%", borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontWeight: "800", minWidth: 40 },

  // Save button
  saveBtn: {
    backgroundColor: "#1F3D2B",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnInner: { flexDirection: "row", alignItems: "center" },
  saveBtnText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
