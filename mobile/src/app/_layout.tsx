import { Stack } from "expo-router";

import { useNotificationRouting } from "@/notifications";

export default function RootLayout() {
  useNotificationRouting();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "今日计划" }} />
      <Stack.Screen name="checkin" options={{ title: "晚间对账" }} />
      <Stack.Screen name="energy" options={{ title: "报电量" }} />
      <Stack.Screen name="onboarding" options={{ title: "认识一下" }} />
      <Stack.Screen name="review" options={{ title: "每周复盘" }} />
      <Stack.Screen name="data" options={{ title: "我的数据" }} />
      <Stack.Screen name="settings" options={{ title: "设置" }} />
    </Stack>
  );
}
