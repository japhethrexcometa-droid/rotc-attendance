import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Power,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { type UserSession } from "../lib/auth";
import { requireRole } from "../lib/authz";
import { alertRemoteFailure } from "../lib/field-mode";
import {
  autoCloseExpiredSessions,
  closeSession,
  getTodaySessions,
  upsertSessionWindow,
} from "../lib/session-manager";

type SessionType = "AM" | "PM";
type SessionRow = {
  id: string;
  session_date: string;
  session_type: SessionType;
  status: "OPEN" | "CLOSED";
  start_time: string | null;
  late_time: string | null;
  cutoff_time: string | null;
};

const getLocalDateString = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export default function SessionManagement() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [configModal, setConfigModal] = useState<{
    show: boolean;
    type: SessionType | null;
    mode: "create" | "edit";
    sessionId?: string;
  }>({ show: false, type: null, mode: "create" });
  const [times, setTimes] = useState({ start: "", late: "", cutoff: "" });
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      const user = await requireRole(
        router,
        ["admin", "officer"],
        "Cadets are not allowed to manage sessions.",
      );
      if (!user) return;
      setCurrentUser(user);
      await fetchSessions();
      setLoading(false);
    };
    bootstrap();
  }, [router]);

  const fetchSessions = async () => {
    const today = getLocalDateString();
    await autoCloseExpiredSessions(today);
    const list = await getTodaySessions();
    setSessions(
      list
        .filter((s) => s.session_date === today)
        .sort((a, b) =>
          a.session_type.localeCompare(b.session_type),
        ) as SessionRow[],
    );
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshTimer = setInterval(() => {
      fetchSessions();
    }, 15000);
    return () => clearInterval(refreshTimer);
  }, []);

  const handleOpenRequest = (type: SessionType, session?: SessionRow) => {
    if (currentUser?.role !== "admin") {
      Alert.alert(
        "Restricted",
        "Only admin can open, close, or edit session windows.",
      );
      return;
    }
    setTimes({
      start:
        session?.start_time?.slice(0, 5) || (type === "AM" ? "06:00" : "13:00"),
      late:
        session?.late_time?.slice(0, 5) || (type === "AM" ? "06:15" : "13:15"),
      cutoff:
        session?.cutoff_time?.slice(0, 5) ||
        (type === "AM" ? "08:30" : "17:00"),
    });
    setConfigModal({
      show: true,
      type,
      mode: session ? "edit" : "create",
      sessionId: session?.id,
    });
  };

  const toggleSession = async (
    type: SessionType,
    currentStatus?: string,
    sessionId?: string,
  ) => {
    if (currentUser?.role !== "admin") {
      Alert.alert(
        "Restricted",
        "Only admin can open, close, or edit session windows.",
      );
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const today = getLocalDateString();

    if (currentStatus === "OPEN") {
      if (!sessionId) {
        Alert.alert("Error", "Missing session ID.");
        return;
      }
      // Close session + auto mark all non-scanned cadets as absent
      const result = await closeSession(sessionId);
      if (!result.success) {
        alertRemoteFailure(
          "Could not close session",
          result.error || "Could not close session",
        );
      } else {
        Alert.alert(
          "Session Closed",
          `Session closed successfully. Auto-marked absent: ${result.absentsMarked}`,
        );
      }
    } else {
      // Validate times
      const timeRegex = /^([01]\d|2[0-3]):?([0-5]\d)$/;
      if (
        !timeRegex.test(times.start) ||
        !timeRegex.test(times.late) ||
        !timeRegex.test(times.cutoff)
      ) {
        Alert.alert("Invalid Format", "Please use military format (HH:MM)");
        return;
      }

      const payload: {
        session_date: string;
        session_type: SessionType;
        status: "OPEN";
        start_time: string;
        late_time: string;
        cutoff_time: string;
      } = {
        session_date: today,
        session_type: type,
        status: "OPEN",
        start_time: times.start,
        late_time: times.late,
        cutoff_time: times.cutoff,
      };
      const result = await upsertSessionWindow({ sessionId, payload });

      if (!result.success) {
        if (
          result.error?.includes("duplicate") ||
          result.error?.includes("already exists")
        ) {
          Alert.alert("Conflict", "This session already exists.");
        } else {
          alertRemoteFailure(
            "Could not save session",
            result.error || "Could not save session.",
          );
        }
      } else {
        if (result.queuedOffline) {
          Alert.alert(
            "Saved Offline",
            "Session change was saved locally and will sync when internet is back.",
          );
        }
        setConfigModal({
          show: false,
          type: null,
          mode: "create",
          sessionId: undefined,
        });
      }
    }
    fetchSessions();
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case "OPEN":
        return {
          bg: "#E8F5E9",
          text: "#2E7D32",
          icon: <CheckCircle2 size={16} color="#2E7D32" />,
        };
      case "CLOSED":
        return {
          bg: "#F5F5F5",
          text: "#757575",
          icon: <Power size={16} color="#757575" />,
        };
      default:
        return {
          bg: "#FFF3E0",
          text: "#EF6C00",
          icon: <AlertCircle size={16} color="#EF6C00" />,
        };
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#1F3D2B", "#2C533A"]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.6} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>ATTENDANCE WINDOWS</Text>
          <Text style={styles.headerSub}>{now.toLocaleString()}</Text>
        </View>
      </LinearGradient>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 50 }} color="#1F3D2B" />
      ) : (
        <ScrollView style={styles.content}>
          <Text style={styles.sectionLabel}>Daily Schedule</Text>

          {(["AM", "PM"] as SessionType[]).map((type) => {
            const session = sessions.find((s) => s.session_type === type);
            const statusInfo = getStatusStyle(session?.status || "NOT_STARTED");

            return (
              <View key={type} style={styles.sessionCard}>
                <View style={styles.sessionInfo}>
                  <View style={styles.timeCircle}>
                    <Clock color="#1F3D2B" size={24} />
                  </View>
                  <View style={{ marginLeft: 16 }}>
                    <Text style={styles.sessionType}>{type} Formation</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: statusInfo.bg },
                      ]}
                    >
                      {statusInfo.icon}
                      <Text
                        style={[styles.statusText, { color: statusInfo.text }]}
                      >
                        {session?.status || "NOT STARTED"}
                      </Text>
                    </View>
                    <Text style={styles.metaText}>
                      DATE: {session?.session_date || getLocalDateString(now)} |
                      TYPE: {type}
                    </Text>
                  </View>
                </View>

                {session?.status === "OPEN" && (
                  <View style={styles.timeDetails}>
                    <View style={styles.timeItem}>
                      <Text style={styles.timeLabel}>START</Text>
                      <Text style={styles.timeValue}>
                        {session.start_time?.slice(0, 5)}
                      </Text>
                    </View>
                    <View style={styles.timeItem}>
                      <Text style={styles.timeLabel}>LATE</Text>
                      <Text style={styles.timeValue}>
                        {session.late_time?.slice(0, 5)}
                      </Text>
                    </View>
                    <View style={[styles.timeItem, { borderRightWidth: 0 }]}>
                      <Text style={styles.timeLabel}>CUTOFF</Text>
                      <Text style={styles.timeValue}>
                        {session.cutoff_time?.slice(0, 5)}
                      </Text>
                    </View>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor:
                        currentUser?.role !== "admin"
                          ? "#C9CEC9"
                          : session?.status === "OPEN"
                            ? "#A52A2A"
                            : session?.status === "CLOSED"
                              ? "#EEE"
                              : "#1F3D2B",
                    },
                  ]}
                  onPress={() =>
                    session?.status === "OPEN"
                      ? toggleSession(type, "OPEN", session.id)
                      : handleOpenRequest(type, session)
                  }
                  disabled={currentUser?.role !== "admin"}
                >
                  <Text
                    style={[
                      styles.actionBtnText,
                      {
                        color: currentUser?.role !== "admin" ? "#999" : "#FFF",
                      },
                    ]}
                  >
                    {currentUser?.role !== "admin"
                      ? "ADMIN ONLY"
                      : session?.status === "OPEN"
                        ? "CLOSE WINDOW"
                        : session?.status === "CLOSED"
                          ? "RE-OPEN WINDOW"
                          : "OPEN WINDOW"}
                  </Text>
                </TouchableOpacity>
                {currentUser?.role === "admin" &&
                  session?.status === "OPEN" && (
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => handleOpenRequest(type, session)}
                    >
                      <Text style={styles.secondaryBtnText}>EDIT TIMES</Text>
                    </TouchableOpacity>
                  )}
              </View>
            );
          })}

          <Modal
            visible={configModal.show}
            transparent={true}
            animationType="slide"
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>
                  CONFIGURE {configModal.type} SESSION
                </Text>
                <Text style={styles.modalSub}>
                  Use 24-hour military format (HH:MM)
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>FORMATION START</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={times.start}
                    onChangeText={(t) => setTimes({ ...times, start: t })}
                    placeholder="06:00"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>LATE TIME MARKER</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={times.late}
                    onChangeText={(t) => setTimes({ ...times, late: t })}
                    placeholder="06:30"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>CUTOFF TIME</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={times.cutoff}
                    onChangeText={(t) => setTimes({ ...times, cutoff: t })}
                    placeholder="08:00"
                  />
                </View>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() =>
                      setConfigModal({
                        show: false,
                        type: null,
                        mode: "create",
                        sessionId: undefined,
                      })
                    }
                  >
                    <Text style={styles.cancelBtnText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.confirmBtn}
                    onPress={() =>
                      toggleSession(
                        configModal.type as SessionType,
                        undefined,
                        configModal.sessionId,
                      )
                    }
                  >
                    <Text style={styles.confirmBtnText}>
                      {configModal.mode === "edit"
                        ? "SAVE CHANGES"
                        : "OPEN WINDOW"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          <View style={styles.infoBox}>
            <AlertCircle color="#1F3D2B" size={20} />
            <Text style={styles.infoText}>
              Session system is AM/PM based with real-time date and military
              time format. Only admin can open, close, or edit session windows.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9F7" },
  header: {
    paddingTop: 60,
    paddingBottom: 30,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: { marginRight: 20 },
  headerTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },
  headerSub: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 2 },

  content: { padding: 24 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "900",
    color: "#A0B3A6",
    letterSpacing: 1.5,
    marginBottom: 20,
  },

  sessionCard: {
    backgroundColor: "#FFF",
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#EAECE6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  sessionInfo: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  timeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#F0F4F1",
    alignItems: "center",
    justifyContent: "center",
  },
  sessionType: { fontSize: 18, fontWeight: "800", color: "#1F3D2B" },
  metaText: { marginTop: 8, fontSize: 10, fontWeight: "700", color: "#6E7A71" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  statusText: {
    fontSize: 10,
    fontWeight: "900",
    marginLeft: 4,
    letterSpacing: 0.5,
  },

  actionBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  actionBtnText: { fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  secondaryBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#1F3D2B",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: "#1F3D2B",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.5,
  },

  infoBox: {
    flexDirection: "row",
    backgroundColor: "#E8EDEA",
    padding: 20,
    borderRadius: 16,
    marginTop: 10,
  },
  infoText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 12,
    color: "#4A5D4E",
    lineHeight: 18,
    fontWeight: "500",
  },

  timeDetails: {
    flexDirection: "row",
    backgroundColor: "#F8F9F7",
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#EAECE6",
  },
  timeItem: {
    flex: 1,
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: "#EAECE6",
  },
  timeLabel: {
    fontSize: 8,
    fontWeight: "900",
    color: "#A0B3A6",
    marginBottom: 2,
  },
  timeValue: { fontSize: 14, fontWeight: "800", color: "#1F3D2B" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#1F3D2B",
    textAlign: "center",
  },
  modalSub: {
    fontSize: 12,
    color: "#A0B3A6",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 24,
  },
  inputGroup: { marginBottom: 16 },
  inputLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#A0B3A6",
    marginBottom: 8,
    letterSpacing: 1,
  },
  timeInput: {
    backgroundColor: "#F8F9F7",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    fontWeight: "700",
    color: "#1F3D2B",
    borderWidth: 1,
    borderColor: "#EAECE6",
  },
  modalActions: { flexDirection: "row", marginTop: 24 },
  cancelBtn: { flex: 1, paddingVertical: 16, alignItems: "center" },
  cancelBtnText: { color: "#6E7A71", fontWeight: "800" },
  confirmBtn: {
    flex: 2,
    backgroundColor: "#1F3D2B",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: "#1F3D2B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  confirmBtnText: { color: "#FFF", fontWeight: "900", letterSpacing: 1 },
});
