import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { Block, Plan } from "@/api";
import { enter } from "@/components/motion";
import { Card, Icon, IconName, Notice, Small } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const KIND_NAME: Record<Block["kind"], string> = { class: "课", must: "习惯", proj: "项目", flex: "可选", life: "" };
const KIND_ICON: Record<Block["kind"], IconName> = {
  class: "school-outline", must: "repeat", proj: "construct-outline", flex: "sparkles-outline", life: "cafe-outline",
};

export const kindName = (b: Block) => (b.task_id === "one-thing" ? "昨晚定的" : KIND_NAME[b.kind]);
export const kindIcon = (b: Block): IconName => (b.task_id === "one-thing" ? "star-outline" : KIND_ICON[b.kind]);

/** 「2026-11-20」→「11 月 20 日 · 星期五」 */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${"日一二三四五六"[d.getDay()]}`;
}

/** "HH:MM" → 当天第几分钟。 */
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** 现在是这一天的第几分钟。凌晨 4 点前还算前一天（和后端 DAY_STARTS_AT 一致），所以会超过 24:00。 */
function nowMin(d = new Date()) {
  const h = d.getHours();
  return (h < 4 ? h + 24 : h) * 60 + d.getMinutes();
}

/** 当前分钟，每 30 秒更新一次：「此刻」卡片和时间线跟着走。 */
export function useNow() {
  const [now, setNow] = useState(nowMin);
  useEffect(() => {
    const t = setInterval(() => setNow(nowMin()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * 一天的时间线：每块左边一个小圆点，颜色按种类；吃饭、路上、自由时间淡一些。
 * now：给了就把过去的块调淡、正在做的块高亮，空档处画一条「现在」线。
 * from：只看这个时间之后的（报电量面板用）。showEnergy：顶上显示精力条。
 */
export function PlanView({ plan, from, now, showEnergy = true }: {
  plan: Plan; from?: string; now?: number; showEnergy?: boolean;
}) {
  const c = useColors();
  const blocks = from ? plan.blocks.filter((b) => b.end > from) : plan.blocks;
  const used = plan.energy_cap ? Math.min(1, plan.energy_used / plan.energy_cap) : 0;
  const current = now === undefined ? -1 : blocks.findIndex((b) => toMin(b.start) <= now && now < toMin(b.end));
  const lineAt = now === undefined || current >= 0 ? -1 : blocks.findIndex((b) => toMin(b.start) > now);
  const lineAtEnd = now !== undefined && current < 0 && lineAt < 0 && blocks.length > 0;
  return (
    <Card style={{ gap: space.lg }}>
      {showEnergy && (
        <View style={{ gap: space.sm }}>
          <Small muted>
            今天的精力安排了 {Math.round(used * 100)}%{plan.energy_level ? ` · 电量 ${plan.energy_level} 格` : ""}
            {plan.confirmed ? " · 已确认" : ""}
          </Small>
          <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: c.sunken, overflow: "hidden" }}
            accessible accessibilityRole="progressbar" accessibilityLabel={`精力已安排 ${Math.round(used * 100)}%`}>
            <View style={{ width: `${used * 100}%`, height: "100%", backgroundColor: c.kind.must, borderRadius: radius.pill }} />
          </View>
        </View>
      )}
      {plan.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
      {from && blocks.length === 0 && <Small muted>今天已经没有剩下的安排了，早点休息。</Small>}
      <View>
        {blocks.map((b, i) => (
          <Animated.View key={b.id} entering={enter(i)}>
            {i === lineAt && now !== undefined && <NowLine now={now} />}
            <BlockRow b={b} last={i === blocks.length - 1}
              state={now === undefined ? "plain" : i === current ? "now" : toMin(b.end) <= now ? "past" : "plain"} />
          </Animated.View>
        ))}
        {lineAtEnd && now !== undefined && <NowLine now={now} />}
      </View>
    </Card>
  );
}

function BlockRow({ b, last, state }: { b: Block; last: boolean; state: "plain" | "now" | "past" }) {
  const c = useColors();
  const quiet = b.kind === "life";
  const live = state === "now";
  return (
    <View style={{ flexDirection: "row", gap: space.md, minHeight: 48, opacity: state === "past" ? 0.45 : 1 }}
      accessible accessibilityLabel={`${b.start} 到 ${b.end}，${kindName(b)}${b.title}${b.pomodoros ? `，番茄 ${b.pomodoros} 个` : ""}${live ? "，正在进行" : ""}`}>
      <Text style={[type.small, { width: 44, color: live ? c.primary : c.muted, fontWeight: live ? "600" : "400",
        fontVariant: ["tabular-nums"], paddingTop: live ? space.sm + 2 : 2 }]}>
        {b.start}
      </Text>
      <View style={{ alignItems: "center", width: 14 }}>
        <View style={{ width: quiet ? 8 : 14, height: quiet ? 8 : 14, borderRadius: radius.pill,
          marginTop: live ? space.sm + 6 : quiet ? 8 : 5, backgroundColor: c.kind[b.kind],
          borderWidth: live ? 3 : 0, borderColor: c.soft }} />
        {!last && <View style={{ flex: 1, width: 2, backgroundColor: c.line, marginVertical: 3 }} />}
      </View>
      <View style={[{ flex: 1, marginBottom: space.sm, gap: 2 },
        live && { backgroundColor: c.soft, borderRadius: radius.md, padding: space.sm, paddingHorizontal: space.md }]}>
        <Text style={quiet && !live ? [type.small, { color: c.muted, paddingTop: 1 }] : [type.label, { color: live ? c.onSoft : c.text }]}>
          {b.title}
        </Text>
        {(!quiet || live) && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Icon name={kindIcon(b)} size={13} color={live ? c.onSoft : c.muted} />
            <Small color={live ? c.onSoft : c.muted}>
              {live ? "正在进行 · " : kindName(b) ? `${kindName(b)} · ` : ""}{b.start}–{b.end}{b.pomodoros ? ` · 番茄 ×${b.pomodoros}` : ""}
            </Small>
          </View>
        )}
      </View>
    </View>
  );
}

/** 空档里的「现在」线：一个小圆点加一条细线。 */
function NowLine({ now }: { now: number }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={`现在 ${fromMin(now)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm }}>
      <Text style={[type.small, { width: 44, color: c.primary, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
        {fromMin(now)}
      </Text>
      <View style={{ width: 14, alignItems: "center" }}>
        <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: c.primary }} />
      </View>
      <View style={{ flex: 1, height: 2, borderRadius: radius.pill, backgroundColor: c.primary }} />
    </View>
  );
}
