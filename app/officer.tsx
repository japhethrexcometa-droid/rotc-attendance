import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Calendar,
  ClipboardList,
  IdCard,
  List,
  LogOut,
  ScanLine,
  Settings,
  ShieldCheck,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScannerView from "../components/ScannerView";
import { logout, UserSession } from "../lib/auth";
import { confirmAction } from "../lib/web-utils";
import { requireRole } from "../lib/authz";
import {
  autoCloseExpiredSessions,
  getCurrentScannableSession,
  Session,
} from "../lib/session-manager";
import { supabase } from "../lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttendanceRecord {
  id: string;
  status: string;
  scan_time: string | null;
  users: {
    full_name: string;
    id_number: string;
    platoon: string;
  };
}

interface OfficerScanRecord {
  id: string;
  status: string;
  scan_time: string | null;
  cadet_id: string;
  users: {
    full_name: string;
    id_number: string;
    platoon: string | null;
  };
  sessions: {
    session_date: string;
    session_type: "AM" | "PM";
  } | null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OfficerDashboard() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 360;
  const isTablet = width >= 768;
  const sidePad = isCompact ? 14 : isTablet ? 28 : 20;
  const contentMaxWidth = isTablet ? 900 : width;
  const [activeTab, setActiveTab] = useState<"Scanner" | "Results" | "History">(
    "Scanner",
  );
  const [userSession, setUserSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    requireRole(
      router,
      ["officer"],
      "Only officers can access this dashboard.",
    ).then((session) => {
      if (!session) return;
      setUserSession(session);
      setLoading(false);
    });
  }, [router]);

  const handleLogout = async () => {
    const confirm = await confirmAction("Logout", "Are you sure you want to end your session?");
    if (confirm) {
      await logout();
      router.replace("/");
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#1F3D2B" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Premium Header */}
      <LinearGradient
        colors={["#1F3D2B", "#2C533A"]}
        style={[
          styles.header,
          {
            paddingHorizontal: sidePad,
            width: "100%",
            alignSelf: "center",
            maxWidth: contentMaxWidth,
          },
        ]}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={handleLogout}
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
          <TouchableOpacity
            onPress={() => router.push("/digital-id")}
            style={styles.headerIconBtn}
            accessibilityLabel="My digital ID"
          >
            <IdCard color="rgba(255,255,255,0.7)" size={20} />
          </TouchableOpacity>
        </View>

        <View style={styles.profileRow}>
          <View style={styles.profileInfo}>
            <Text style={styles.greeting}>Duty Officer</Text>
            <Text style={styles.adminName}>
              {userSession?.full_name?.toUpperCase() ?? "OFFICER"}
            </Text>
            <View style={styles.roleBadge}>
              <ShieldCheck
                color="#D4A353"
                size={12}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.roleText}>
                {userSession?.platoon
                  ? `PLATOON ${userSession.platoon}`
                  : "UNASSIGNED"}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/settings")}
            style={styles.settingsIconBtn}
            accessibilityLabel="Settings"
          >
            <Settings color="rgba(255,255,255,0.8)" size={22} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Tab Content */}
      <View style={{ flex: 1 }}>
        {activeTab === "Scanner" && <ScannerTab userSession={userSession} />}
        {activeTab === "Results" && (
          <ResultsTab
            userSession={userSession}
            sidePad={sidePad}
            contentMaxWidth={contentMaxWidth}
          />
        )}
        {activeTab === "History" && (
          <HistoryTab
            userSession={userSession}
            sidePad={sidePad}
            contentMaxWidth={contentMaxWidth}
          />
        )}
      </View>

      {/* Bottom Tab Bar */}
      <View style={styles.bottomBar}>
        <TabButton
          icon={ScanLine}
          label="Scanner"
          isActive={activeTab === "Scanner"}
          onPress={() => setActiveTab("Scanner")}
        />
        <TabButton
          icon={List}
          label="Results"
          isActive={activeTab === "Results"}
          onPress={() => setActiveTab("Results")}
        />
        <TabButton
          icon={ClipboardList}
          label="My History"
          isActive={activeTab === "History"}
          onPress={() => setActiveTab("History")}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── Tab 1: Scanner ───────────────────────────────────────────────────────────

