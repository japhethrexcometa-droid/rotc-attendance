import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowLeft, Search } from "lucide-react-native";
import { useEffect, useState, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { UserSession } from "../lib/auth";
import { requireRole } from "../lib/authz";
import { supabase } from "../lib/supabase";

interface CadetScore {
  id: string;
  fullName: string;
  idNumber: string;
  platoon: string | null;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  excusedCount: number;
  totalScore: number;
}

type RiskLevel = "none" | "warning" | "endorse";

function riskForAbsences(absentCount: number): RiskLevel {
  if (absentCount >= 5) return "endorse";
  if (absentCount >= 2 && absentCount <= 3) return "warning";
  return "none";
}

export default function AttendanceScores() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [scores, setScores] = useState<CadetScore[]>([]);
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      const user = await requireRole(
        router,
        ["admin", "officer"],
        "Cadets are not allowed to access scores.",
      );
      if (!user) return;
      setCurrentUser(user);
      fetchScores();
    };
    bootstrap();
  }, [router]);

  const fetchScores = async () => {
    setLoading(true);
    try {
      // Fetch all active cadets
      const { data: usersData, error: usersError } = await supabase
        .from("users")
        .select("id, id_number, full_name, platoon")
        .eq("role", "cadet")
        .eq("is_active", true);

      if (usersError || !usersData) throw usersError;

      // Fetch all attendance
      const { data: attendanceData, error: attError } = await supabase
        .from("attendance")
        .select("cadet_id, status");

      if (attError) throw attError;

      // Map out the scores
      const scoreMap = new Map<string, CadetScore>();

      for (const u of usersData) {
        scoreMap.set(u.id, {
          id: u.id,
          fullName: u.full_name,
          idNumber: u.id_number,
          platoon: u.platoon,
          presentCount: 0,
          lateCount: 0,
          absentCount: 0,
          excusedCount: 0,
          totalScore: 0,
        });
      }

      for (const a of (attendanceData || [])) {
        if (!a.cadet_id || !scoreMap.has(a.cadet_id)) continue;
        const s = scoreMap.get(a.cadet_id)!;
        
        switch (a.status) {
          case "present":
            s.presentCount++;
            s.totalScore += 1.0;
            break;
          case "late":
            s.lateCount++;
            s.totalScore += 0.75;
            break;
          case "absent":
            s.absentCount++;
            // score += 0
            break;
          case "excused":
            s.excusedCount++;
            // score += 0
            break;
        }
      }

      // Format as array and sort by total score DESC, then full name ASC
      const result = Array.from(scoreMap.values()).sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return a.fullName.localeCompare(b.fullName);
      });

      setScores(result);
    } catch (error) {
      console.error("Failed to load scores:", error);
    } finally {
      setLoading(false);
    }
  };

  const adminAlerts = useMemo(() => {
    const warnings = scores.filter((s) => s.absentCount >= 2 && s.absentCount <= 3);
    const endorsements = scores.filter((s) => s.absentCount >= 5 && s.absentCount <= 8);
    const endorsementsOver = scores.filter((s) => s.absentCount > 8);
    return { warnings, endorsements, endorsementsOver };
  }, [scores]);

  const filteredScores = useMemo(() => {
    if (!searchQuery) return scores;
    const q = searchQuery.toLowerCase();
    return scores.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.idNumber.toLowerCase().includes(q) ||
        (c.platoon && c.platoon.toLowerCase().includes(q))
    );
  }, [scores, searchQuery]);

  const riskBadge = (absentCount: number) => {
    const risk = riskForAbsences(absentCount);
    if (risk === "none") return null;
    return (
      <View
        style={[
          styles.riskPill,
          risk === "warning" ? styles.riskWarning : styles.riskEndorse,
        ]}
      >
        <Text style={styles.riskPillText}>
          {risk === "warning" ? "WARNING" : "ENDORSE DROP"}
        </Text>
      </View>
    );
  };

  const renderScoreItem = ({ item, index }: { item: CadetScore, index: number }) => (
    <View style={styles.scoreCard}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>#{index + 1}</Text>
      </View>
      <View style={styles.cadetInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.cadetName} numberOfLines={1}>
            {item.fullName}
          </Text>
          {currentUser?.role === "admin" ? riskBadge(item.absentCount) : null}
        </View>
        <Text style={styles.cadetDetails}>
          {item.idNumber} • {item.platoon || "Unassigned"}
        </Text>
        <View style={styles.metricsRow}>
          <Text style={styles.metricItem}>P: {item.presentCount}</Text>
          <Text style={styles.metricItemLate}>L: {item.lateCount}</Text>
          <Text style={styles.metricItemAbsent}>A: {item.absentCount}</Text>
        </View>
      </View>
      <View style={styles.scoreBox}>
        <Text style={styles.scoreValue}>{item.totalScore.toFixed(2)}</Text>
        <Text style={styles.scoreLabel}>PTS</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#1F3D2B", "#2C533A"]} style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.6} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
            <ArrowLeft color="#FFF" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>LEADERBOARD</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.searchBar}>
          <Search color="rgba(255,255,255,0.6)" size={20} />
          <TextInput 
            style={styles.searchInput}
            placeholder="Search by name or ID..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {currentUser?.role === "admin" ? (
          <View style={styles.alertPanel}>
            <Text style={styles.alertTitle}>ADMIN AWARENESS</Text>
            <Text style={styles.alertSub}>
              WARNING: 2–3 absences • ENDORSE DROP: 5–8 absences
            </Text>

            <View style={styles.alertRow}>
              <View style={[styles.alertChip, styles.alertChipWarn]}>
                <Text style={styles.alertChipLabel}>WARNING</Text>
                <Text style={styles.alertChipValue}>
                  {adminAlerts.warnings.length}
                </Text>
              </View>
              <View style={[styles.alertChip, styles.alertChipEndorse]}>
                <Text style={styles.alertChipLabel}>ENDORSE DROP</Text>
                <Text style={styles.alertChipValue}>
                  {adminAlerts.endorsements.length}
                </Text>
              </View>
            </View>

            {adminAlerts.endorsementsOver.length > 0 ? (
              <Text style={styles.alertNote}>
                Note: {adminAlerts.endorsementsOver.length} cadet(s) have more
                than 8 absences.
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.listHeader}>
          <Text style={styles.countText}>{filteredScores.length} RECORD(S)</Text>
          <View style={styles.legendBox}>
            <Text style={styles.legendText}>P=1.0</Text>
            <Text style={styles.legendText}>L=0.75</Text>
            <Text style={styles.legendText}>A=0</Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 50 }} color="#1F3D2B" size="large" />
        ) : (
          <FlatList
            data={filteredScores}
            renderItem={renderScoreItem}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9F7" },
  header: {
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFF", fontSize: 16, fontWeight: "900", letterSpacing: 2 },
  
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
  },
  searchInput: { flex: 1, marginLeft: 12, color: "#FFF", fontSize: 15 },
  
  content: { flex: 1, paddingHorizontal: 24 },
  alertPanel: {
    marginTop: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#EAECE6",
    borderRadius: 16,
    padding: 14,
  },
  alertTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 1, color: "#1F3D2B" },
  alertSub: { marginTop: 4, fontSize: 11, color: "#6E7A71", fontWeight: "700" },
  alertRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  alertChip: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  alertChipWarn: { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" },
  alertChipEndorse: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  alertChipLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5, color: "#1F3D2B" },
  alertChipValue: { marginTop: 4, fontSize: 18, fontWeight: "900", color: "#1F3D2B" },
  alertNote: { marginTop: 10, fontSize: 11, color: "#A52A2A", fontWeight: "800" },
  listHeader: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center", 
    marginVertical: 20 
  },
  countText: { fontSize: 10, fontWeight: "900", color: "#A0B3A6", letterSpacing: 1 },
  legendBox: {
    flexDirection: "row",
    backgroundColor: "#EAECE6",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 8,
  },
  legendText: { fontSize: 10, fontWeight: "800", color: "#1F3D2B" },
  
  scoreCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EAECE6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  rankBadge: { 
    width: 40, 
    height: 40, 
    borderRadius: 8, 
    backgroundColor: "#1F3D2B", 
    alignItems: "center", 
    justifyContent: "center",
    marginRight: 16
  },
  rankText: { color: "#D4A353", fontSize: 14, fontWeight: "900" },
  cadetInfo: { flex: 1, paddingRight: 10 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cadetName: { fontSize: 15, fontWeight: "800", color: "#1F3D2B" },
  cadetDetails: { fontSize: 11, color: "#8A9A8E", marginTop: 2 },
  metricsRow: { flexDirection: "row", marginTop: 6, gap: 12 },
  metricItem: { fontSize: 11, fontWeight: "700", color: "#2E7D32" },
  metricItemLate: { fontSize: 11, fontWeight: "700", color: "#EF6C00" },
  metricItemAbsent: { fontSize: 11, fontWeight: "700", color: "#C62828" },
  riskPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  riskWarning: { backgroundColor: "#FFF7ED", borderColor: "#FDBA74" },
  riskEndorse: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  riskPillText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.5, color: "#1F3D2B" },
  
  scoreBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0F4F1",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  scoreValue: { fontSize: 18, fontWeight: "900", color: "#1F3D2B" },
  scoreLabel: { fontSize: 9, fontWeight: "800", color: "#A0B3A6", marginTop: 2 }
});
