import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { startFieldModeConnectivity } from "../lib/field-mode";
import { startSyncListener } from "../lib/offline-sync";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    const stopField = startFieldModeConnectivity();
    const stopListening = startSyncListener();
    return () => {
      stopField();
      stopListening();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="admin-simple" />
          <Stack.Screen name="officers" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="scores" />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
