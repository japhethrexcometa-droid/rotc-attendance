import { LinearGradient } from "expo-linear-gradient";
import { AlertCircle } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { getSession, login } from "../lib/auth";
import { routeForRole } from "../lib/authz";
import {
  isFieldModeStrictSync,
  loadFieldModePreference,
  subscribeFieldMode,
} from "../lib/field-mode";
import { supabase } from "../lib/supabase";
import WowLoading from "../components/WowLoading";
import PWAInstallPrompt from "../components/PWAInstallPrompt";

export default function LoginScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<"checking" | "online" | "offline">("checking");
  const [fieldStrict, setFieldStrict] = useState(false);
  const [loginError, setLoginError] = useState<{ field: "id" | "password" | "general"; message: string } | null>(null);

  // Entrance animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const logoScale = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    const refreshStrict = async () => {
      await loadFieldModePreference();
      setFieldStrict(isFieldModeStrictSync());
    };
    void refreshStrict();
    return subscribeFieldMode(() => {
      void refreshStrict();
    });
  }, []);

  useEffect(() => {
    (async () => {
      const minLoadTime = new Promise(resolve => setTimeout(resolve, 3500));

      await loadFieldModePreference();
      setFieldStrict(isFieldModeStrictSync());

      const session = await getSession();
      await minLoadTime;

      if (session) {
        router.replace(routeForRole(session.role) as any);
        return;
      }

      if (isFieldModeStrictSync()) {
        setDbStatus("offline");
        return;
      }
      try {
        const { error } = await supabase.from("users").select("id").limit(1);
        setDbStatus(error ? "offline" : "online");
      } catch {
        setDbStatus("offline");
      }
    })();
  }, [router]);

  // Trigger entrance animation once loaded
  useEffect(() => {
    if (dbStatus !== "checking") {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 800,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          speed: 8,
          bounciness: 12,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [dbStatus]);

  const handleLogin = async () => {
    setLoginError(null);
    if (!userId || !password) {
      if (!userId) setLoginError({ field: "id", message: "Please enter your ID number or username." });
      else setLoginError({ field: "password", message: "Please enter your password." });
      return;
    }

    setIsLoading(true);
    const result = await login(userId, password);
    setIsLoading(false);

    if (result.success) {
      router.replace(routeForRole(result.user.role) as any);
    } else {
      if (result.error === "wrong_id") {
        setLoginError({ field: "id", message: "Wrong ID number / Username. Not found in the system." });
      } else if (result.error === "wrong_password") {
        setLoginError({ field: "password", message: "Wrong password. Please try again." });
      } else if (/offline|network|fetch|timeout|connection/i.test(result.error) && isFieldModeStrictSync()) {
        setLoginError({ field: "general", message: "No connection. Use a previously logged-in account or disable Field Mode." });
      } else {
        setLoginError({ field: "general", message: result.error });
      }
    }
  };

  if (dbStatus === "checking") {
    return <WowLoading />;
  }

  return (
    <LinearGradient
      colors={["#0A1A10", "#1F3D2B", "#2C533A"]}
      style={styles.gradientBg}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Logo Area */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: fadeAnim,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <View style={styles.logoRow}>
            <View style={styles.logoCircle}>
              <Image
                source={require("../assets/images/rotc-logo.jpg")}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <View style={styles.logoDivider} />
            <View style={[styles.logoCircle, styles.logoCircleGold]}>
              <Image
                source={require("../assets/images/batch-logo.png")}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
          </View>

          <Text style={styles.unitName}>MSU – Zamboanga Sibugay</Text>
          <Text style={styles.title}>ROTC Attendance System</Text>
          <Text style={styles.subtitle}>Department of Military Science and Tactics</Text>
        </Animated.View>

        {/* Install Prompt (Only shows if on Web and not installed) */}
        <Animated.View style={{ opacity: fadeAnim }}>
          <PWAInstallPrompt />
        </Animated.View>

        {/* Login Card */}
        <Animated.View
          style={[
            styles.card,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <Text style={styles.cardTitle}>OFFICER / CADET LOGIN</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>ID Number / Username</Text>
            <TextInput
              style={[
                styles.input,
                loginError?.field === "id" && styles.inputError,
              ]}
              placeholder="Enter ID Number"
              placeholderTextColor="#A0B3A6"
              value={userId}
              onChangeText={(t) => { setUserId(t); setLoginError(null); }}
              autoCapitalize="none"
            />
            {loginError?.field === "id" && (
              <View style={styles.errorRow}>
                <AlertCircle color="#EF5350" size={13} />
                <Text style={styles.errorText}>{loginError.message}</Text>
              </View>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={[
                styles.input,
                loginError?.field === "password" && styles.inputError,
              ]}
              placeholder="Enter Password"
              placeholderTextColor="#A0B3A6"
              value={password}
              onChangeText={(t) => { setPassword(t); setLoginError(null); }}
              secureTextEntry
            />
            {loginError?.field === "password" && (
              <View style={styles.errorRow}>
                <AlertCircle color="#EF5350" size={13} />
                <Text style={styles.errorText}>{loginError.message}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={["#D4A353", "#B8860B"]}
              style={styles.loginGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.loginButtonText}>
                {isLoading ? "AUTHENTICATING..." : "LOGIN"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {loginError?.field === "general" && (
            <View style={styles.generalErrorBox}>
              <AlertCircle color="#EF5350" size={14} />
              <Text style={styles.generalErrorText}>{loginError.message}</Text>
            </View>
          )}

          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: fieldStrict
                    ? "#1565C0"
                    : dbStatus === "online"
                      ? "#4CAF50"
                      : "#FF9800",
                },
              ]}
            />
            <Text style={styles.statusLabelText}>
              SYSTEM:{" "}
              {fieldStrict
                ? "FIELD MODE"
                : dbStatus === "online"
                  ? "CONNECTED"
                  : "OFFLINE — CACHED OK"}
            </Text>
          </View>
        </Animated.View>

        <Animated.Text style={[styles.footerText, { opacity: fadeAnim }]}>
          MSU–ZS ROTC UNIT • Confidential System
        </Animated.Text>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradientBg: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 30,
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 16,
  },
  logoDivider: {
    width: 1,
    height: 50,
    backgroundColor: "rgba(212,163,83,0.4)",
    marginHorizontal: 4,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.3)",
    shadowColor: "#D4A353",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 10,
    overflow: "hidden",
  },
  logoCircleGold: {
    borderColor: "rgba(212,163,83,0.6)",
    shadowColor: "#D4A353",
  },
  logoImage: { width: 66, height: 66 },
  unitName: {
    color: "#D4A353",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  subtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
    letterSpacing: 0.3,
  },

  card: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  cardTitle: {
    color: "#D4A353",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.5,
    textAlign: "center",
    marginBottom: 22,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(255,255,255,0.7)",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 14,
    padding: 15,
    fontSize: 15,
    color: "#FFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  loginButton: {
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 8,
    marginBottom: 20,
    shadowColor: "#D4A353",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  loginButtonDisabled: { opacity: 0.6 },
  loginGradient: {
    paddingVertical: 17,
    alignItems: "center",
    borderRadius: 14,
  },
  loginButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 2,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 7,
  },
  statusLabelText: {
    fontSize: 10,
    fontWeight: "900",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1,
  },
  footerText: {
    color: "rgba(255,255,255,0.25)",
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 1,
    marginTop: 22,
  },
  inputError: {
    borderColor: "#EF5350",
    borderWidth: 1.5,
    backgroundColor: "rgba(239,83,80,0.08)",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 5,
  },
  errorText: {
    color: "#EF9A9A",
    fontSize: 11,
    fontWeight: "700",
    flex: 1,
  },
  generalErrorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239,83,80,0.1)",
    borderWidth: 1,
    borderColor: "rgba(239,83,80,0.35)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  generalErrorText: {
    color: "#EF9A9A",
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
});
