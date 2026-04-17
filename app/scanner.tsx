import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { ArrowLeft, ShieldCheck, XCircle, Info } from "lucide-react-native";
import { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { getSession } from "../lib/auth";
import { requireRole } from "../lib/authz";
import { getPendingCount } from "../lib/offline-sync";
import { processQRScan } from "../lib/qr-scan-service";
import { getCurrentScannableSession } from "../lib/session-manager";

const { width } = Dimensions.get("window");

export default function QRScanner() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanResult, setScanResult] = useState<{
    success: boolean;
    name?: string;
    message: string;
    type?: "present" | "late" | "error";
  } | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Request permission on mount
  useEffect(() => {
    const checkRole = async () => {
      const user = await requireRole(
        router,
        ["admin", "officer"],
        "Only ROTC officers/admin can access scanner.",
      );
      if (user) {
        setAuthorized(true);
      }
    };
    checkRole();
  }, [router]);

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    getPendingCount().then(setPendingCount).catch(() => {});
  }, []);

  if (!authorized) {
    return <View style={styles.container}><ActivityIndicator color="#1F3D2B" /></View>;
  }

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || isProcessing) return;

    setScanned(true);
    setIsProcessing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const currentUser = await getSession();
      if (!currentUser) {
        throw new Error("Scanner session expired. Please login again.");
      }

      const session = await getCurrentScannableSession();
      if (!session) {
        throw new Error("No active session. Session may be closed or cutoff reached.");
      }

      const beforePending = await getPendingCount();
      const result = await processQRScan({
        qrToken: data,
        session,
        scannedBy: currentUser.id,
      });
      const afterPending = await getPendingCount();
      const savedOffline =
        afterPending > beforePending &&
        (result.outcome === "present" || result.outcome === "late");
      setPendingCount(afterPending);

      if (result.outcome === "present" || result.outcome === "late") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setScanResult({
          success: true,
          name: result.cadet.full_name,
          message:
            result.outcome === "present"
              ? `Present (${result.timestamp})${savedOffline ? " - Pending sync" : ""}`
              : `Late (${result.timestamp})${savedOffline ? " - Pending sync" : ""}`,
          type: result.outcome,
        });
      } else if (result.outcome === "duplicate") {
        throw new Error(`${result.cadet.full_name} is already logged for this session.`);
      } else if (result.outcome === "blocked") {
        throw new Error("Cutoff reached. Session auto-closed and absences were marked.");
      } else if (result.outcome === "invalid") {
        if (result.reason === "bad_token") {
          throw new Error("Invalid QR Code. Cadet not found.");
        }
        if (result.reason === "cadet_mismatch") {
          throw new Error("QR validation failed (cadet/token mismatch).");
        }
        if (result.reason === "self_scan") {
          throw new Error("Self-scan is not allowed.");
        }
        throw new Error("No open session.");
      }
    } catch (error: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScanResult({
        success: false,
        message: error.message || "An error occurred during scanning.",
        type: "error",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const resetScanner = () => {
    setScanned(false);
    setScanResult(null);
  };

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator color="#1F3D2B" /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera access is required to scan QR codes.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      />

      {/* Overlay UI */}
      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft color="#FFF" size={24} />
          </TouchableOpacity>
          <Text style={styles.title}>SCANNER</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.scannerOutline}>
          <View style={styles.cornerTL} />
          <View style={styles.cornerTR} />
          <View style={styles.cornerBL} />
          <View style={styles.cornerBR} />
          {isProcessing && (
            <ActivityIndicator size="large" color="#FFF" />
          )}
        </View>

        <View style={styles.instructionBox}>
          <Info color="rgba(255,255,255,0.7)" size={16} />
          <Text style={styles.instruction}>Align the QR code within the frame</Text>
        </View>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount} pending sync</Text>
          </View>
        )}
      </View>

      {/* Result Modal / Bottom Sheet */}
      {scanResult && (
        <View style={styles.resultContainer}>
          <View style={styles.resultCard}>
            <View style={styles.iconCircle}>
              {scanResult.success ? (
                <ShieldCheck color="#2D5A27" size={48} />
              ) : (
                <XCircle color="#A52A2A" size={48} />
              )}
            </View>
            
            <Text style={[styles.resultStatus, { color: scanResult.success ? "#2D5A27" : "#A52A2A" }]}>
              {scanResult.success ? "VERIFIED" : "FAILED"}
            </Text>
            
            {scanResult.name && (
              <Text style={styles.resultName}>{scanResult.name.toUpperCase()}</Text>
            )}
            
            <Text style={styles.resultMessage}>{scanResult.message}</Text>

            <TouchableOpacity 
              style={[styles.actionBtn, { backgroundColor: scanResult.success ? "#1F3D2B" : "#A52A2A" }]} 
              onPress={resetScanner}
            >
              <Text style={styles.actionBtnText}>CONTINUE SCANNING</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "space-between",
    paddingVertical: 50,
    alignItems: "center",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 2,
  },
  scannerOutline: {
    width: width * 0.7,
    height: width * 0.7,
    justifyContent: "center",
    alignItems: "center",
  },
  cornerTL: { position: "absolute", top: 0, left: 0, width: 40, height: 40, borderTopWidth: 4, borderLeftWidth: 4, borderColor: "#D4A353" },
  cornerTR: { position: "absolute", top: 0, right: 0, width: 40, height: 40, borderTopWidth: 4, borderRightWidth: 4, borderColor: "#D4A353" },
  cornerBL: { position: "absolute", bottom: 0, left: 0, width: 40, height: 40, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: "#D4A353" },
  cornerBR: { position: "absolute", bottom: 0, right: 0, width: 40, height: 40, borderBottomWidth: 4, borderRightWidth: 4, borderColor: "#D4A353" },
  
  instructionBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  instruction: {
    color: "#FFF",
    fontSize: 12,
    marginLeft: 8,
    fontWeight: "600",
  },
  
  resultContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  resultCard: {
    backgroundColor: "#FFF",
    borderRadius: 32,
    width: "100%",
    padding: 30,
    alignItems: "center",
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#F8F9F7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  resultStatus: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 10,
  },
  resultName: {
    fontSize: 20,
    fontWeight: "900",
    color: "#1F3D2B",
    textAlign: "center",
    marginBottom: 8,
  },
  resultMessage: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 30,
  },
  actionBtn: {
    width: "100%",
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: "center",
  },
  actionBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  errorText: { color: "#FFF", marginBottom: 20 },
  btn: { backgroundColor: "#1F3D2B", padding: 15, borderRadius: 10 },
  btnText: { color: "#FFF", fontWeight: "bold" },
  pendingBadge: {
    position: "absolute",
    bottom: 120,
    backgroundColor: "rgba(245,124,0,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  pendingBadgeText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});
