import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Bell,
  Calendar,
  ChevronRight,
  LogOut,
  QrCode,
  User,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Image,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import WowLoading from "../components/WowLoading";
import { logout, type UserSession } from "../lib/auth";
import { requireRole } from "../lib/authz";
import { confirmAction } from "../lib/web-utils";
import { getCadetStanding } from "../lib/reports-service";
import { supabase } from "../lib/supabase";

type AttendanceStatus = "PRESENT" | "ABSENT";
type HistoryFilter = "ALL" | "PRESENT" | "LATE" | "ABSENT";

interface TodayAttendance {
  am: AttendanceStatus;
  pm: AttendanceStatus;
}

interface HistoryCounts {
  present: number;
  late: number;
  absent: number;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  created_at: string;
}

interface FormationHistoryRecord {
  id: string;
  status: "present" | "late" | "absent" | "excused";
  scan_time: string | null;
  sessions: {
    session_date: string;
    session_type: "AM" | "PM";
  } | null;
}

function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function statusStyle(status: AttendanceStatus) {
  switch (status) {
    case "PRESENT":
      return { bg: "#E8F5E9", border: "#4CAF50", text: "#2E7D32" };
    case "ABSENT":
      return { bg: "#FFEBEE", border: "#E53935", text: "#B71C1C" };
    default:
      return { bg: "#F8F9F7", border: "#EAECE6", text: "#A0B3A6" };
  }
}

function standingColor(standing: string) {
  if (standing === "Active") return "#4CAF50";
  if (standing === "Warning") return "#FFA000";
  return "#E53935";
}

