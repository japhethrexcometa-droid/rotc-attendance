import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowLeft, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  isOnlineSync,
  loadFieldModePreference,
  setFieldModeStrict,
  subscribeFieldMode,
} from "../lib/field-mode";
import { getSession } from "../lib/auth";

export default function SettingsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 360;
  const horizontalPad = isCompact ? 14 : 20;
  const cardRadius = isCompact ? 14 : 16;
  const [strict, setStrict] = useState(false);
  const [net, setNet] = useState<boolean | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const session = await getSession();
        if (!session) {
          router.replace("/");
          return;
        }
        setCheckingAuth(false);
      } catch {
        router.replace("/");
      }
    })();
  }, [router]);

  useEffect(() => {
    void loadFieldModePreference().then(setStrict);
    setNet(isOnlineSync());
    const unsub = subscribeFieldMode(() => {
      setNet(isOnlineSync());
      void loadFieldModePreference().then(setStrict);
    });
    return unsub;
  }, []);

  const refreshState = async () => {
    const current = await loadFieldModePreference();
    setStrict(current);
    setNet(isOnlineSync());
  };

  if (checkingAuth) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#1F3D2B" size="large" />
        <Text style={styles.loadingText}>Checking account...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={["#1F3D2B", "#2C533A"]}
        style={[styles.header, { paddingHorizontal: horizontalPad }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityLabel="Back"
            activeOpacity={0.6}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          >
            <ArrowLeft color="#FFF" size={22} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void refreshState()}
            style={styles.refreshBtn}
            accessibilityLabel="Refresh status"
          >
            <RefreshCw color="rgba(255,255,255,0.9)" size={18} />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>FIELD MODE SETTINGS</Text>
        <Text style={styles.headerSub}>Stable operation without signal drops</Text>
      </LinearGradient>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{
          paddingHorizontal: horizontalPad,
          paddingTop: 16,
          paddingBottom: 44,
        }}
      >
        <View style={[styles.card, { borderRadius: cardRadius }]}>
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <ShieldCheck color="#1F3D2B" size={18} />
            </View>
            <View style={styles.textWrap}>
              <Text style={styles.label}>Strict field mode</Text>
              <Text style={styles.hint}>
                Quiets remote errors and keeps screens calm while working in poor
                connectivity.
              </Text>
            </View>
            <Switch
              value={strict}
              onValueChange={(value) => {
                setStrict(value);
                void setFieldModeStrict(value);
              }}
              trackColor={{ false: "#CCC", true: "#81C784" }}
              thumbColor={strict ? "#1F3D2B" : "#F4F3F4"}
            />
          </View>
        </View>

        <View style={styles.statusGrid}>
          <View style={[styles.statusCard, { borderRadius: cardRadius }]}>
            <Text style={styles.statusLabel}>NETWORK</Text>
            <View style={styles.statusRow}>
              {net === false ? (
                <WifiOff color="#A94442" size={18} />
              ) : (
                <Wifi color="#1F3D2B" size={18} />
              )}
              <Text style={styles.statusValue}>
                {net === null ? "Checking..." : net ? "Online" : "Offline / no data"}
              </Text>
            </View>
          </View>

          <View style={[styles.statusCard, { borderRadius: cardRadius }]}>
            <Text style={styles.statusLabel}>CURRENT MODE</Text>
            <Text
              style={[
                styles.statusValue,
                strict || net === false ? styles.statusValueQuiet : null,
              ]}
            >
              {strict || net === false ? "FIELD MODE (QUIET)" : "LIVE MODE"}
            </Text>
          </View>
        </View>

        <Text style={styles.footerNote}>
          First-time login still needs internet once to cache your account. After
          that, this device can keep operating offline for previously logged-in
          accounts.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9F7" },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#F8F9F7",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: { marginTop: 10, color: "#6E7A71", fontSize: 12, fontWeight: "700" },
  header: {
    paddingTop: Platform.OS === "android" ? 18 : 12,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 14,
  },
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 6 },
  body: { flex: 1 },
  card: {
    backgroundColor: "#FFF",
    padding: 16,
    borderWidth: 1,
    borderColor: "#EAECE6",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E8EDEA",
    justifyContent: "center",
    alignItems: "center",
  },
  textWrap: { flex: 1 },
  label: { fontSize: 16, fontWeight: "800", color: "#1F3D2B", flexShrink: 1 },
  hint: { fontSize: 12, color: "#6E7A71", marginTop: 8, lineHeight: 18 },
  statusGrid: { marginTop: 14, gap: 10 },
  statusCard: {
    backgroundColor: "#E8EDEA",
    padding: 14,
  },
  statusLabel: { fontSize: 10, fontWeight: "900", color: "#6E7A71", letterSpacing: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  statusValue: { fontSize: 16, fontWeight: "800", color: "#1F3D2B", marginTop: 4 },
  statusValueQuiet: { color: "#2E7D32" },
  footerNote: { marginTop: 18, fontSize: 11, color: "#6E7A71", lineHeight: 17 },
});
