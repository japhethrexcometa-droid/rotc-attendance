import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import {
  Bell,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  LogOut,
  Scan,
  Settings,
  Share2,
  ShieldCheck,
  ShieldPlus,
  UserPlus,
  Users,
  Award,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { logout, type UserSession } from "../lib/auth";
import { requireRole } from "../lib/authz";
import {
  getDigitalIdPortalAppLink,
  getDigitalIdPortalLink,
  getDigitalIdPortalWebLink,
  isPortalUsingDeepLinkFallback,
} from "../lib/digital-id-service";
import {
  isFieldModeStrictSync,
  isOnlineSync,
  loadFieldModePreference,
  subscribeFieldMode,
} from "../lib/field-mode";
import { supabase } from "../lib/supabase";
import { confirmAction } from "../lib/web-utils";

export default function CommanderDashboard() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTiny = width < 350;
  const isCompact = width < 390;
  const isTablet = width >= 768;
  const sidePad = isCompact ? 14 : isTablet ? 28 : 24;
  const contentMaxWidth = isTablet ? 900 : width;
  const layoutWidth = Math.min(width, contentMaxWidth);
  const gridGap = isCompact ? 10 : 14;
  const statColumns = isTiny ? 1 : 2;
  const actionColumns = isTiny ? 1 : isTablet ? 3 : 2;
  const statTileWidth =
    (layoutWidth - sidePad * 2 - gridGap * (statColumns - 1)) / statColumns;
  const actionTileWidth =
    (layoutWidth - sidePad * 2 - gridGap * (actionColumns - 1)) / actionColumns;
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCadets: 0,
    presentToday: 0,
    activeSessions: 0,
  });
  const [fieldBanner, setFieldBanner] = useState(false);
  const [netOnline, setNetOnline] = useState<boolean | null>(null);
  const portalLink = getDigitalIdPortalLink();
  const portalWebLink = getDigitalIdPortalWebLink();
  const portalAppLink = getDigitalIdPortalAppLink();
  const portalFallbackMode = isPortalUsingDeepLinkFallback();

  useEffect(() => {
    const syncField = async () => {
      await loadFieldModePreference();
      setFieldBanner(isFieldModeStrictSync());
      setNetOnline(isOnlineSync());
    };
    void syncField();
    return subscribeFieldMode(() => {
      void syncField();
    });
  }, []);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        const userSession = await requireRole(
          router,
          ["admin"],
          "Only admin can access command center.",
        );
        if (!userSession) {
          return;
        }
        setSession(userSession);

        // Fetch basic stats
        const todayStr = new Date().toISOString().split("T")[0];
        const [cadetsCount, attendanceCount, sessionsCount] = await Promise.all(
          [
            supabase
              .from("users")
              .select("id", { count: "exact", head: true })
              .eq("role", "cadet")
              .eq("is_active", true),
            supabase
              .from("attendance")
              .select("id", { count: "exact", head: true })
              .gte("scan_time", todayStr),
            supabase
              .from("sessions")
              .select("id", { count: "exact", head: true })
              .eq("status", "OPEN"),
          ],
        );

        setStats({
          totalCadets: cadetsCount.count || 0,
          presentToday: attendanceCount.count || 0,
          activeSessions: sessionsCount.count || 0,
        });
      } catch (error) {
        console.error("Dashboard load error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [router]);

  const handleLogoutClick = async () => {
    const confirmed = await confirmAction("Confirm Logout", "Are you sure you want to end your session?");
    if (confirmed) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await logout();
      router.replace("/");
    }
  };

  const handleAction = (route: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as any);
  };

  const handleCopyPortalLink = async () => {
    await Share.share({ message: portalLink });
    Alert.alert("Portal Link", `Share this public portal link:\n${portalLink}`);
  };

  const handleSharePortalLink = async () => {
    await Share.share({
      message: `ROTC Digital ID Portal (Search by Name/ID): ${portalLink}`,
    });
  };

  const handleShareAppPortalLink = async () => {
    await Share.share({
      message: `ROTC Digital ID Portal (Open in app): ${portalAppLink}`,
    });
  };

  const handleOpenPortalLink = async () => {
    const canOpen = await Linking.canOpenURL(portalLink);
    if (canOpen) {
      await Linking.openURL(portalLink);
    } else {
      Alert.alert("Invalid Link", portalLink);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1F3D2B" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {/* Premium Header */}
        <LinearGradient
          colors={["#1F3D2B", "#2C533A"]}
          style={[styles.header, { paddingHorizontal: sidePad }]}
        >
          <View style={styles.headerTop}>
            <TouchableOpacity
              onPress={handleLogoutClick}
              style={styles.headerIconBtn}
            >
              <LogOut color="rgba(255,255,255,0.7)" size={20} />
            </TouchableOpacity>
            <View style={styles.unitHeaderGroup}>
              <View style={styles.headerLogoCircle}>
                <Image
                  source={require("../assets/images/rotc-logo.jpg")}
                  style={styles.headerTinyLogo}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.unitHeaderCol}>
                <Text style={styles.unitHeaderTopText} adjustsFontSizeToFit numberOfLines={1}>
                  DEPARTMENT OF MILITARY SCIENCE AND TACTICS
                </Text>
                <Text style={styles.unitHeaderMidText} adjustsFontSizeToFit numberOfLines={1}>
                  MSU – Zamboanga Sibugay ROTC Unit
                </Text>
                <Text style={styles.unitHeaderBotText} adjustsFontSizeToFit numberOfLines={1}>
                  Datu Panas, Buug, Zamboanga Sibugay
                </Text>
              </View>
              <View style={styles.headerLogoCircleGold}>
                <Image
                  source={require("../assets/images/batch-logo.png")}
                  style={styles.headerTinyLogo}
                  resizeMode="contain"
                />
              </View>
            </View>
            <TouchableOpacity style={styles.headerIconBtn}>
              <Bell color="rgba(255,255,255,0.7)" size={20} />
            </TouchableOpacity>
          </View>

          <View style={styles.profileRow}>
            <View style={styles.profileInfo}>
              <Text style={styles.greeting}>Good Day, Commander</Text>
              <Text style={styles.adminName}>
                {session?.full_name?.toUpperCase()}
              </Text>
              <View style={styles.roleBadge}>
                <ShieldCheck
                  color="#D4A353"
                  size={12}
                  style={{ marginRight: 4 }}
                />
                <Text style={styles.roleText}>
                  {session?.role === "admin" ? "SUPERVISOR" : "DUTY OFFICER"}
                </Text>
              </View>
            </View>
          </View>
        </LinearGradient>

        <ScrollView
          style={[styles.content, { paddingHorizontal: sidePad }]}
          contentContainerStyle={{
            paddingBottom: 40,
            width: "100%",
            maxWidth: contentMaxWidth,
            alignSelf: "center",
          }}
          showsVerticalScrollIndicator={false}
        >
          {(fieldBanner || netOnline === false) && (
            <TouchableOpacity
              style={styles.fieldBanner}
              onPress={() => handleAction("/settings")}
              activeOpacity={0.85}
            >
              <Text style={styles.fieldBannerText}>
                {fieldBanner
                  ? "Field mode: quiet errors — tap to adjust"
                  : "Offline: scans queue until signal returns"}
              </Text>
            </TouchableOpacity>
          )}
          {/* Stat Cards */}
          <View style={[styles.statsGrid, { gap: gridGap }]}>
            <View style={[styles.statCard, { width: statTileWidth }]}>
              <Users color="#1F3D2B" size={24} />
              <Text style={styles.statNumber} maxFontSizeMultiplier={1.2}>
                {stats.totalCadets}
              </Text>
              <Text style={styles.statLabel} maxFontSizeMultiplier={1.2}>
                TOTAL CADETS
              </Text>
            </View>
            <View style={[styles.statCard, { width: statTileWidth }]}>
              <Clock color="#D4A353" size={24} />
              <Text style={styles.statNumber} maxFontSizeMultiplier={1.2}>
                {stats.activeSessions}
              </Text>
              <Text style={styles.statLabel} maxFontSizeMultiplier={1.2}>
                ACTIVE WINDOWS
              </Text>
            </View>
          </View>

          {/* Quick Actions */}
          <Text style={styles.sectionTitle}>Unit Management</Text>
          <View style={styles.actionsGrid}>
            <ActionTile
              icon={<Scan color="#FFF" size={28} />}
              label="Scan QR Code"
              color="#1F3D2B"
              width={actionTileWidth}
              onPress={() => handleAction("/scanner")}
            />
            <ActionTile
              icon={<Clock color="#FFF" size={28} />}
              label="Manage Windows"
              color="#D4A353"
              width={actionTileWidth}
              onPress={() => handleAction("/sessions")}
            />
            <ActionTile
              icon={<Users color="#FFF" size={28} />}
              label="Cadet Registry"
              color="#2C533A"
              width={actionTileWidth}
              onPress={() => handleAction("/cadets")}
            />
            <ActionTile
              icon={<FileText color="#FFF" size={28} />}
              label="Duty Reports"
              color="#4A845D"
              width={actionTileWidth}
              onPress={() => handleAction("/reports")}
            />
            <ActionTile
              icon={<Award color="#FFF" size={28} />}
              label="Live Scores"
              color="#1B3A26"
              width={actionTileWidth}
              onPress={() => handleAction("/scores")}
            />
          </View>

          {/* Maintenance / Secondary Options */}
          <Text style={styles.sectionTitle}>Administrative</Text>
          <TouchableOpacity
            style={styles.listAction}
            onPress={() => handleAction("/enrollment")}
          >
            <View style={[styles.listIcon, { backgroundColor: "#E8F5E9" }]}>
              <UserPlus color="#2E7D32" size={20} />
            </View>
            <View style={styles.listText}>
              <Text style={styles.listTitle}>Bulk Enrollment</Text>
              <Text style={styles.listSub}>Import cadet batches via Excel</Text>
            </View>
            <ChevronRight color="#CCC" size={20} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.listAction}
            onPress={() => handleAction("/officers")}
          >
            <View style={[styles.listIcon, { backgroundColor: "#E8EDF8" }]}>
              <ShieldPlus color="#2F4F8F" size={20} />
            </View>
            <View style={styles.listText}>
              <Text style={styles.listTitle}>Officer Management</Text>
              <Text style={styles.listSub}>
                Reset password and activate/deactivate officers
              </Text>
            </View>
            <ChevronRight color="#CCC" size={20} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.listAction}
            onPress={() => handleAction("/settings")}
          >
            <View style={[styles.listIcon, { backgroundColor: "#F5F5F5" }]}>
              <Settings color="#666" size={20} />
            </View>
            <View style={styles.listText}>
              <Text style={styles.listTitle}>System Settings</Text>
              <Text style={styles.listSub}>
                Manage Unit profile and security
              </Text>
            </View>
            <ChevronRight color="#CCC" size={20} />
          </TouchableOpacity>

          <View style={styles.footer}>
            <View style={styles.portalCard}>
              <Text style={styles.portalTitle}>
                Digital ID Portal (GC Share)
              </Text>
              <Text style={styles.portalSub}>
                Public link for cadets to search, view, and download ID
              </Text>
              {portalFallbackMode && (
                <Text style={styles.portalWarn}>
                  No live web portal URL is configured. For testing, share the
                  App link (works if the app is installed). To enable browser
                  access, set `EXPO_PUBLIC_DIGITAL_ID_PORTAL_URL` to your live
                  website domain.
                </Text>
              )}
              <View style={styles.portalLinkBox}>
                <Text style={styles.portalLinkText} numberOfLines={1}>
                  {portalLink}
                </Text>
              </View>
              <View style={styles.portalActions}>
                <TouchableOpacity
                  style={styles.portalBtnDark}
                  onPress={handleCopyPortalLink}
                >
                  <Copy color="#FFF" size={14} />
                  <Text style={styles.portalBtnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.portalBtnGold}
                  onPress={portalWebLink ? handleSharePortalLink : handleShareAppPortalLink}
                >
                  <Share2 color="#FFF" size={14} />
                  <Text style={styles.portalBtnText}>
                    {portalWebLink ? "Share Web" : "Share App"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.portalBtnGreen}
                  onPress={handleOpenPortalLink}
                >
                  <ExternalLink color="#FFF" size={14} />
                  <Text style={styles.portalBtnText}>Open</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.footerText}>MSU–ZS ROTC UNIT • v1.0.0</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function ActionTile({ icon, label, color, width, onPress }: any) {
  return (
    <TouchableOpacity
      style={[styles.tile, { backgroundColor: color, width }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.tileIcon}>{icon}</View>
      <Text style={styles.tileLabel} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8F9F7",
  },
  safeArea: { flex: 1, backgroundColor: "#0F2016" },
  container: { flex: 1, backgroundColor: "#F8F9F7" },
  header: {
    paddingTop: Platform.OS === "ios" ? 20 : 40,
    paddingBottom: 40,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
  },
  headerBrand: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    opacity: 0.8,
  },
  unitHeaderGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLogoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFF",
    padding: 3,
    marginRight: 10,
  },
  headerLogoCircleGold: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFF",
    padding: 3,
    marginLeft: 10,
  },
  headerTinyLogo: {
    width: "100%",
    height: "100%",
    borderRadius: 22,
  },
  unitHeaderCol: {
    flex: 1,
    alignItems: "center",
  },
  unitHeaderTopText: {
    color: "#D4A353",
    fontSize: 9,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  unitHeaderMidText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "bold",
    textAlign: "center",
    marginVertical: 1,
  },
  unitHeaderBotText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 9,
    textAlign: "center",
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileRow: { flexDirection: "row", alignItems: "center" },
  profileInfo: { flex: 1 },
  greeting: { color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "600" },
  adminName: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
    letterSpacing: 0.5,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(212, 163, 83, 0.15)",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 10,
  },
  roleText: {
    color: "#D4A353",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },

  content: { flex: 1, paddingTop: 24 },
  fieldBanner: {
    backgroundColor: "#E3F2FD",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#90CAF9",
  },
  fieldBannerText: {
    color: "#0D47A1",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 30 },
  statCard: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EAECE6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: "900",
    color: "#1F3D2B",
    marginVertical: 8,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: "900",
    color: "#A0B3A6",
    letterSpacing: 0.5,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#1F3D2B",
    marginBottom: 16,
    marginTop: 10,
  },

  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: 10,
    marginBottom: 20,
  },
  tile: {
    height: 120,
    borderRadius: 20,
    padding: 20,
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  tileIcon: { marginBottom: 12 },
  tileLabel: { color: "#FFF", fontSize: 14, fontWeight: "800" },

  listAction: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EAECE6",
  },
  listIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  listText: { flex: 1, marginLeft: 16 },
  listTitle: { fontSize: 15, fontWeight: "800", color: "#1F3D2B" },
  listSub: { fontSize: 12, color: "#8A9A8E", marginTop: 2 },

  footer: { marginTop: 30, alignItems: "center" },
  footerText: {
    color: "#CCC",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  portalCard: {
    width: "100%",
    backgroundColor: "#EAECE6",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  portalTitle: { fontSize: 14, fontWeight: "900", color: "#1F3D2B" },
  portalSub: { fontSize: 11, color: "#4A5D4E", marginTop: 4, marginBottom: 10 },
  portalWarn: {
    fontSize: 10,
    color: "#A52A2A",
    marginBottom: 8,
    fontWeight: "700",
  },
  portalLinkBox: {
    backgroundColor: "#DFE2DA",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  portalLinkText: { fontSize: 11, color: "#4A5D4E" },
  portalActions: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  portalBtnDark: {
    backgroundColor: "#2C4A31",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    flex: 0.32,
  },
  portalBtnGold: {
    backgroundColor: "#D4A353",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    flex: 0.32,
  },
  portalBtnGreen: {
    backgroundColor: "#45794C",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    flex: 0.32,
  },
  portalBtnText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 4,
  },

  // Logout confirm modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#1F3D2B",
    marginBottom: 6,
  },
  modalSub: {
    fontSize: 13,
    color: "#6E7A71",
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cancelText: {
    color: "#6E7A71",
    fontWeight: "700",
  },
  confirmBtn: {
    backgroundColor: "#A52A2A",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  confirmText: {
    color: "#FFF",
    fontWeight: "800",
  },
});