export default function CadetDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const headerAnim = useRef(new Animated.Value(0)).current;
  const [today, setToday] = useState<TodayAttendance>({
    am: "ABSENT",
    pm: "ABSENT",
  });
  const [history, setHistory] = useState<HistoryCounts>({
    present: 0,
    late: 0,
    absent: 0,
  });
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [formationHistory, setFormationHistory] = useState<FormationHistoryRecord[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("ALL");
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    (async () => {
      const s = await requireRole(
        router,
        ["cadet"],
        "Only cadets can access this dashboard.",
      );
      if (!s) return;
      setSession(s);
      try {
        await Promise.all([
          loadTodayAttendance(s.id),
          loadHistory(s.id),
          loadFormationHistory(s.id),
          loadAnnouncements(),
          new Promise(res => setTimeout(res, 3500)), // Allow WowLoading animation to finish
        ]);
      } catch (err) {
        console.error("Load error:", err);
      }
      setLoading(false);
    })();
  }, [router]);

  // Real-time updates for read-only cadet dashboard metrics.
  useEffect(() => {
    if (!session?.id) return;

    const refresh = async () => {
      await Promise.all([
        loadTodayAttendance(session.id),
        loadHistory(session.id),
        loadFormationHistory(session.id),
      ]);
    };

    const channel = supabase
      .channel(`cadet-dashboard-${session.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance" },
        () => {
          refresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions" },
        () => {
          refresh();
        },
      )
      .subscribe();

    const interval = setInterval(refresh, 15000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [session?.id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function loadTodayAttendance(cadetId: string) {
    const todayStr = getLocalDateString();
    const { data } = await supabase
      .from("attendance")
      .select("status, sessions!inner(session_type, session_date)")
      .eq("cadet_id", cadetId)
      .eq("sessions.session_date", todayStr);

    const result: TodayAttendance = { am: "ABSENT", pm: "ABSENT" };
    if (data) {
      for (const row of data as any[]) {
        const type: string = row.sessions?.session_type?.toUpperCase();
        const rawStatus = (row.status as string).toLowerCase();
        const status: AttendanceStatus =
          rawStatus === "present" || rawStatus === "late" ? "PRESENT" : "ABSENT";
        if (type === "AM") result.am = status;
        if (type === "PM") result.pm = status;
      }
    }
    setToday(result);
  }

  async function loadHistory(cadetId: string) {
    const { data } = await supabase
      .from("attendance")
      .select("status")
      .eq("cadet_id", cadetId);

    const counts: HistoryCounts = { present: 0, late: 0, absent: 0 };
    if (data) {
      for (const row of data as any[]) {
        const s = (row.status as string).toLowerCase();
        if (s === "present") counts.present++;
        else if (s === "late") counts.late++;
        else if (s === "absent") counts.absent++;
      }
    }
    setHistory(counts);
  }

  async function loadFormationHistory(cadetId: string) {
    const { data } = await supabase
      .from("attendance")
      .select("id, status, scan_time, sessions(session_date, session_type)")
      .eq("cadet_id", cadetId)
      .order("scan_time", { ascending: false })
      .limit(40);

    const normalized: FormationHistoryRecord[] = ((data as any[]) ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      scan_time: row.scan_time,
      sessions: Array.isArray(row.sessions) ? (row.sessions[0] ?? null) : row.sessions,
    }));
    setFormationHistory(normalized);
  }

  async function loadAnnouncements() {
    const { data } = await supabase
      .from("announcements")
      .select("id, title, body, created_at")
      .order("created_at", { ascending: false })
      .limit(3);
    if (data) setAnnouncements(data as Announcement[]);
  }

  async function handleLogout() {
    const confirm = await confirmAction("Logout", "Are you sure you want to end your session?");
    if (confirm) {
      await logout();
      router.replace("/");
    }
  }

  useEffect(() => {
    if (!loading) {
      Animated.timing(headerAnim, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }).start();
    }
  }, [loading]);

  if (loading) {
    return <WowLoading />;
  }

  const standing = getCadetStanding(history.absent);
  const amStyle = statusStyle(today.am);
  const pmStyle = statusStyle(today.pm);
  const filteredHistory = formationHistory.filter((item) => {
    if (historyFilter === "ALL") return true;
    if (historyFilter === "PRESENT") return item.status === "present";
    if (historyFilter === "LATE") return item.status === "late";
    return item.status === "absent";
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header with Gradient */}
      <Animated.View
        style={{
          opacity: headerAnim,
          transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
        }}
      >
      <LinearGradient colors={["#0F2016", "#1F3D2B", "#2C533A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.topActionsRow}>
            <TouchableOpacity onPress={handleLogout} style={styles.iconBtn}>
              <LogOut color="rgba(255,255,255,0.7)" size={20} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn}>
              <Bell color="rgba(255,255,255,0.7)" size={20} />
            </TouchableOpacity>
          </View>

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
        </View>

        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            {session?.photo_url ? (
              <Image
                source={{ uri: session.photo_url }}
                style={styles.avatar}
              />
            ) : (
              <User color="#A0B3A6" size={32} />
            )}
          </View>
          <View style={styles.profileText}>
            <Text style={styles.headerTitle}>
              {session?.full_name?.toUpperCase()}
            </Text>
            <View style={styles.subTextRow}>
              <Text style={styles.headerSubtitle}>ID {session?.id_number}</Text>
              <View style={styles.dot} />
              <Text style={styles.headerSubtitle}>
                {session?.platoon || "UNASSIGNED"}
              </Text>
            </View>
          </View>
        </View>
      </LinearGradient>
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Digital ID Quick Access */}
        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.idCard}
          onPress={() => router.push("/digital-id")}
        >
          <LinearGradient
            colors={["#D4A353", "#B8860B"]}
            style={styles.idCardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <View style={styles.idCardLeft}>
              <Text style={styles.idCardTitle}>Digital ROTC ID</Text>
              <Text style={styles.idCardSub}>Tap to open secure scan code</Text>
            </View>
            <View style={styles.idCardRight}>
              <QrCode color="#FFF" size={36} />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Today: AM/PM attendance (read-only) */}
        <View style={styles.sectionHeader}>
          <Calendar size={18} color="#1F3D2B" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>Today&apos;s Attendance</Text>
          <Text style={styles.dateLabel}>
            {now.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </Text>
        </View>
        <Text style={styles.liveNowText}>
          Now:{" "}
          {now.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          {now.toLocaleTimeString("en-GB", { hour12: false })}
        </Text>

        <View style={styles.statusGrid}>
          <View
            style={[
              styles.statusBox,
              { backgroundColor: amStyle.bg, borderColor: amStyle.border },
            ]}
          >
            <Text style={styles.statusLabel}>MORNING</Text>
            <Text style={[styles.statusValue, { color: amStyle.text }]}>
              {today.am}
            </Text>
          </View>
          <View
            style={[
              styles.statusBox,
              { backgroundColor: pmStyle.bg, borderColor: pmStyle.border },
            ]}
          >
            <Text style={styles.statusLabel}>AFTERNOON</Text>
            <Text style={[styles.statusValue, { color: pmStyle.text }]}>
              {today.pm}
            </Text>
          </View>
        </View>

        {/* History: total present / absences / standing */}
        <Text style={styles.sectionTitle}>History</Text>
        <LinearGradient
          colors={["#0F2016", "#1F3D2B"]}
          style={styles.statsRow}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: "#4CAF50" }]}>
              {history.present}
            </Text>
            <Text style={styles.statLabel}>PRESENT</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: "#FFB74D" }]}>
              {history.late}
            </Text>
            <Text style={styles.statLabel}>LATE</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: "#EF5350" }]}>
              {history.absent}
            </Text>
            <Text style={styles.statLabel}>ABSENCES</Text>
          </View>
          <View style={[styles.statItem, { borderRightWidth: 0, flex: 1.2 }]}>
            <Text
              style={[styles.statValue, { color: standingColor(standing) }]}
            >
              {standing.toUpperCase()}
            </Text>
            <Text style={styles.statLabel}>STANDING</Text>
          </View>
        </LinearGradient>

        <View style={styles.sectionHeader}>
          <Calendar size={18} color="#1F3D2B" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>Last Formations</Text>
        </View>
        <View style={styles.filterRow}>
          {(["ALL", "PRESENT", "LATE", "ABSENT"] as HistoryFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, historyFilter === f && styles.filterChipActive]}
              onPress={() => setHistoryFilter(f)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  historyFilter === f && styles.filterChipTextActive,
                ]}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {filteredHistory.length > 0 ? (
          filteredHistory.slice(0, 12).map((row) => {
            const raw = row.status.toUpperCase();
            const color =
              row.status === "present"
                ? "#2E7D32"
                : row.status === "late"
                  ? "#EF6C00"
                  : row.status === "absent"
                    ? "#C62828"
                    : "#1565C0";
            return (
              <View key={row.id} style={styles.historyCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyTitle}>
                    {row.sessions?.session_date ?? "-"} • {row.sessions?.session_type ?? "-"}
                  </Text>
                  <Text style={styles.historySub}>
                    {row.scan_time
                      ? `${new Date(row.scan_time).toLocaleDateString("en-US", {
                          weekday: "short",
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })} ${new Date(row.scan_time).toLocaleTimeString("en-GB", {
                          hour12: false,
                        })}`
                      : "No scan time"}
                  </Text>
                </View>
                <Text style={[styles.historyStatus, { color }]}>{raw}</Text>
              </View>
            );
          })
        ) : (
          <View style={styles.emptyAnnouncements}>
            <Text style={styles.emptyText}>No records for selected filter.</Text>
          </View>
        )}

        {/* Announcements */}
        <View style={styles.sectionHeader}>
          <Bell size={18} color="#1F3D2B" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>Latest Announcements</Text>
        </View>

        {announcements.length > 0 ? (
          announcements.map((a) => (
            <TouchableOpacity key={a.id} style={styles.announcementCard}>
              <View style={styles.announcementContent}>
                <Text style={styles.announcementTitle}>{a.title}</Text>
                <Text style={styles.announcementBody} numberOfLines={2}>
                  {a.body}
                </Text>
                <Text style={styles.announcementDate}>
                  {new Date(a.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </Text>
              </View>
              <ChevronRight color="#EAECE6" size={20} />
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyAnnouncements}>
            <Text style={styles.emptyText}>
              No recent announcements from the unit.
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8F9F7",
  },
  container: { flex: 1, backgroundColor: "#F8F9F7" },
  header: {
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 30,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerTop: {
    marginBottom: 20,
  },
  topActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  headerBrand: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    opacity: 0.9,
  },
  unitHeaderGroup: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
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
    flexShrink: 1,
    alignItems: "center",
    paddingHorizontal: 4,
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
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileSection: { flexDirection: "row", alignItems: "center" },
  avatarContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  avatar: { width: "100%", height: "100%" },
  profileText: { marginLeft: 16 },
  headerTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  subTextRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  headerSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "600",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: 8,
  },

  content: { padding: 24 },

  idCard: {
    marginBottom: 30,
    shadowColor: "#D4A353",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  idCardGradient: {
    borderRadius: 20,
    padding: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  idCardLeft: {
    flex: 1,
  },
  idCardRight: {
    marginLeft: 16,
  },
  idCardTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  idCardSub: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    marginTop: 4,
    fontWeight: "600",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: "#1F3D2B", flex: 1 },
  dateLabel: { fontSize: 12, color: "#A0B3A6", fontWeight: "700" },
  liveNowText: {
    fontSize: 11,
    color: "#5D6E62",
    fontWeight: "700",
    marginTop: -6,
    marginBottom: 14,
  },

  statusGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
  },
  statusBox: {
    flex: 0.48,
    padding: 20,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    backgroundColor: "#FFF",
  },
  statusLabel: {
    fontSize: 10,
    color: "#8A9A8E",
    fontWeight: "900",
    marginBottom: 8,
    letterSpacing: 1,
  },
  statusValue: { fontSize: 16, fontWeight: "900" },

  statsRow: {
    flexDirection: "row",
    borderRadius: 20,
    paddingVertical: 20,
    marginBottom: 30,
    overflow: "hidden",
    shadowColor: "#1F3D2B",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.1)",
  },
  statValue: { fontSize: 20, fontWeight: "900", marginBottom: 4 },
  statLabel: {
    fontSize: 9,
    color: "rgba(212,163,83,0.9)",
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  announcementCard: {
    backgroundColor: "#FFF",
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EAECE6",
  },
  announcementContent: { flex: 1, marginRight: 10 },
  announcementTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1F3D2B",
    marginBottom: 4,
  },
  announcementBody: {
    fontSize: 13,
    color: "#6E7A71",
    lineHeight: 18,
    marginBottom: 8,
  },
  announcementDate: { fontSize: 11, color: "#A0B3A6", fontWeight: "700" },

  emptyAnnouncements: {
    padding: 30,
    alignItems: "center",
    backgroundColor: "#F0F2EE",
    borderRadius: 20,
  },
  emptyText: {
    color: "#A0B3A6",
    fontSize: 13,
    textAlign: "center",
    fontWeight: "600",
  },
  filterRow: { flexDirection: "row", marginBottom: 12, gap: 8, flexWrap: "wrap" },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D6DED7",
    backgroundColor: "#FFF",
  },
  filterChipActive: { backgroundColor: "#1F3D2B", borderColor: "#1F3D2B" },
  filterChipText: { fontSize: 11, color: "#5A6C60", fontWeight: "700" },
  filterChipTextActive: { color: "#FFF" },
  historyCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EAECE6",
    padding: 12,
    marginBottom: 8,
  },
  historyTitle: { fontSize: 12, fontWeight: "800", color: "#1F3D2B" },
  historySub: { fontSize: 11, color: "#7B8B80", marginTop: 2 },
  historyStatus: { fontSize: 12, fontWeight: "900" },
});
