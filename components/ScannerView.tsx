import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    RefreshCcw,
    XCircle,
} from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getPendingCount } from "../lib/offline-sync";
import { processQRScan, ScanResult } from "../lib/qr-scan-service";
import { Session } from "../lib/session-manager";

interface ScannerViewProps {
  session: Session | null;
  scannedBy: string;
}

type FeedbackState = {
  color: "green" | "orange" | "red";
  icon: "check" | "refresh" | "alert" | "x";
  name?: string;
  statusLine: string;
  savedOffline?: boolean;
};

export default function ScannerView({ session, scannedBy }: ScannerViewProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.message}>
          We need your permission to show the camera
        </Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleBarcodeScanned = async ({
    data,
  }: {
    type: string;
    data: string;
  }) => {
    if (scanned) return;
    setScanned(true);

    // Provide instant feedback before processing
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (typeof window !== "undefined") {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "sine";
          osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
          gain.gain.setValueAtTime(0.5, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.1); 
        }
      }
    } catch {}

    setFeedback({
      color: "orange",
      icon: "refresh",
      statusLine: "Processing scan...",
    });

    let result: ScanResult;
    let savedOffline = false;

    try {
      result = await processQRScan({ qrToken: data, session, scannedBy });

      // Detect offline fallback: present/late outcome but INSERT may have failed
      // processQRScan enqueues when INSERT fails and still returns present/late
      // We detect this by checking if pending count increased after the scan
      const pending = await getPendingCount();
      setPendingCount(pending);
      if (
        pending > 0 &&
        (result.outcome === "present" || result.outcome === "late")
      ) {
        savedOffline = true;
      }
    } catch {
      setFeedback({
        color: "red",
        icon: "x",
        statusLine: "Scan failed. Try again.",
      });
      setTimeout(() => setScanned(false), 2000);
      return;
    }

    const fb = mapResultToFeedback(result, savedOffline);
    setFeedback(fb);

    setTimeout(() => setScanned(false), 2000);
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      >
        <View style={styles.overlay}>
          <Text style={styles.scanInstruction}>
            Position QR Code within the frame
          </Text>
          <View style={styles.scanArea} />
        </View>

        {/* Pending sync badge */}
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Clock color="#FFF" size={14} />
            <Text style={styles.pendingText}>{pendingCount} pending sync</Text>
          </View>
        )}

        {/* Feedback Banner */}
        {feedback && (
          <View style={[styles.feedbackBanner, bannerBg(feedback.color)]}>
            {feedback.icon === "check" && (
              <CheckCircle2 color="#FFF" size={30} />
            )}
            {feedback.icon === "refresh" && (
              <RefreshCcw color="#FFF" size={30} />
            )}
            {feedback.icon === "alert" && (
              <AlertCircle color="#FFF" size={30} />
            )}
            {feedback.icon === "x" && <XCircle color="#FFF" size={30} />}

            <View style={styles.feedbackTextGroup}>
              {feedback.name && (
                <Text style={styles.feedbackName}>{feedback.name}</Text>
              )}
              <Text style={styles.feedbackStatus}>{feedback.statusLine}</Text>
              {feedback.savedOffline && (
                <Text style={styles.offlineIndicator}>Saved offline</Text>
              )}
            </View>
          </View>
        )}
      </CameraView>
    </View>
  );
}

function mapResultToFeedback(
  result: ScanResult,
  savedOffline: boolean,
): FeedbackState {
  switch (result.outcome) {
    case "present":
      return {
        color: "green",
        icon: "check",
        name: result.cadet.full_name,
        statusLine: "RECORDED PRESENT",
        savedOffline,
      };
    case "late":
      return {
        color: "orange",
        icon: "refresh",
        name: result.cadet.full_name,
        statusLine: "RECORDED LATE",
        savedOffline,
      };
    case "duplicate":
      return {
        color: "orange",
        icon: "alert",
        name: result.cadet.full_name,
        statusLine: "ALREADY RECORDED",
      };
    case "blocked":
      return {
        color: "red",
        icon: "x",
        statusLine: "Session closed. Cannot record attendance.",
      };
    case "invalid":
      if (result.reason === "self_scan") {
        return {
          color: "red",
          icon: "x",
          statusLine: "You cannot scan your own QR code.",
        };
      }
      if (result.reason === "no_open_session") {
        return { color: "red", icon: "x", statusLine: "No active session." };
      }
      // bad_token
      return { color: "red", icon: "x", statusLine: "Invalid QR Code" };
  }
}

function bannerBg(color: "green" | "orange" | "red") {
  if (color === "green") return styles.bgSuccess;
  if (color === "orange") return styles.bgWarning;
  return styles.bgError;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centerContainer: {
    flex: 1,
    backgroundColor: "#F8F9F7",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  message: {
    textAlign: "center",
    paddingBottom: 10,
    fontSize: 16,
    color: "#111",
  },
  btn: { backgroundColor: "#1F3D2B", padding: 12, borderRadius: 8 },
  btnText: { color: "#FFF", fontWeight: "bold" },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  scanInstruction: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 40,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    overflow: "hidden",
  },
  scanArea: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: "#4CAF50",
    backgroundColor: "transparent",
    borderRadius: 16,
  },

  pendingBadge: {
    position: "absolute",
    top: 20,
    right: 20,
    backgroundColor: "#F57C00",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pendingText: { color: "#FFF", fontSize: 12, fontWeight: "600" },

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
  offlineIndicator: {
    fontSize: 12,
    color: "#FFE082",
    marginTop: 4,
    fontWeight: "600",
  },
});
