import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "今日计划" }} />
      <Stack.Screen name="checkin" options={{ title: "晚间对账" }} />
    </Stack>
  );
}
