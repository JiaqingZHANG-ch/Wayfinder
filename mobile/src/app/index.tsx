import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Block, getToday, Plan } from "@/api";

// 每类事情左边一条色带：课灰、习惯绿、项目蓝、可选橙、其他（吃饭、路上、自由时间）不标
const KIND_COLOR: Record<Block["kind"], string> = {
  class: "#9aa0a6", must: "#34a853", proj: "#4285f4", flex: "#fb8c00", life: "transparent",
};

export default function Today() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getToday().then(setPlan, (e: Error) => setError(e.message));
  }, []);

  if (error) return <Text style={styles.message}>没拿到今天的计划：{error}（后端开着吗？）</Text>;
  if (!plan) return <Text style={styles.message}>正在排今天的计划……</Text>;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>{plan.day}</Text>
      <Text style={styles.sub}>
        精力 {plan.energy_used} / {plan.energy_cap} 分钟{plan.confirmed ? " · 已确认" : ""}
      </Text>
      {plan.warnings.map((w) => (
        <Text key={w} style={styles.warning}>{w}</Text>
      ))}
      {plan.blocks.map((b) => (
        <View key={b.id} style={[styles.row, { borderLeftColor: KIND_COLOR[b.kind] }]}>
          <Text style={styles.time}>{b.start}–{b.end}</Text>
          <Text style={styles.what}>
            {b.title}
            {b.pomodoros ? ` · 番茄 ×${b.pomodoros}` : ""}
          </Text>
        </View>
      ))}
      <Link href="/checkin" style={styles.link}>晚间对账 →</Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 6, maxWidth: 560, width: "100%", alignSelf: "center" },
  title: { fontSize: 22, fontWeight: "600" },
  sub: { color: "#5f6368", marginBottom: 8 },
  warning: { color: "#b3261e" },
  row: { flexDirection: "row", gap: 12, paddingVertical: 6, paddingLeft: 10, borderLeftWidth: 4 },
  time: { width: 96, fontVariant: ["tabular-nums"], color: "#5f6368" },
  what: { flex: 1 },
  link: { marginTop: 16, fontSize: 16, color: "#1a73e8" },
  message: { padding: 16 },
});
