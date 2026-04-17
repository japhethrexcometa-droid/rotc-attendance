import { Platform, Alert } from "react-native";

/**
 * A multi-platform confirm dialog.
 * Uses window.confirm on web, Alert.alert on native.
 */
export async function confirmAction(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return window.confirm(`${title}\n\n${message}`);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Confirm", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

/**
 * Downloads a text/csv file on the web.
 */
export function downloadFileWeb(filename: string, content: string, type: string = "text/csv") {
  if (Platform.OS !== "web") return;
  
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
