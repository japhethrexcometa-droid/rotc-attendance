import * as Crypto from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  CheckCircle2,
  Filter,
  Search,
  UserCheck,
  UserPlus,
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
import type { UserSession } from "../lib/auth";
import { requireRole } from "../lib/authz";
import {
  alertRemoteFailure,
  isLikelyNetworkErrorMessage,
  shouldSilenceRemoteFailureAlerts,
} from "../lib/field-mode";
import { supabase } from "../lib/supabase";
import { confirmAction } from "../lib/web-utils";

type CadetRow = {
  id: string;
  id_number: string;
  full_name: string;
  platoon: string | null;
  year_level: string | null;
  gender: string | null;
  school: string | null;
  is_active: boolean;
};

type FilterMode = "all" | "active" | "dropped";

export default function CadetRegistry() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [cadets, setCadets] = useState<CadetRow[]>([]);
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingCadet, setAddingCadet] = useState(false);
  const [newCadet, setNewCadet] = useState({
    idNumber: "",
    fullName: "",
    platoon: "",
    yearLevel: "2025-2026",
    gender: "",
    school: "",
  });

  const [confirmProp, setConfirmProp] = useState<{
    title: string;
    message: string;
    onConfirm?: () => void;
    confirmText: string;
    danger?: boolean;
    hideCancel?: boolean;
  } | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      const user = await requireRole(
        router,
        ["admin", "officer"],
        "Cadets are not allowed to access registry.",
      );
      if (!user) return;
      setCurrentUser(user);
      fetchCadets();
    };
    bootstrap();
  }, [router]);

  const fetchCadets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("users")
      .select("id, id_number, full_name, platoon, year_level, gender, school, is_active")
      .eq("role", "cadet")
      .eq("is_deleted", false)
      .order("full_name", { ascending: true });

    if (!error && data) {
      setCadets(data as CadetRow[]);
    } else if (error) {
      alertRemoteFailure("Load Failed", error.message);
    }
    setLoading(false);
  };

  // Soft-deactivate (DROP) or re-activate (RECOVER) a cadet
  const handleToggleActive = async (cadet: CadetRow) => {
    if (currentUser?.role !== "admin") {
      Alert.alert("Not allowed", "Only Admin can update cadet status.");
      return;
    }

    const isDropping = cadet.is_active;

    setConfirmProp({
      title: isDropping ? "Drop Cadet" : "Re-activate Cadet",
      message: isDropping
        ? `Mark ${cadet.full_name} as DROPPED?\n\nTheir attendance history is preserved. You can re-activate them anytime if they return.`
        : `Re-activate ${cadet.full_name}?\n\nThey will be restored as an active cadet and can scan QR again.`,
      confirmText: isDropping ? "Drop" : "Re-activate",
      danger: isDropping,
      onConfirm: async () => {
        setWorkingId(cadet.id);
        const { error } = await supabase
          .from("users")
          .update({ is_active: !cadet.is_active })
          .eq("id", cadet.id);

        if (error) {
          alertRemoteFailure("Update Failed", error.message);
          setWorkingId(null);
          return;
        }

        setCadets((prev) =>
          prev.map((row) =>
            row.id === cadet.id ? { ...row, is_active: !cadet.is_active } : row,
          ),
        );
        setWorkingId(null);
      }
    });
  };

  const handleDeleteCadet = async (cadet: CadetRow) => {
    if (currentUser?.role !== "admin") {
      Alert.alert("Not allowed", "Only Admin can delete cadet accounts.");
      return;
    }
    
    setConfirmProp({
      title: "Delete Cadet Account",
      message: `Delete ${cadet.full_name}?\n\nThis will remove them from the registry and disable QR/login. Attendance history will be preserved.`,
      confirmText: "Delete",
      danger: true,
      onConfirm: async () => {
        setWorkingId(cadet.id);
        const { error } = await supabase
          .from("users")
          .update({
            is_deleted: true,
            is_active: false,
            password_hash: null,
            qr_token: null,
          })
          .eq("id", cadet.id);

        if (error) {
          alertRemoteFailure("Delete Failed", error.message);
          setWorkingId(null);
          return;
        }

        setCadets((prev) => prev.filter((row) => row.id !== cadet.id));
        setWorkingId(null);
      }
    });
  };

  const handleDeleteAll = async () => {
    if (currentUser?.role !== "admin") return;
    if (filteredCadets.length === 0) return;

    setConfirmProp({
      title: "⚠️ WIPE REGISTRY",
      message: `You are about to bulk-delete ALL ${filteredCadets.length} currently listed cadets. This will destroy their digital IDs and login access.\n\nUse this only if you need to wipe them out to re-import a clean batch.\n\nAre you absolutely sure?`,
      confirmText: "YES, WIPE THEM",
      danger: true,
      onConfirm: async () => {
        setLoading(true);
        // Collect all IDs to delete
        const idsToDelete = filteredCadets.map(c => c.id);

        // Supabase limits bulk IN queries slightly, but a few hundred is fine.
        const { error } = await supabase
          .from("users")
          .update({
            is_deleted: true,
            is_active: false,
            password_hash: null,
            qr_token: null,
          })
          .in("id", idsToDelete);

        if (error) {
          alertRemoteFailure("Bulk Delete Failed", error.message);
        } else {
          // Remove them from local state
          const idSet = new Set(idsToDelete);
          setCadets(prev => prev.filter(c => !idSet.has(c.id)));
        }
        setLoading(false);
      }
    });
  };

  const filteredCadets = useMemo(() => {
    let list = cadets;
    if (filterMode === "active") list = list.filter((c) => c.is_active);
    if (filterMode === "dropped") list = list.filter((c) => !c.is_active);

    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.id_number.toLowerCase().includes(q) ||
        (c.platoon ?? "").toLowerCase().includes(q) ||
        (c.school ?? "").toLowerCase().includes(q),
    );
  }, [cadets, searchQuery, filterMode]);

  const activeCount = cadets.filter((c) => c.is_active).length;
  const droppedCount = cadets.filter((c) => !c.is_active).length;

  const handleAddCadet = async () => {
    if (currentUser?.role !== "admin") {
      setConfirmProp({ title: "Not allowed", message: "Only Admin can add cadets.", confirmText: "OK", hideCancel: true });
      return;
    }
    if (!newCadet.idNumber.trim() || !newCadet.fullName.trim()) {
      setConfirmProp({ title: "Validation Error", message: "ID Number and Full Name are required.", confirmText: "OK", hideCancel: true });
      return;
    }
    try {
      setAddingCadet(true);
      const idNumber = newCadet.idNumber.trim();
      const fullName = newCadet.fullName.trim();
      const defaultPassword = `ROTC${idNumber.slice(-4)}`;
      const passwordHash = await hashPassword(defaultPassword);
      const qrToken = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `${idNumber}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      );

      const { error } = await supabase.from("users").insert({
        id_number: idNumber,
        full_name: fullName,
        platoon: newCadet.platoon.trim() || null,
        year_level: newCadet.yearLevel.trim() || "2025-2026",
        gender: newCadet.gender || null,
        school: newCadet.school.trim() || null,
        role: "cadet",
        password_hash: passwordHash,
        qr_token: qrToken,
        is_active: true,
      });

      if (error) {
        if (error.code === "42501") {
          setConfirmProp({ title: "Cannot add cadet", message: "Database policy blocked this insert. Check connection or server setup.", confirmText: "OK", hideCancel: true });
          return;
        }
        if (error.code === "23505") {
          setConfirmProp({ title: "Duplicate", message: "ID Number already exists.", confirmText: "OK", hideCancel: true });
        } else if (
          shouldSilenceRemoteFailureAlerts() ||
          isLikelyNetworkErrorMessage(error.message)
        ) {
          alertRemoteFailure("Cannot add cadet", error.message);
        } else {
          setConfirmProp({ title: "Error", message: error.message, confirmText: "OK", hideCancel: true });
        }
        return;
      }

      setConfirmProp({
        title: "Cadet Added",
        message: `Cadet created successfully.\nDefault Password: ${defaultPassword}`,
        confirmText: "OK",
        hideCancel: true
      });
      setShowAddModal(false);
      setNewCadet({ idNumber: "", fullName: "", platoon: "", yearLevel: "2025-2026", gender: "", school: "" });
      fetchCadets();
    } finally {
      setAddingCadet(false);
    }
  };

  const renderItem = ({ item }: { item: CadetRow }) => {
    const busy = workingId === item.id;
    return (
      <View style={[styles.card, !item.is_active && styles.cardDropped]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.full_name}</Text>
            <Text style={styles.details}>
              {item.id_number}
              {item.platoon ? ` • ${item.platoon}` : ""}
              {item.school ? ` • ${item.school}` : ""}
            </Text>
            {item.gender ? (
              <Text style={styles.subDetails}>{item.gender}</Text>
            ) : null}
          </View>
          <View
            style={[
              styles.statusBadge,
              item.is_active ? styles.badgeActive : styles.badgeDropped,
            ]}
          >
            {item.is_active ? (
              <CheckCircle2 color="#2E7D32" size={13} />
            ) : (
              <UserX color="#A52A2A" size={13} />
            )}
            <Text
              style={[
                styles.statusText,
                item.is_active ? styles.statusActive : styles.statusDropped,
              ]}
            >
              {item.is_active ? "ACTIVE" : "DROPPED"}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          {currentUser?.role === "admin" ? (
            <TouchableOpacity
              style={[
                styles.toggleBtn,
                styles.actionFlex,
                item.is_active ? styles.dropBtn : styles.recoverBtn,
              ]}
              onPress={() => handleToggleActive(item)}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : item.is_active ? (
                <>
                  <UserX color="#FFF" size={14} />
                  <Text style={styles.toggleBtnText}>MARK AS DROPPED</Text>
                </>
              ) : (
                <>
                  <UserCheck color="#FFF" size={14} />
                  <Text style={styles.toggleBtnText}>RE-ACTIVATE</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}

          {currentUser?.role === "admin" ? (
            <TouchableOpacity
              style={[styles.deleteBtn, styles.actionFlex]}
              onPress={() => handleDeleteCadet(item)}
              disabled={busy}
            >
              <Text style={styles.deleteBtnText}>DELETE</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#1F3D2B", "#2C533A"]} style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.6} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
            <ArrowLeft color="#FFF" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>CADET REGISTRY</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Search color="rgba(255,255,255,0.6)" size={20} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, ID, school..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </LinearGradient>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(["all", "active", "dropped"] as FilterMode[]).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.filterTab, filterMode === mode && styles.filterTabActive]}
            onPress={() => setFilterMode(mode)}
          >
            <Text
              style={[styles.filterTabText, filterMode === mode && styles.filterTabTextActive]}
            >
              {mode === "all"
                ? `ALL (${cadets.length})`
                : mode === "active"
                  ? `ACTIVE (${activeCount})`
                  : `DROPPED (${droppedCount})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.content}>
        <View style={styles.listHeader}>
          <Text style={styles.countText}>{filteredCadets.length} RECORD(S)</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {currentUser?.role === "admin" && filteredCadets.length > 0 ? (
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: "#FFEBEE" }]}
                onPress={handleDeleteAll}
              >
                <UserX color="#A52A2A" size={16} />
                <Text style={[styles.addBtnText, { color: "#A52A2A" }]}>WIPE ALL</Text>
              </TouchableOpacity>
            ) : null}

            {currentUser?.role === "admin" ? (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => setShowAddModal(true)}
              >
                <UserPlus color="#1F3D2B" size={16} />
                <Text style={styles.addBtnText}>ADD CADET</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 50 }} color="#1F3D2B" size="large" />
        ) : (
          <FlatList
            data={filteredCadets}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            initialNumToRender={20}
            maxToRenderPerBatch={30}
            updateCellsBatchingPeriod={50}
            windowSize={5}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Filter color="#CCC" size={40} />
                <Text style={styles.emptyText}>No cadets found.</Text>
              </View>
            }
          />
        )}
      </View>

      {/* Add Cadet Modal */}
      <Modal visible={showAddModal && currentUser?.role === "admin"} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Cadet Manually</Text>
            <Text style={styles.modalSub}>
              Creates account + secure QR token automatically
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="ID Number"
              value={newCadet.idNumber}
              onChangeText={(t) => setNewCadet((p) => ({ ...p, idNumber: t }))}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Full Name"
              value={newCadet.fullName}
              onChangeText={(t) => setNewCadet((p) => ({ ...p, fullName: t }))}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Platoon (Optional)"
              value={newCadet.platoon}
              onChangeText={(t) => setNewCadet((p) => ({ ...p, platoon: t }))}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Year Level"
              value={newCadet.yearLevel}
              onChangeText={(t) => setNewCadet((p) => ({ ...p, yearLevel: t }))}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="School (e.g. MSU Buug, St. John)"
              value={newCadet.school}
              onChangeText={(t) => setNewCadet((p) => ({ ...p, school: t }))}
            />

            <Text style={styles.genderLabel}>GENDER</Text>
            <View style={styles.genderRow}>
              {["Male", "Female"].map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.genderBtn, newCadet.gender === g && styles.genderBtnActive]}
                  onPress={() => setNewCadet((p) => ({ ...p, gender: g }))}
                >
                  <Text
                    style={[
                      styles.genderBtnText,
                      newCadet.gender === g && styles.genderBtnTextActive,
                    ]}
                  >
                    {g.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={handleAddCadet}
                disabled={addingCadet}
              >
                {addingCadet ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.confirmText}>Create Cadet</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Web-Reliable Confirm/Alert Modal */}
      <Modal visible={!!confirmProp} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
             <Text style={styles.modalTitle}>{confirmProp?.title}</Text>
             <Text style={styles.modalSub}>{confirmProp?.message}</Text>
             <View style={styles.modalActions}>
               {!confirmProp?.hideCancel && (
                 <TouchableOpacity
                   style={styles.cancelBtn}
                   onPress={() => setConfirmProp(null)}
                 >
                   <Text style={styles.cancelText}>Cancel</Text>
                 </TouchableOpacity>
               )}
               <TouchableOpacity
                 style={[
                   styles.confirmBtn, 
                   confirmProp?.danger ? styles.confirmBtnDanger : styles.confirmBtnSafe
                 ]}
                 onPress={() => {
                   if (confirmProp?.onConfirm) {
                     confirmProp.onConfirm();
                   }
                   setConfirmProp(null);
                 }}
               >
                 <Text style={styles.confirmText}>{confirmProp?.confirmText || "OK"}</Text>
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
  header: { paddingTop: 60, paddingBottom: 24, paddingHorizontal: 24 },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
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

  filterRow: {
    flexDirection: "row",
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EAECE6",
  },
  filterTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  filterTabActive: { borderBottomColor: "#1F3D2B" },
  filterTabText: { fontSize: 10, fontWeight: "800", color: "#A0B3A6", letterSpacing: 0.5 },
  filterTabTextActive: { color: "#1F3D2B" },

  content: { flex: 1, paddingHorizontal: 16 },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 16,
  },
  countText: { fontSize: 10, fontWeight: "900", color: "#A0B3A6", letterSpacing: 1 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAECE6",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 6,
  },
  addBtnText: { fontSize: 10, fontWeight: "900", color: "#1F3D2B" },

  card: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EAECE6",
    padding: 14,
    marginBottom: 10,
  },
  cardDropped: {
    backgroundColor: "#FFF9F9",
    borderColor: "#FFCDD2",
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  name: { fontSize: 15, fontWeight: "800", color: "#1F3D2B" },
  details: { fontSize: 12, color: "#6E7A71", marginTop: 3 },
  subDetails: { fontSize: 11, color: "#A0B3A6", marginTop: 2 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    marginLeft: 8,
  },
  badgeActive: { backgroundColor: "#E8F5E9" },
  badgeDropped: { backgroundColor: "#FFEBEE" },
  statusText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  statusActive: { color: "#2E7D32" },
  statusDropped: { color: "#A52A2A" },

  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingVertical: 10,
    gap: 6,
  },
  actionsRow: { flexDirection: "row", gap: 10 },
  actionFlex: { flex: 1 },
  dropBtn: { backgroundColor: "#A52A2A" },
  recoverBtn: { backgroundColor: "#2E7D32" },
  toggleBtnText: { color: "#FFF", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  deleteBtn: {
    borderWidth: 1,
    borderColor: "#A52A2A",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
  },
  deleteBtnText: { color: "#A52A2A", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },

  emptyBox: { alignItems: "center", marginTop: 60, gap: 12 },
  emptyText: { color: "#CCC", fontSize: 14, fontWeight: "700" },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: { backgroundColor: "#FFF", borderRadius: 16, padding: 18 },
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
    backgroundColor: "#1F3D2B",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 120,
    alignItems: "center",
  },
  confirmBtnDanger: {
    backgroundColor: "#A52A2A",
  },
  confirmBtnSafe: {
    backgroundColor: "#2E7D32",
  },
  confirmText: { color: "#FFF", fontWeight: "800" },
  genderLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4A5568",
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 6,
  },
  genderRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  genderBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#CBD5E0",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  genderBtnActive: { borderColor: "#1F3D2B", backgroundColor: "#EAF2EC" },
  genderBtnText: { fontWeight: "700", color: "#6E7A71", fontSize: 13 },
  genderBtnTextActive: { color: "#1F3D2B" },
});
