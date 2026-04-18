import { Download } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    // Detect if app is already installed/standalone
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) return;

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsReady(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsReady(false);
    }
    setDeferredPrompt(null);
  };

  if (!isReady || Platform.OS !== "web") return null;

  return (
    <View style={styles.container}>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Install ROTC App</Text>
        <Text style={styles.subtext}>Add to home screen for offline access</Text>
      </View>
      <TouchableOpacity
        style={styles.button}
        onPress={handleInstall}
        activeOpacity={0.8}
      >
        <Download color="#FFF" size={16} />
        <Text style={styles.btnText}>INSTALL</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(212,163,83,0.3)",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  textWrap: {
    flex: 1,
    marginRight: 10,
  },
  title: {
    color: "#D4A353",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  subtext: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },
  button: {
    backgroundColor: "#D4A353",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  btnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
});
