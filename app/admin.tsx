import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

export default function AdminLegacyRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin-simple");
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#1F3D2B" />
    </View>
  );
}
