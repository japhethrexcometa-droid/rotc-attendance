import { LinearGradient } from "expo-linear-gradient";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Search,
  ShieldAlert,
  ShieldPlus,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { hashPassword } from "../lib/auth";
import { requireRole } from "../lib/authz";
import {
  alertRemoteFailure,
  isLikelyNetworkErrorMessage,
  shouldSilenceRemoteFailureAlerts,
} from "../lib/field-mode";
import { supabase } from "../lib/supabase";

type OfficerRow = {
  id: string;
  id_number: string;
  full_name: string;
  platoon: string | null; // used as position/role in officer imports
  year_level: string | null;
  is_active: boolean;
};

function buildDefaultPassword(idNumber: string) {
  return `ROTC${idNumber.slice(-4)}`;
}

export default function OfficerManagementScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [officers, setOfficers] = useState<OfficerRow[]>([]);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState(false);
  const [newOfficer, setNewOfficer] = useState({
    idNumber: "",
    fullName: "",
    position: "",
    yearLevel: "2025-2026",
  });

  useEffect(() => {
    const bootstrap = async () => {
      const admin = await requireRole(
        router,
        ["admin"],
        "Only admin can manage officer accounts.",
      );
      if (!admin) return;
      await fetchOfficers();
    };
    void bootstrap();
  }, [router]);

  const fetchOfficers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("users")
      .select("id, id_number, full_name, platoon, year_level, is_active")
      .eq("role", "officer")
      .order("full_name", { ascending: true });

    if (error) {
      alertRemoteFailure("Load Failed", error.message);
      setLoading(false);
      return;
    }
    setOfficers((data ?? []) as OfficerRow[]);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return officers;
    return officers.filter(
      (o) =>
        o.full_name.toLowerCase().includes(q) ||
        o.id_number.toLowerCase().includes(q) ||
        (o.platoon ?? "").toLowerCase().includes(q),
    );
  }, [officers, search]);

  const handleToggleActive = async (officer: OfficerRow) => {
    setWorkingId(officer.id);
    const nextValue = !officer.is_active;
    const { error } = await supabase
      .from("users")
      .update({ is_active: nextValue })
      .eq("id", officer.id);

    if (error) {
      alertRemoteFailure("Update Failed", error.message);
      setWorkingId(null);
      return;
    }

    setOfficers((prev) =>
      prev.map((row) =>
        row.id === officer.id ? { ...row, is_active: nextValue } : row,
      ),
    );
    setWorkingId(null);
  };

  const handleResetPassword = async (officer: OfficerRow) => {
    const defaultPassword = buildDefaultPassword(officer.id_number);
    Alert.alert(
      "Reset Officer Password",
      `Reset password for ${officer.full_name} to default format?\n\nNew password: ${defaultPassword}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            try {
              setWorkingId(officer.id);
              const passwordHash = await hashPassword(defaultPassword);
              const { error } = await supabase
                .from("users")
                .update({ password_hash: passwordHash })
                .eq("id", officer.id);
              if (error) throw error;
              Alert.alert(
                "Password Reset",
                `${officer.full_name}'s password was reset.\nNew password: ${defaultPassword}`,
              );
            } catch (err: any) {
              alertRemoteFailure(
                "Reset Failed",
                err?.message || "Could not reset officer password.",
              );
            } finally {
              setWorkingId(null);
            }
          },
        },
      ],
    );
  };

  const handleDeleteOfficer = async (officer: OfficerRow) => {
    Alert.alert(
      "Delete Officer Account",
      `Permanently delete ${officer.full_name} (${officer.id_number})?\n\nThis will remove their account entirely. You can re-add them as a cadet later if needed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setWorkingId(officer.id);
            const { error } = await supabase
              .from("users")
              .delete()
              .eq("id", officer.id);

            if (error) {
              alertRemoteFailure(
                "Delete Failed",
                error.message,
              );
              setWorkingId(null);
              return;
            }

            setOfficers((prev) => prev.filter((row) => row.id !== officer.id));
            setWorkingId(null);
            Alert.alert(
              "Deleted",
              `${officer.full_name} has been removed from the system.`,
            );
          },
        },
      ],
    );
  };

  const handleAddOfficer = async () => {
    if (!newOfficer.idNumber.trim() || !newOfficer.fullName.trim()) {
      Alert.alert("Validation", "ID Number and Full Name are required.");
      return;
    }

    try {
      setAddingOfficer(true);
      const idNumber = newOfficer.idNumber.trim();
      const fullName = newOfficer.fullName.trim();
      const defaultPassword = buildDefaultPassword(idNumber);
      const passwordHash = await hashPassword(defaultPassword);
      const qrToken = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${idNumber}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      );

      const { error } = await supabase.from("users").insert({
        id_number: idNumber,
        full_name: fullName,
        platoon: newOfficer.position.trim() || null,
        year_level: newOfficer.yearLevel.trim() || "2025-2026",
        role: "officer",
        password_hash: passwordHash,
        qr_token: qrToken,
        is_active: true,
      });

      if (error) {
        if (error.code === "42501") {
          alertRemoteFailure(
            "Cannot add officer",
            "Database policy blocked this insert. Check connection or server setup.",
          );
          return;
        }
        if (error.code === "23505") {
          Alert.alert("Duplicate", "ID Number already exists.");
        } else if (
          shouldSilenceRemoteFailureAlerts() ||
          isLikelyNetworkErrorMessage(error.message)
        ) {
          alertRemoteFailure("Cannot add officer", error.message);
        } else {
          Alert.alert("Error", error.message);
        }
        return;
      }

      Alert.alert(
        "Officer Added",
        `Officer account created successfully.\nDefault Password: ${defaultPassword}`,
      );
      setShowAddModal(false);
      setNewOfficer({
        idNumber: "",
        fullName: "",
        position: "",
        yearLevel: "2025-2026",
      });
      fetchOfficers();
    } finally {
      setAddingOfficer(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#1F3D2B", "#2C533A"]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>OFFICER MANAGEMENT</Text>
          <Text style={styles.headerSub}>Admin-only officer account controls</Text>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        <View style={styles.searchWrap}>
          <Search color="#6E7A71" size={18} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, ID, or position"
            placeholderTextColor="#A0B3A6"
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaText}>{filtered.length} OFFICERS</Text>
          <View style={styles.metaActions}>
            <TouchableOpacity onPress={() => setShowAddModal(true)} style={styles.addBtn}>
              <ShieldPlus color="#FFF" size={14} />
              <Text style={styles.addBtnText}>ADD OFFICER</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void fetchOfficers()}>
              <Text style={styles.refreshText}>REFRESH</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color="#1F3D2B" style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => {
              const busy = workingId === item.id;
              return (
                <View style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{item.full_name}</Text>
                      <Text style={styles.details}>
                        {item.id_number} • {item.platoon || "Officer"} •{" "}
                        {item.year_level || "N/A"}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        item.is_active
                          ? styles.statusBadgeActive
                          : styles.statusBadgeInactive,
                      ]}
                    >
                      {item.is_active ? (
                        <CheckCircle2 color="#2E7D32" size={14} />
                      ) : (
                        <ShieldAlert color="#A52A2A" size={14} />
                      )}
                      <Text
                        style={[
                          styles.statusText,
                          item.is_active
                            ? styles.statusTextActive
                            : styles.statusTextInactive,
                        ]}
                      >
                        {item.is_active ? "ACTIVE" : "INACTIVE"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.secondaryBtn]}
                      onPress={() => handleResetPassword(item)}
                      disabled={busy}
                    >
                      <KeyRound color="#1F3D2B" size={14} />
                      <Text style={styles.secondaryBtnText}>RESET PASSWORD</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.actionBtn,
                        item.is_active ? styles.deactivateBtn : styles.activateBtn,
                      ]}
                      onPress={() => void handleToggleActive(item)}
                      disabled={busy}
                    >
                      {item.is_active ? (
                        <UserX color="#FFF" size={14} />
                      ) : (
                        <UserCheck color="#FFF" size={14} />
                      )}
                      <Text style={styles.actionBtnText}>
                        {item.is_active ? "DEACTIVATE" : "ACTIVATE"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {/* Delete button — only for inactive officers */}
                  {!item.is_active && (
                    <TouchableOpacity
                      style={styles.deleteRow}
                      onPress={() => handleDeleteOfficer(item)}
                      disabled={busy}
                    >
                      <Trash2 color="#C62828" size={14} />
                      <Text style={styles.deleteText}>DELETE OFFICER ACCOUNT</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>

      {/* Add Officer Modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Officer Manually</Text>
            <Text style={styles.modalSub}>
              Creates officer account + secure QR token automatically
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="ID Number"
              value={newOfficer.idNumber}
              onChangeText={(t) => setNewOfficer((p) => ({ ...p, idNumber: t }))}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Full Name"
              value={newOfficer.fullName}
              onChangeText={(t) => setNewOfficer((p) => ({ ...p, fullName: t }))}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Position / Platoon (Optional)"
              value={newOfficer.position}
              onChangeText={(t) => setNewOfficer((p) => ({ ...p, position: t }))}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Year Level"
              value={newOfficer.yearLevel}
              onChangeText={(t) => setNewOfficer((p) => ({ ...p, yearLevel: t }))}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={handleAddOfficer}
                disabled={addingOfficer}
              >
                {addingOfficer ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.confirmText}>Create Officer</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9F7" },
  header: {
    paddingTop: 58,
    paddingBottom: 24,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: { marginRight: 14 },
  headerTextWrap: { flex: 1 },
  headerTitle: { color: "#FFF", fontSize: 17, fontWeight: "900", letterSpacing: 1 },
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 4 },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#EAECE6",
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: { flex: 1, height: 44, marginLeft: 8, color: "#1F3D2B" },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  metaActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2F4F8F",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  addBtnText: { fontSize: 10, fontWeight: "900", color: "#FFF", letterSpacing: 0.5 },
  metaText: { fontSize: 11, fontWeight: "900", color: "#8A9A8E", letterSpacing: 1 },
  refreshText: { fontSize: 11, fontWeight: "900", color: "#1F3D2B", letterSpacing: 1 },
  card: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EAECE6",
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  name: { fontSize: 15, fontWeight: "800", color: "#1F3D2B" },
  details: { fontSize: 12, color: "#6E7A71", marginTop: 3 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  statusBadgeActive: { backgroundColor: "#E8F5E9" },
  statusBadgeInactive: { backgroundColor: "#FFEBEE" },
  statusText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  statusTextActive: { color: "#2E7D32" },
  statusTextInactive: { color: "#A52A2A" },
  actionsRow: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  secondaryBtn: {
    backgroundColor: "#EEF3EF",
    borderWidth: 1,
    borderColor: "#D7E0D9",
  },
  secondaryBtnText: { color: "#1F3D2B", fontSize: 11, fontWeight: "900" },
  activateBtn: { backgroundColor: "#2E7D32" },
  deactivateBtn: { backgroundColor: "#A52A2A" },
  actionBtnText: { color: "#FFF", fontSize: 11, fontWeight: "900", letterSpacing: 0.4 },
  // Add Officer Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 18,
  },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#1F3D2B" },
  modalSub: { fontSize: 12, color: "#6E7A71", marginTop: 4, marginBottom: 12 },
  modalInput: {
    backgroundColor: "#F8F9F7",
    borderWidth: 1,
    borderColor: "#EAECE6",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 6 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  cancelText: { color: "#6E7A71", fontWeight: "700" },
  confirmBtn: {
    backgroundColor: "#2F4F8F",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 120,
    alignItems: "center",
  },
  confirmText: { color: "#FFF", fontWeight: "800" },
  deleteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#FFCDD2",
  },
  deleteText: {
    color: "#C62828",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
});