function ScannerTab({ userSession }: { userSession: UserSession | null }) {
  const [openSession, setOpenSession] = useState<Session | null | undefined>(
    undefined,
  );

  useEffect(() => {
    const fetchSession = async () => {
      await autoCloseExpiredSessions();
      const current = await getCurrentScannableSession();
      setOpenSession(current ?? null);
    };
    fetchSession();
    // Poll every 8s so cutoff detection is fast
    const timer = setInterval(fetchSession, 8000);
    return () => clearInterval(timer);
  }, []);

  if (openSession === undefined) {
    return (
      <View style={styles.centeredMessage}>
        <ActivityIndicator color="#1F3D2B" size="large" />
      </View>
    );
  }

  if (openSession === null) {
    return (
      <View style={styles.centeredMessage}>
        <ScanLine color="#999" size={48} />
        <Text style={styles.noSessionText}>No open session.</Text>
        <Text style={styles.noSessionSubtext}>
          Waiting for admin to open a session window, or the session has reached
          cutoff and was automatically closed.
        </Text>
      </View>
    );
  }

  return (
    <ScannerView session={openSession} scannedBy={userSession?.id ?? ""} />
  );
}

// ─── Tab 2: Results (Today's Scans) ──────────────────────────────────────────

function ResultsTab({
  userSession,
  sidePad,
  contentMaxWidth,
}: {
  userSession: UserSession | null;
  sidePad: number;
  contentMaxWidth: number;
}) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAttendance = useCallback(async () => {
    if (!userSession?.id) return;
    setLoading(true);

    const today = new Date().toISOString().split("T")[0];

    // Get today's sessions
    const { data: sessionData } = await supabase
      .from("sessions")
      .select("id")
      .eq("session_date", today);

    const todaySessionIds = (sessionData ?? []).map(
      (s: { id: string }) => s.id,
    );

    if (todaySessionIds.length === 0) {
      setRecords([]);
      setLoading(false);
      return;
    }

    // Show ALL today's attendance scanned by THIS officer
    const { data } = await supabase
      .from("attendance")
      .select(
        "id, status, scan_time, users!attendance_cadet_id_fkey!inner(full_name, id_number, platoon)",
      )
      .in("session_id", todaySessionIds)
      .eq("scanned_by", userSession.id)
      .order("scan_time", { ascending: false });

    setRecords((data as unknown as AttendanceRecord[]) ?? []);
    setLoading(false);
  }, [userSession?.id]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(loadAttendance, 10000);
    return () => clearInterval(interval);
  }, [loadAttendance]);

  const statusColor = (status: string) => {
    switch (status) {
      case "present":
        return "#4CAF50";
      case "late":
        return "#F57C00";
      case "absent":
        return "#E53935";
      case "excused":
        return "#1565C0";
      default:
        return "#999";
    }
  };

  const renderItem = ({ item }: { item: AttendanceRecord }) => (
    <View style={styles.recordCard}>
      <View style={styles.recordLeft}>
        <Text style={styles.recordName}>{item.users.full_name}</Text>
        <Text style={styles.recordId}>{item.users.id_number}</Text>
        {item.scan_time && (
          <Text style={styles.recordTime}>
            {new Date(item.scan_time).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.statusBadge,
          { backgroundColor: statusColor(item.status) },
        ]}
      >
        <Text style={styles.statusBadgeText}>{item.status.toUpperCase()}</Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          styles.resultsHeader,
          {
            paddingHorizontal: sidePad,
            width: "100%",
            alignSelf: "center",
            maxWidth: contentMaxWidth,
          },
        ]}
      >
        <Text style={styles.tabTitle}>Today&apos;s Scans</Text>
        <Text style={styles.platoonLabel}>
          Scanned by: {userSession?.full_name} • {records.length} records
        </Text>
      </View>
      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingHorizontal: sidePad,
          paddingBottom: 110,
          width: "100%",
          alignSelf: "center",
          maxWidth: contentMaxWidth,
        }}
        onRefresh={loadAttendance}
        refreshing={loading}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.emptyContainer}>
              <ScanLine color="#CCC" size={40} />
              <Text style={styles.emptyText}>No scans recorded yet today.</Text>
              <Text style={styles.emptySubtext}>
                Open a session and scan cadet QR codes to see results here.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

