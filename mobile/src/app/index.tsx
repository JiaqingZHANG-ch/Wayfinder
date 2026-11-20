import { Link, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError, getToday, Plan } from "@/api";
import { PlanView } from "@/components/plan-view";

export default function Today() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  useEffect(() => {
    getToday().then(setPlan, setError);
  }, []);

  if (error instanceof ApiError && error.status === 409) return <Redirect href="/onboarding" />; // 还没建档
  if (error) return <Text style={styles.message}>没拿到今天的计划：{error.message}（后端开着吗？）</Text>;
  if (!plan) return <Text style={styles.message}>正在排今天的计划……</Text>;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <PlanView plan={plan} />
      <View style={styles.links}>
        <Link href="/energy" style={styles.link}>下课了，报电量 →</Link>
        <Link href="/checkin" style={styles.link}>晚间对账 →</Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, maxWidth: 560, width: "100%", alignSelf: "center" },
  links: { marginTop: 16, gap: 12 },
  link: { fontSize: 16, color: "#1a73e8" },
  message: { padding: 16 },
});
