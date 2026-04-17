import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
    AlertCircle,
    FilePlus,
    FileSpreadsheet,
    ShieldCheck,
    UploadCloud,
} from "lucide-react-native";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { alertRemoteFailure } from "../lib/field-mode";
import { importFromFile } from "../lib/import-service";

export default function ImportView() {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDownloadTemplate = async () => {
    try {
      const fs = FileSystem as any;
      const content = [
        "ID Number,Full Name,Platoon,Year Level,Gender,School",
        "2025-0001,JUAN DELA CRUZ,Alpha,2025-2026,MALE,MSU Buug",
        "2025-0002,JANE REYES,Bravo,2025-2026,FEMALE,St. John",
      ].join("\n");
      const filePath = `${fs.cacheDirectory}rotc-import-template.csv`;
      await FileSystem.writeAsStringAsync(filePath, content, {
        encoding: fs.EncodingType.UTF8,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(filePath, {
          mimeType: "text/csv",
          dialogTitle: "Download ROTC Import Template",
          UTI: "public.comma-separated-values-text",
        });
      } else {
        Alert.alert("Template Ready", filePath);
      }
    } catch (error: any) {
      alertRemoteFailure(
        "Template Error",
        error?.message || "Could not generate template.",
      );
    }
  };

  const handleSimulateImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv"],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setIsProcessing(true);
        const file = result.assets[0];

        const importResult = await importFromFile(file.uri);

        setIsProcessing(false);

        Alert.alert(
          "Import Complete",
          `✅ Inserted: ${importResult.inserted}\n🔄 Updated: ${importResult.updated}\n⚠️ Skipped: ${importResult.skipped}\n❌ Errors: ${importResult.errors.length}`,
          [{ text: "OK" }],
        );
      }
    } catch (error: any) {
      console.error(error);
      setIsProcessing(false);
      alertRemoteFailure("Import Failed", "Failed to import the file: " + error.message);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Bulk Import System</Text>
        <Text style={styles.subtitle}>
          Upload CSV to automatically generate Cadet accounts and
          Digital IDs.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.formatHeader}>
          <FileSpreadsheet color="#1F3D2B" size={24} />
          <Text style={styles.cardTitle}>Required CSV Fields</Text>
        </View>
        <Text style={styles.guideline}>
          • <Text style={styles.bold}>ID Number</Text> (Username)
        </Text>
        <Text style={styles.guideline}>
          • <Text style={styles.bold}>Full Name</Text>
        </Text>
        <Text style={styles.guideline}>
          • <Text style={styles.bold}>Platoon</Text> (Optional)
        </Text>
        <Text style={styles.guideline}>
          • <Text style={styles.bold}>Year Level</Text> (Default: 2025-2026)
        </Text>
        <Text style={styles.guideline}>
          • <Text style={styles.bold}>Gender</Text> (MALE / FEMALE)
        </Text>
        <Text style={styles.guideline}>
          • <Text style={styles.bold}>School</Text> (e.g. MSU Buug, St. John)
        </Text>
      </View>

      <View style={styles.alertBox}>
        <AlertCircle color="#D4A353" size={24} style={{ marginRight: 10 }} />
        <Text style={styles.alertText}>
          Auto process: role=CADET, password auto-generated, duplicate ID
          numbers skipped, and secure QR token created.
        </Text>
      </View>

      {/* Massive Call to Action */}
      <TouchableOpacity
        style={[styles.uploadBigButton, isProcessing && { opacity: 0.8 }]}
        onPress={isProcessing ? undefined : handleSimulateImport}
      >
        {isProcessing ? (
          <ActivityIndicator
            size="large"
            color="#FFF"
            style={{ marginBottom: 15 }}
          />
        ) : (
          <UploadCloud color="#FFF" size={64} style={{ marginBottom: 15 }} />
        )}
        <Text style={styles.uploadBtnTitle}>
          {isProcessing ? "Processing CSV..." : "Select CSV File"}
        </Text>
        <Text style={styles.uploadBtnDesc}>
          {isProcessing
            ? "Validating fields and rows"
            : "Tap to browse from your device"}
        </Text>
      </TouchableOpacity>

      {/* Download Template Button */}
      <TouchableOpacity style={styles.templateButton} onPress={handleDownloadTemplate}>
        <FilePlus color="#1F3D2B" size={20} style={{ marginRight: 10 }} />
        <Text style={styles.templateBtnText}>Download Blank Template</Text>
      </TouchableOpacity>

      {/* Auto Process Info */}
      <View style={styles.processInfoBox}>
        <ShieldCheck color="#4CAF50" size={30} style={{ marginRight: 15 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.processInfoTitle}>Auto-Provisioning Active</Text>
          <Text style={styles.processInfoDesc}>
            Optimized for large uploads (500-1000 rows per run) with batch
            processing and digital ID-ready records.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  header: { marginBottom: 30, marginTop: 20 },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#1F3D2B",
    marginBottom: 8,
  },
  subtitle: { fontSize: 14, color: "#4A5D4E", lineHeight: 20 },

  card: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  formatHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
    paddingBottom: 15,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F3D2B",
    marginLeft: 10,
  },
  guideline: { fontSize: 14, color: "#333", marginBottom: 10 },
  bold: { fontWeight: "bold" },

  alertBox: {
    flexDirection: "row",
    backgroundColor: "#FFF9E6",
    padding: 15,
    borderRadius: 12,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: "#F5E1A4",
    alignItems: "center",
  },
  alertText: { flex: 1, fontSize: 13, color: "#8A6D26", fontWeight: "600" },

  uploadBigButton: {
    backgroundColor: "#1F3D2B",
    borderRadius: 24,
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    shadowColor: "#1F3D2B",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
  uploadBtnTitle: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 5,
  },
  uploadBtnDesc: { color: "#A0B3A6", fontSize: 14, fontWeight: "500" },

  templateButton: {
    backgroundColor: "#EAECE6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    borderRadius: 16,
    marginBottom: 30,
  },
  templateBtnText: { color: "#1F3D2B", fontSize: 16, fontWeight: "bold" },

  processInfoBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 20,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  processInfoTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#111",
    marginBottom: 4,
  },
  processInfoDesc: { fontSize: 12, color: "#666", lineHeight: 18 },
});
