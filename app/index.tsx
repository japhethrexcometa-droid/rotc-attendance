import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
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

export default function LoginScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  const [fieldStrict, setFieldStrict] = useState(false);

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
      await loadFieldModePreference();
      setFieldStrict(isFieldModeStrictSync());

      const session = await getSession();
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

  const handleLogin = async () => {
    if (!userId || !password) {
      Alert.alert("Error", "Please enter your ID and password");
      return;
    }

    setIsLoading(true);
    const result = await login(userId, password);
    setIsLoading(false);

    if (result.success) {
      router.replace(routeForRole(result.user.role) as any);
    } else {
      const quiet =
        isFieldModeStrictSync() &&
        /offline|network|fetch|timeout|connection/i.test(result.error);
      if (quiet) {
        Alert.alert(
          "Offline",
          "No connection. Use an account that already logged in once on this device, or turn off Field Mode in Settings when you have data.",
        );
      } else {
        Alert.alert("Login Failed", result.error);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <View style={styles.logoCircle}>
            <Image
              source={require("../assets/images/rotc-logo.jpg")}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.logoCircle}>
            <Image
              source={require("../assets/images/batch-logo.png")}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
        </View>
        <Text style={styles.title}>
          Department of Military Science and Tactics
        </Text>
        <Text style={styles.subtitle}>ROTC Attendance System</Text>
      </View>

      <View style={styles.formContainer}>
        <Text style={styles.label}>ID Number / Username</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter ID Number"
          placeholderTextColor="#A0A0A0"
          value={userId}
          onChangeText={setUserId}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter Password"
          placeholderTextColor="#A0A0A0"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          <Text style={styles.loginButtonText}>
            {isLoading ? "Logging in..." : "LOGIN"}
          </Text>
        </TouchableOpacity>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: fieldStrict
                  ? "#1565C0"
                  : dbStatus === "online"
                    ? "#4CAF50"
                    : dbStatus === "offline"
                      ? "#FF9800"
                      : "#FFC107",
              },
            ]}
          />
          <Text style={styles.statusLabelText}>
            SYSTEM STATUS:{" "}
            {fieldStrict
              ? "FIELD MODE (QUIET)"
              : dbStatus === "online"
                ? "READY"
                : dbStatus === "offline"
                  ? "OFFLINE / CACHED OK"
                  : "INITIALIZING..."}
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F7F5", // Light off-white with hint of green
    justifyContent: "center",
    paddingVertical: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 50,
    paddingHorizontal: 20,
  },
  logoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 170,
    marginBottom: 18,
  },
  logoCircle: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#D4DDD6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  logoImage: { width: 56, height: 56 },
  title: {
    fontSize: 21,
    fontWeight: "800",
    color: "#1F3D2B",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#4A5D4E",
    marginTop: 5,
    fontWeight: "600",
  },
  formContainer: {
    paddingHorizontal: 30,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1F3D2B",
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D4DDD6",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 24,
    color: "#333",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  loginButton: {
    backgroundColor: "#1F3D2B", // Military Deep Green
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#1F3D2B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 6,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    opacity: 0.8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusLabelText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#4A5D4E",
    letterSpacing: 1,
  },
});
