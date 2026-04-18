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
import { processQRScan, populateCadetCache } from "../lib/qr-scan-service";
import { getCachedScannableSession, getCurrentScannableSession } from "../lib/session-manager";
import { isFieldModeStrictSync, isOnlineSync } from "../lib/field-mode";

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
  const [activeSessionType, setActiveSessionType] = useState<string | null>(null);

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
    getCurrentScannableSession().then((session) => {
      if (session) {
        setActiveSessionType(session.session_type);
      }
    }).catch(() => {});
    // Pre-populate cadet cache while online so scanning works offline
    populateCadetCache().catch(() => {});
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

      // Fast offline path: skip Supabase and use cached session directly
      const isOffline = isFieldModeStrictSync() || isOnlineSync() === false ||
        (typeof window !== "undefined" && !navigator.onLine);

      let session;
      if (isOffline) {
        session = await getCachedScannableSession();
        // Validate cached session is still in-time
        if (session) {
          const now = new Date();
          const nowMins = now.getHours() * 60 + now.getMinutes();
          const cutoffParts = session.cutoff_time.split(":");
          const cutoffMins = Number(cutoffParts[0]) * 60 + Number(cutoffParts[1]);
          if (nowMins >= cutoffMins) session = null;
        }
      } else {
        session = await getCurrentScannableSession();
      }
      if (!session) {
        throw new Error("No active session. Session may be closed or cutoff reached.");
      }

      const beforePending = await getPendingCount();
      const result = await processQRScan({
        qrToken: data,
        session,
        scannedBy: currentUser.id,
        scannedByRole: currentUser.role,
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
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setScanResult({
            success: false,
            name: result.cadet?.full_name,
            message: "Self-scan is not allowed.",
            type: "error",
          });
          return;
        }
        if (result.reason === "officer_scanned_officer") {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setScanResult({
            success: false,
            name: result.cadet?.full_name,
            message: "Only the Admin can scan Officers.",
            type: "error",
          });
          return;
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
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      >
        {/* Professional Military Scanner Mask */}
        <View style={styles.maskContainer}>
          <View style={styles.maskRow}>
            {/* Top Bar inside mask so it's above the camera */}
            <View style={styles.topBar}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.6} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                <ArrowLeft color="#FFF" size={24} />
              </TouchableOpacity>
              <Text style={styles.title}>SCANNER {activeSessionType ? `(${activeSessionType})` : ""}</Text>
              <View style={{ width: 40 }} />
            </View>
          </View>
          
          <View style={styles.maskCenter}>
            <View style={styles.maskCol} />
            <View style={styles.scanHole}>
              {/* Corner brackets */}
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            <View style={styles.maskCol} />
          </View>
          
          <View style={[styles.maskRow, styles.bottomMask]}>
            <Text style={styles.scanInstruction}>
              ALIGN QR CODE IN FRAME
            </Text>
            {isProcessing && (
              <ActivityIndicator size="large" color="#FFF" style={{ marginTop: 20 }} />
            )}
          </View>
        </View>

        {/* Pending sync badge */}
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount} pending sync</Text>
          </View>
        )}

        {/* Feedback Banner matching Officer Scanner */}
        {scanResult && (
          <View style={[
            styles.feedbackBanner, 
            scanResult.success ? (scanResult.type === "present" ? styles.bgSuccess : styles.bgWarning) : styles.bgError
          ]}>
            {scanResult.success ? (
              <ShieldCheck color="#FFF" size={30} />
            ) : (
              <XCircle color="#FFF" size={30} />
            )}

            <View style={styles.feedbackTextGroup}>
              {scanResult.name && (
                <Text style={styles.feedbackName}>{scanResult.name}</Text>
              )}
              <Text style={styles.feedbackStatus}>{scanResult.message}</Text>
            </View>

            {/* Tap anywhere to continue */}
            <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={resetScanner} />
          </View>
        )}
      </CameraView>
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
  errorText: {
    color: "#FFF",
    textAlign: "center",
    marginBottom: 20,
    fontSize: 16,
  },
  btn: {
    backgroundColor: "#F9A826",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnText: {
    color: "#1F3D2B",
    fontWeight: "bold",
    fontSize: 16,
  },
  maskContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  maskRow: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  maskCenter: {
    flexDirection: "row",
    height: 260,
  },
  maskCol: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  scanHole: {
    width: 260,
    height: 260,
    backgroundColor: "transparent",
  },
  bottomMask: {
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 30,
  },
  scanInstruction: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 2,
    backgroundColor: "rgba(0,0,0,0.8)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    overflow: "hidden",
  },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: "#FFD700", // Gold military accent
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },

  pendingBadge: {
    position: "absolute",
    top: 100, // Move down from top bar
    right: 20,
    backgroundColor: "#F57C00",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pendingBadgeText: { color: "#FFF", fontSize: 12, fontWeight: "600" },

  feedbackBanner: {
    position: "absolute",
    bottom: 50,
    left: 20,
    right: 20,
    borderRadius: 16,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  bgSuccess: { backgroundColor: "#4CAF50" },
  bgWarning: { backgroundColor: "#F57C00" },
  bgError: { backgroundColor: "#D32F2F" },
  feedbackTextGroup: { marginLeft: 15, flex: 1 },
  feedbackName: { fontSize: 18, fontWeight: "bold", color: "#FFF" },
  feedbackStatus: {
    fontSize: 14,
    color: "#FFF",
    opacity: 0.9,
    marginTop: 2,
    fontWeight: "600",
  },
});
