import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useNotificationRouting } from "@/notifications";
import { type, useColors } from "@/theme";

export default function RootLayout() {
  useNotificationRouting();
  const c = useColors();
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerShadowVisible: false,
        headerTintColor: c.primary,
        headerTitleStyle: { ...type.label, color: c.text },
        contentStyle: { backgroundColor: c.bg },
      }}>
        <Stack.Screen name="index" options={{ title: "今天", headerShown: false }} />
        <Stack.Screen name="checkin" options={{ title: "晚间对账" }} />
        <Stack.Screen name="energy" options={{ title: "报电量" }} />
        <Stack.Screen name="onboarding" options={{ title: "认识一下" }} />
        <Stack.Screen name="review" options={{ title: "每周复盘" }} />
        <Stack.Screen name="data" options={{ title: "我的数据" }} />
        <Stack.Screen name="settings" options={{ title: "设置" }} />
      </Stack>
    </>
  );
}
