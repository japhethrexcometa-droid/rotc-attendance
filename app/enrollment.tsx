import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { ArrowLeft, FileSpreadsheet, Upload, CheckCircle2, Info } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  Platform,
} from "react-native";
import { alertRemoteFailure } from "../lib/field-mode";
import { requireRole } from "../lib/authz";
import { downloadFileWeb } from "../lib/web-utils";
import {
  generateOfficerIdNumber,
  importFromFile,
  ImportMode,
  parseExcel,
} from "../lib/import-service";

export default function BulkEnrollment() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("cadet");
  const [lastOfficerSummary, setLastOfficerSummary] = useState("");
  const [lastOfficerMeta, setLastOfficerMeta] = useState({
    inserted: 0,
    skipped: 0,
    errors: 0,
    credentials: 0,
  });

  const formatOfficerRoleSummary = (
    rows: any[],
    insertedIdNumbers: string[],
  ): string => {
    const idSet = new Set(insertedIdNumbers);
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const fullName = String(row["Full Name"] ?? "");
      const year = String(row.Year ?? "");
      const position = String(row["Position/Role"] ?? "").trim() || "Unspecified";
      const officerId = generateOfficerIdNumber(fullName, year);
      if (!idSet.has(officerId)) return;
      counts.set(position, (counts.get(position) ?? 0) + 1);
    });
    if (counts.size === 0) return "No new officer records inserted.";
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([position, count]) => `- ${position}: ${count}`)
      .join("\n");
  };

  const downloadTemplate = async () => {
    try {
      const cadetTemplate = [
        "ID Number,Full Name,Platoon,Year Level",
        "2025-0001,JUAN DELA CRUZ,Alpha,2025-2026",
      ].join("\n");
      const officerTemplate = [
        "Full Name,Position/Role,Year",
        "JUAN DELA CRUZ,Platoon Leader,3rd Year",
      ].join("\n");
      const content = importMode === "cadet" ? cadetTemplate : officerTemplate;
      const filename = `rotc-import-template-${importMode}.csv`;

      if (Platform.OS === "web") {
        downloadFileWeb(filename, content);
        return;
      }

      const fs = FileSystem as any;
      const filePath = `${fs.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(filePath, content, {
        encoding: fs.EncodingType.UTF8,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: "text/csv",
          dialogTitle:
            importMode === "cadet"
              ? "Download Cadet Import Template"
              : "Download Officer Import Template",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("Template Ready", filePath);
      }
    } catch (error: any) {
      Alert.alert("Template Error", error?.message || "Could not generate template.");
    }
  };

  useEffect(() => {
    const enforceAdmin = async () => {
      await requireRole(router, ["admin"], "Only admin can access bulk enrollment.");
    };
    enforceAdmin();
  }, [router]);

  const exportCredentialsCsv = async (
    entries: { id_number: string; full_name: string; raw_password: string }[],
  ) => {
    if (entries.length === 0) return;
    const csvHeader = "ID Number,Full Name,Auto Password\n";
    const csvRows = entries
      .map((entry) => {
        const safeName = `"${entry.full_name.replace(/"/g, '""')}"`;
        return `${entry.id_number},${safeName},${entry.raw_password}`;
      })
      .join("\n");
    const csvContent = `${csvHeader}${csvRows}\n`;
    const filename = `rotc-credentials-${Date.now()}.csv`;

    if (Platform.OS === "web") {
      downloadFileWeb(filename, csvContent);
      return;
    }

    const fs = FileSystem as any;
    const filePath = `${fs.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(filePath, csvContent, { encoding: fs.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(filePath, {
        mimeType: "text/csv",
        dialogTitle: "Share Cadet Credentials Report",
        UTI: "public.comma-separated-values-text",
      });
    } else {
      Alert.alert("Saved", `Credentials report saved at:\n${filePath}`);
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      setLoading(true);
      const file = result.assets[0];
      setFileName(file.name);
      setFileUri(file.uri);

      const { rows, errors } = await parseExcel(file.uri, importMode);
      if (errors.length > 0) {
        Alert.alert("Validation Notes", errors.slice(0, 5).join("\n"));
      }
      setParsedData(rows as any[]);
      setLoading(false);
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Could not process document.");
      setLoading(false);
    }
  };

  const handleEnroll = async () => {
    if (parsedData.length === 0) return;

    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      if (!fileUri) throw new Error("No source file selected.");
      const result = await importFromFile(fileUri, importMode);
      const officerSummary =
        importMode === "officer"
          ? formatOfficerRoleSummary(parsedData, result.insertedIdNumbers)
          : "";
      setLastOfficerSummary(officerSummary);
      if (importMode === "officer") {
        setLastOfficerMeta({
          inserted: result.inserted,
          skipped: result.skipped,
          errors: result.errors.length,
          credentials: result.credentialsReport.length,
        });
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Success",
        `${importMode === "cadet" ? "Cadet" : "Officer"} import complete.\nInserted: ${result.inserted}\nSkipped duplicates: ${result.skipped}\nErrors: ${result.errors.length}${importMode === "officer" ? `\n\nPosition/Role Summary (Inserted):\n${officerSummary}` : ""}`,
        [
          ...(importMode === "officer"
            ? [
                {
                  text: "Copy Summary",
                  onPress: async () => {
                    try {
                      const summaryText = [
                        "ROTC Officer Import Summary",
                        `Inserted: ${result.inserted}`,
                        `Skipped duplicates: ${result.skipped}`,
                        `Errors: ${result.errors.length}`,
                        `Credentials generated: ${result.credentialsReport.length}`,
                        `Digital IDs ready: ${result.inserted}`,
                        "",
                        "Position/Role Summary (Inserted):",
                        officerSummary || "No new officer records inserted.",
                      ].join("\n");
                      await Clipboard.setStringAsync(summaryText);
                      Alert.alert("Copied", "Officer summary copied to clipboard.");
                    } catch (err: any) {
                      alertRemoteFailure(
                        "Copy Failed",
                        err?.message || "Could not copy summary.",
                      );
                    }
                  },
                },
              ]
            : []),
          {
            text: "Download Credentials",
            onPress: async () => {
              try {
                await exportCredentialsCsv(result.credentialsReport);
              } catch (err: any) {
                alertRemoteFailure(
                  "Export Failed",
                  err?.message || "Could not export credentials report.",
                );
              } finally {
                router.back();
              }
            },
          },
          {
            text: importMode === "officer" ? "Open Officer Dashboard" : "Skip",
            onPress: () =>
              importMode === "officer" ? router.replace("/officer") : router.back(),
            style: "cancel",
          },
        ],
      );
    } catch (error: any) {
      console.error(error);
      alertRemoteFailure(
        "Enrollment Failed",
        error.message || "An error occurred during bulk insert.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#1F3D2B", "#2C533A"]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.6} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>BULK ENROLLMENT</Text>
          <Text style={styles.headerSub}>Batch provision cadet accounts</Text>
        </View>
      </LinearGradient>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {importMode === "officer" && lastOfficerSummary ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Last Officer Import Summary</Text>
            <Text style={styles.summaryMeta}>
              Inserted: {lastOfficerMeta.inserted} | Credentials: {lastOfficerMeta.credentials}{"\n"}
              Skipped: {lastOfficerMeta.skipped} | Errors: {lastOfficerMeta.errors}
            </Text>
            <Text style={styles.summaryBody}>{lastOfficerSummary}</Text>
            <TouchableOpacity
              style={styles.summaryCopyBtn}
              onPress={async () => {
                try {
                  await Clipboard.setStringAsync(
                    [
                      "ROTC Officer Import Summary",
                      `Inserted: ${lastOfficerMeta.inserted}`,
                      `Skipped duplicates: ${lastOfficerMeta.skipped}`,
                      `Errors: ${lastOfficerMeta.errors}`,
                      `Credentials generated: ${lastOfficerMeta.credentials}`,
                      `Digital IDs ready: ${lastOfficerMeta.inserted}`,
                      "",
                      "Position/Role Summary (Inserted):",
                      lastOfficerSummary,
                    ].join("\n"),
                  );
                  Alert.alert("Copied", "Summary copied to clipboard.");
                } catch (err: any) {
                  alertRemoteFailure(
                    "Copy Failed",
                    err?.message || "Could not copy summary.",
                  );
                }
              }}
            >
              <Text style={styles.summaryCopyText}>COPY SUMMARY</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.modeSwitch}>
          <TouchableOpacity
            style={[
              styles.modeBtn,
              importMode === "cadet" ? styles.modeBtnActive : null,
            ]}
            onPress={() => {
              setImportMode("cadet");
              setFileName(null);
              setFileUri(null);
              setParsedData([]);
            }}
          >
            <Text
              style={[
                styles.modeBtnText,
                importMode === "cadet" ? styles.modeBtnTextActive : null,
              ]}
            >
              Cadets
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeBtn,
              importMode === "officer" ? styles.modeBtnActive : null,
            ]}
            onPress={() => {
              setImportMode("officer");
              setFileName(null);
              setFileUri(null);
              setParsedData([]);
            }}
          >
            <Text
              style={[
                styles.modeBtnText,
                importMode === "officer" ? styles.modeBtnTextActive : null,
              ]}
            >
              Officers
            </Text>
          </TouchableOpacity>
        </View>
        {!fileName ? (
          <View style={styles.uploadArea}>
            <View style={styles.iconCircle}>
              <FileSpreadsheet color="#1F3D2B" size={48} />
            </View>
            <Text style={styles.uploadTitle}>
              {importMode === "cadet" ? "Import Cadet List" : "Import Officer List"}
            </Text>
            <Text style={styles.uploadSub}>
              Upload a CSV or Excel file containing your unit registry.
            </Text>
            
            <TouchableOpacity style={styles.pickBtn} onPress={pickDocument} disabled={loading}>
              {loading ? <ActivityIndicator color="#FFF" /> : (
                <>
                  <Upload color="#FFF" size={20} style={{ marginRight: 10 }} />
                  <Text style={styles.pickBtnText}>SELECT FILE</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.templateBox}>
              <Info color="#4A5D4E" size={16} />
              <Text style={styles.templateText}>
                {importMode === "cadet"
                  ? "Cadet format: 'ID Number' and 'Full Name'. Optional: 'Platoon', 'Year Level'."
                  : "Officer format: 'Full Name', 'Position/Role', and 'Year'."}
              </Text>
            </View>
            <TouchableOpacity style={styles.templateBtn} onPress={downloadTemplate}>
              <Text style={styles.templateBtnLabel}>DOWNLOAD CSV TEMPLATE</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.previewSection}>
            <View style={styles.fileLabel}>
              <FileSpreadsheet color="#1F3D2B" size={20} />
              <Text style={styles.fileName}>{fileName}</Text>
              <TouchableOpacity onPress={() => { setFileName(null); setFileUri(null); setParsedData([]); }}>
                <Text style={styles.changeText}>Change</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>PREVIEW ({parsedData.length} RECORDS)</Text>
            <View style={styles.table}>
              {parsedData.slice(0, 5).map((row, idx) => (
                <View key={idx} style={styles.tableRow}>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{row["Full Name"]}</Text>
                    <Text style={styles.rowId}>
                      {importMode === "cadet"
                        ? row["ID Number"]
                        : `${row["Position/Role"]} • ${row.Year}`}
                    </Text>
                  </View>
                  <Text style={styles.rowPlatoon}>
                    {importMode === "cadet" ? row["Platoon"] || "N/A" : "Officer"}
                  </Text>
                </View>
              ))}
              {parsedData.length > 5 && (
                <Text style={styles.moreText}>+ {parsedData.length - 5} more records</Text>
              )}
            </View>

            <TouchableOpacity 
              style={[styles.enrollBtn, loading && styles.disabled]} 
              onPress={handleEnroll}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#FFF" /> : (
                <>
                  <CheckCircle2 color="#FFF" size={20} style={{ marginRight: 10 }} />
                  <Text style={styles.enrollBtnText}>PROCEED WITH ENROLLMENT</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9F7" },
  header: { paddingTop: 60, paddingBottom: 32, paddingHorizontal: 24, flexDirection: "row", alignItems: "center" },
  backBtn: { marginRight: 20 },
  headerTitle: { color: "#FFF", fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  headerSub: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 2 },
  
  content: { padding: 24 },
  summaryCard: {
    backgroundColor: "#E8EDEA",
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    marginBottom: 12,
  },
  summaryTitle: { fontSize: 12, fontWeight: "900", color: "#1F3D2B", marginBottom: 8 },
  summaryMeta: { fontSize: 11, color: "#4A5D4E", lineHeight: 16, marginBottom: 8 },
  summaryBody: { fontSize: 12, color: "#2C533A", lineHeight: 18 },
  summaryCopyBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: "#1F3D2B",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  summaryCopyText: { color: "#FFF", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  modeSwitch: {
    flexDirection: "row",
    backgroundColor: "#EAECE6",
    borderRadius: 14,
    padding: 4,
    marginTop: 16,
    marginBottom: 8,
  },
  modeBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  modeBtnActive: { backgroundColor: "#1F3D2B" },
  modeBtnText: { fontSize: 13, fontWeight: "800", color: "#4A5D4E" },
  modeBtnTextActive: { color: "#FFF" },
  uploadArea: {
    backgroundColor: "#FFF",
    borderRadius: 32,
    padding: 40,
    alignItems: "center",
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "#EAECE6",
    marginTop: 20,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#F0F4F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  uploadTitle: { fontSize: 20, fontWeight: "900", color: "#1F3D2B", marginBottom: 8 },
  uploadSub: { fontSize: 13, color: "#8A9A8E", textAlign: "center", lineHeight: 20, marginBottom: 30 },
  pickBtn: {
    flexDirection: "row",
    backgroundColor: "#1F3D2B",
    paddingHorizontal: 30,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: "center",
    shadowColor: "#1F3D2B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  pickBtnText: { color: "#FFF", fontWeight: "900", fontSize: 14, letterSpacing: 1 },
  
  templateBox: {
    flexDirection: "row",
    marginTop: 30,
    padding: 16,
    backgroundColor: "#F8F9F7",
    borderRadius: 12,
  },
  templateText: { flex: 1, fontSize: 11, color: "#4A5D4E", marginLeft: 10, lineHeight: 16, fontWeight: "600" },
  templateBtn: {
    marginTop: 12,
    backgroundColor: "#EAECE6",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  templateBtnLabel: { color: "#1F3D2B", fontWeight: "900", fontSize: 12, letterSpacing: 0.5 },
  
  previewSection: { marginTop: 10 },
  fileLabel: { 
    flexDirection: "row", 
    alignItems: "center", 
    backgroundColor: "#FFF", 
    padding: 16, 
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EAECE6",
    marginBottom: 30
  },
  fileName: { flex: 1, marginLeft: 12, fontSize: 14, fontWeight: "700", color: "#1F3D2B" },
  changeText: { fontSize: 12, fontWeight: "900", color: "#A52A2A" },
  
  sectionLabel: { fontSize: 10, fontWeight: "900", color: "#A0B3A6", letterSpacing: 1, marginBottom: 12 },
  table: { backgroundColor: "#FFF", borderRadius: 20, padding: 10, marginBottom: 30, borderWidth: 1, borderColor: "#EAECE6" },
  tableRow: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center", 
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F8F9F7"
  },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 14, fontWeight: "800", color: "#1F3D2B" },
  rowId: { fontSize: 11, color: "#8A9A8E", marginTop: 2 },
  rowPlatoon: { fontSize: 12, fontWeight: "700", color: "#4A845D" },
  moreText: { textAlign: "center", padding: 12, fontSize: 12, color: "#CCC", fontWeight: "800" },
  
  enrollBtn: {
    flexDirection: "row",
    backgroundColor: "#1F3D2B",
    paddingVertical: 20,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  enrollBtnText: { color: "#FFF", fontWeight: "900", fontSize: 14, letterSpacing: 1 },
  disabled: { opacity: 0.6 },
});
