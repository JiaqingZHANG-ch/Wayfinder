import { Text, View } from "react-native";

import { Block, Plan } from "@/api";
import { Body, Card, Notice, Small } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const KIND_NAME: Record<Block["kind"], string> = { class: "课", must: "习惯", proj: "项目", flex: "可选", life: "" };

const kindName = (b: Block) => (b.task_id === "one-thing" ? "昨晚定的" : KIND_NAME[b.kind]);

/** 「2026-11-20」→「11 月 20 日 · 星期五」 */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${"日一二三四五六"[d.getDay()]}`;
}

/** 一天的时间线：每块左边一个小圆点，颜色按种类；吃饭、路上、自由时间淡一些。今日计划页和报电量页共用。 */
export function PlanView({ plan, from }: { plan: Plan; from?: string }) {
  const c = useColors();
  const blocks = from ? plan.blocks.filter((b) => b.end > from) : plan.blocks;
  const used = plan.energy_cap ? Math.min(1, plan.energy_used / plan.energy_cap) : 0;
  return (
    <Card style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Small muted>
          今天的精力安排了 {Math.round(used * 100)}%{plan.energy_level ? ` · 电量 ${plan.energy_level} 格` : ""}
          {plan.confirmed ? " · 已确认" : ""}
        </Small>
        <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: c.sunken, overflow: "hidden" }}
          accessibilityLabel={`精力已安排 ${Math.round(used * 100)}%`}>
          <View style={{ width: `${used * 100}%`, height: "100%", backgroundColor: c.kind.must, borderRadius: radius.pill }} />
        </View>
      </View>
      {plan.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
      {from && blocks.length === 0 && <Body muted>今天已经没有剩下的安排了，早点休息。</Body>}
      <View>
        {blocks.map((b, i) => {
          const quiet = b.kind === "life";
          return (
            <View key={b.id} style={{ flexDirection: "row", gap: space.md, minHeight: 44 }}
              accessible accessibilityLabel={`${b.start} 到 ${b.end}，${kindName(b)}${b.title}`}>
              <Text style={[type.small, { width: 48, color: c.muted, fontVariant: ["tabular-nums"], paddingTop: 2 }]}>
                {b.start}
              </Text>
              <View style={{ alignItems: "center", width: 12 }}>
                <View style={{ width: quiet ? 8 : 12, height: quiet ? 8 : 12, borderRadius: radius.pill, marginTop: quiet ? 8 : 6,
                  backgroundColor: quiet ? c.line : c.kind[b.kind] }} />
                {i < blocks.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: c.line, marginVertical: 2 }} />}
              </View>
              <View style={{ flex: 1, paddingBottom: space.md, gap: 2 }}>
                <Text style={quiet ? [type.small, { color: c.muted, paddingTop: 1 }] : [type.label, { color: c.text }]}>{b.title}</Text>
                {!quiet && (
                  <Small muted>
                    {kindName(b)} · {b.start}–{b.end}{b.pomodoros ? ` · 番茄 ×${b.pomodoros}` : ""}
                  </Small>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