// ─── Tab 3: My Scan History ──────────────────────────────────────────────────

function HistoryTab({
  userSession,
  sidePad,
  contentMaxWidth,
}: {
  userSession: UserSession | null;
  sidePad: number;
  contentMaxWidth: number;
}) {
  const [scans, setScans] = useState<OfficerScanRecord[]>([]);
  const [myAttendance, setMyAttendance] = useState<
    {
      id: string;
      status: string;
      scan_time: string | null;
      sessions: { session_date: string; session_type: "AM" | "PM" } | null;
    }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"scans" | "attendance">("scans");

  const loadData = useCallback(async () => {
    if (!userSession?.id) return;
    setLoading(true);

    // Load scans made BY this officer (last 50)
    const { data: scanData } = await supabase
      .from("attendance")
      .select(
        "id, status, scan_time, cadet_id, users!attendance_cadet_id_fkey!inner(full_name, id_number, platoon), sessions(session_date, session_type)",
      )
      .eq("scanned_by", userSession.id)
      .order("scan_time", { ascending: false })
      .limit(50);

    const normalizedScans: OfficerScanRecord[] = (
      (scanData as any[]) ?? []
    ).map((row) => ({
      id: row.id,
      status: row.status,
      scan_time: row.scan_time,
      cadet_id: row.cadet_id,
      users: Array.isArray(row.users) ? row.users[0] ?? {} : row.users,
      sessions: Array.isArray(row.sessions)
        ? row.sessions[0] ?? null
        : row.sessions,
    }));
    setScans(normalizedScans);

    // Load this officer's OWN attendance (they are also tracked as a user)
    const { data: attendanceData } = await supabase
      .from("attendance")
      .select("id, status, scan_time, sessions(session_date, session_type)")
      .eq("cadet_id", userSession.id)
      .order("scan_time", { ascending: false })
      .limit(30);

    const normalizedAttendance = ((attendanceData as any[]) ?? []).map(
      (row) => ({
        id: row.id,
        status: row.status,
        scan_time: row.scan_time,
        sessions: Array.isArray(row.sessions)
          ? row.sessions[0] ?? null
          : row.sessions,
      }),
    );
    setMyAttendance(normalizedAttendance);

    setLoading(false);
  }, [userSession?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const statusColor = (status: string) => {
    switch (status) {
      case "present":
        return "#4CAF50";
      case "late":
        return "#F57C00";
      case "absent":
        return "#E53935";
      default:
        return "#999";
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          styles.resultsHeader,
          {
            paddingHorizontal: sidePad,
            width: "100%",
            alignSelf: "center",
            maxWidth: contentMaxWidth,
          },
        ]}
      >
        <Text style={styles.tabTitle}>Officer History</Text>
      </View>

      {/* Sub-tab toggle */}
      <View
        style={[styles.subTabRow, { paddingHorizontal: sidePad, maxWidth: contentMaxWidth, alignSelf: "center", width: "100%" }]}
      >
        <TouchableOpacity
          style={[
            styles.subTabBtn,
            view === "scans" && styles.subTabBtnActive,
          ]}
          onPress={() => setView("scans")}
        >
          <Text
            style={[
              styles.subTabText,
              view === "scans" && styles.subTabTextActive,
            ]}
          >
            My Scans ({scans.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.subTabBtn,
            view === "attendance" && styles.subTabBtnActive,
          ]}
          onPress={() => setView("attendance")}
        >
          <Text
            style={[
              styles.subTabText,
              view === "attendance" && styles.subTabTextActive,
            ]}
          >
            My Attendance ({myAttendance.length})
          </Text>
        </TouchableOpacity>
      </View>

      {view === "scans" ? (
        <FlatList
          data={scans}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: sidePad,
            paddingBottom: 110,
            width: "100%",
            alignSelf: "center",
            maxWidth: contentMaxWidth,
          }}
          onRefresh={loadData}
          refreshing={loading}
          renderItem={({ item }) => (
            <View style={styles.recordCard}>
              <View style={styles.recordLeft}>
                <Text style={styles.recordName}>
                  {item.users?.full_name ?? "Unknown"}
                </Text>
                <Text style={styles.recordId}>
                  {item.users?.id_number ?? "-"} •{" "}
                  {item.sessions?.session_date ?? "-"} •{" "}
                  {item.sessions?.session_type ?? "-"}
                </Text>
                {item.scan_time && (
                  <Text style={styles.recordTime}>
                    {new Date(item.scan_time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                )}
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: statusColor(item.status) },
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {item.status.toUpperCase()}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.emptyContainer}>
                <ClipboardList color="#CCC" size={40} />
                <Text style={styles.emptyText}>No scan history yet.</Text>
                <Text style={styles.emptySubtext}>
                  Scan cadet QR codes during open sessions to build your scan
                  history.
                </Text>
              </View>
            )
          }
        />
      ) : (
        <FlatList
          data={myAttendance}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: sidePad,
            paddingBottom: 110,
            width: "100%",
            alignSelf: "center",
            maxWidth: contentMaxWidth,
          }}
          onRefresh={loadData}
          refreshing={loading}
          renderItem={({ item }) => (
            <View style={styles.recordCard}>
              <View style={styles.recordLeft}>
                <Text style={styles.recordName}>
                  {item.sessions?.session_date ?? "-"} •{" "}
                  {item.sessions?.session_type ?? "-"}
                </Text>
                {item.scan_time && (
                  <Text style={styles.recordTime}>
                    {new Date(item.scan_time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                )}
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: statusColor(item.status) },
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {item.status.toUpperCase()}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.emptyContainer}>
                <Calendar color="#CCC" size={40} />
                <Text style={styles.emptyText}>No attendance recorded.</Text>
                <Text style={styles.emptySubtext}>
                  Your attendance will appear here when you are scanned via QR
                  code during sessions.
                </Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}

// ─── Shared Sub-Components ────────────────────────────────────────────────────

const TabButton = ({
  icon: Icon,
  label,
  isActive,
  onPress,
}: {
  icon: React.ComponentType<{ color: string; size: number }>;
  label: string;
  isActive: boolean;
  onPress: () => void;
}) => (
  <TouchableOpacity style={styles.tabBtn} onPress={onPress}>
    <Icon color={isActive ? "#D4A353" : "#6E7A71"} size={24} />
    <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
      {label}
    </Text>
  </TouchableOpacity>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8F9F7",
    paddingTop: Platform.OS === "android" ? 35 : 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8F9F7",
  },

  header: {
    paddingTop: Platform.OS === "ios" ? 20 : 40,
    paddingBottom: 25,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  settingsIconBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
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

  centeredMessage: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  noSessionText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginTop: 16,
    textAlign: "center",
  },
  noSessionSubtext: {
    fontSize: 14,
    color: "#6E7A71",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
  },

  resultsHeader: {
    paddingTop: 20,
    paddingBottom: 10,
  },
  tabTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#111",
    marginBottom: 4,
  },
  platoonLabel: {
    fontSize: 13,
    color: "#6E7A71",
    fontWeight: "600",
    marginBottom: 8,
  },

  subTabRow: {
    flexDirection: "row",
    backgroundColor: "#EAECE6",
    borderRadius: 12,
    padding: 3,
    marginBottom: 12,
  },
  subTabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 10,
  },
  subTabBtnActive: {
    backgroundColor: "#1F3D2B",
  },
  subTabText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#4A5D4E",
  },
  subTabTextActive: {
    color: "#FFF",
  },

  recordCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  recordLeft: { flex: 1 },
  recordName: { fontSize: 14, fontWeight: "600", color: "#111" },
  recordId: { fontSize: 12, color: "#6E7A71", marginTop: 2 },
  recordTime: { fontSize: 11, color: "#999", marginTop: 2 },

  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    marginLeft: 10,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFF",
  },

  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFF",
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 15,
    paddingVertical: 12,
    paddingBottom: Platform.OS === "ios" ? 25 : 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 15,
  },
  tabBtn: { alignItems: "center", justifyContent: "center", flex: 1 },
  tabLabel: { fontSize: 10, color: "#6E7A71", marginTop: 4, fontWeight: "500" },
  tabLabelActive: { color: "#D4A353", fontWeight: "bold" },

  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#999",
    textAlign: "center",
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 13,
    color: "#B0B0B0",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 18,
  },
});
