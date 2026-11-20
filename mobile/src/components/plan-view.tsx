import { StyleSheet, Text, View } from "react-native";

import { Block, Plan } from "@/api";

// 每类事情左边一条色带：课灰、习惯绿、项目蓝、可选橙、其他（吃饭、路上、自由时间）不标
const KIND_COLOR: Record<Block["kind"], string> = {
  class: "#9aa0a6", must: "#34a853", proj: "#4285f4", flex: "#fb8c00", life: "transparent",
};

/** 一天的计划：日期、精力、提醒、每一块。今日计划页和报电量页共用。 */
export function PlanView({ plan, from }: { plan: Plan; from?: string }) {
  const blocks = from ? plan.blocks.filter((b) => b.end > from) : plan.blocks;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{plan.day}</Text>
      <Text style={styles.sub}>
        精力 {plan.energy_used} / {plan.energy_cap} 分钟
        {plan.energy_level ? ` · 电量 ${plan.energy_level}` : ""}
        {plan.confirmed ? " · 已确认" : ""}
      </Text>
      {plan.warnings.map((w) => (
        <Text key={w} style={styles.warning}>{w}</Text>
      ))}
      {blocks.map((b) => (
        <View key={b.id} style={[styles.row, { borderLeftColor: KIND_COLOR[b.kind] }]}>
          <Text style={styles.time}>{b.start}–{b.end}</Text>
          <Text style={styles.what}>
            {b.title}
            {b.pomodoros ? ` · 番茄 ×${b.pomodoros}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  title: { fontSize: 22, fontWeight: "600" },
  sub: { color: "#5f6368", marginBottom: 8 },
  warning: { color: "#b3261e" },
  row: { flexDirection: "row", gap: 12, paddingVertical: 6, paddingLeft: 10, borderLeftWidth: 4 },
  time: { width: 96, fontVariant: ["tabular-nums"], color: "#5f6368" },
  what: { flex: 1 },
});
