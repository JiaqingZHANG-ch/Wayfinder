import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";

import { Block, Plan } from "@/api";
import { Glyph } from "@/components/art";
import { EASE, Pressy } from "@/components/motion";
import { Card, Icon, Notice, Small } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const KIND_NAME: Record<Block["kind"], string> = { class: "课", must: "习惯", proj: "项目", flex: "可选", life: "" };

export const kindName = (b: Block) => (b.task_id === "one-thing" ? "昨晚定的" : KIND_NAME[b.kind]);

/** 「2026-11-20」→「11 月 20 日 · 星期五」 */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${"日一二三四五六"[d.getDay()]}`;
}

/** "HH:MM" → 当天第几分钟。凌晨 4 点前算前一天（和 nowMin 一样超过 24:00），过了午夜的块才排在后面。 */
export const toMin = (t: string) => { const h = Number(t.slice(0, 2)); return (h < 4 ? h + 24 : h) * 60 + Number(t.slice(3, 5)); };
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
 * fold（要和 now 一起给）：已经过去的块收成一行「早些时候 · N 件」，点开才显示。title：卡片顶上的小标题。
 * 行不单独错峰入场（卡片整张入场一次）；展开、收起、计划变了，行平滑挪位，新出现的行淡入。
 */
export function PlanView({ plan, from, now, showEnergy = true, fold, title, action }: {
  plan: Plan; from?: string; now?: number; showEnergy?: boolean; fold?: boolean; title?: string;
  action?: { label: string; onPress: () => void }; // 标题那一行右边的一个小入口（首页的「提前对账」）
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const all = from ? plan.blocks.filter((b) => toMin(b.end) > toMin(from)) : plan.blocks;
  const hidden = fold && now !== undefined && !open ? all.filter((b) => toMin(b.end) <= now).length : 0;
  const past = fold && now !== undefined ? all.filter((b) => toMin(b.end) <= now) : [];
  const pastCount = past.length;
  const pastTasks = past.filter((b) => b.kind !== "life").length; // 吃饭、路上不算「件事」
  const blocks = hidden ? all.filter((b) => now === undefined || toMin(b.end) > now) : all;
  const used = plan.energy_cap ? Math.min(1, plan.energy_used / plan.energy_cap) : 0;
  const current = now === undefined ? -1 : blocks.findIndex((b) => toMin(b.start) <= now && now < toMin(b.end));
  const lineAt = now === undefined || current >= 0 ? -1 : blocks.findIndex((b) => toMin(b.start) > now);
  const lineAtEnd = now !== undefined && current < 0 && lineAt < 0 && blocks.length > 0;
  const foldRow = pastCount > 0 && (
    <Pressy onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={open ? "收起早些时候的安排" : "早些时候的安排，点开看"} scaleTo={0.98}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 44, marginTop: action ? -space.md : 0 }}>
      <Small muted>{open ? "收起早些时候" : pastTasks ? `早些时候 · ${pastTasks} 件事` : "早些时候"}</Small>
      <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={c.muted} />
    </Pressy>
  );
  return (
    <Card style={{ gap: space.lg, paddingBottom: space.md }}>
      {/* 标题一行：左边标题，右边「早些时候」折叠；有小入口时入口在右、折叠挪到下一行 */}
      {(title || action) && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, marginVertical: -space.sm }}>
          <Text style={[type.eyebrow, { color: c.muted }]}>{title}</Text>
          {action ? (
            <Pressy onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label}
              style={{ minHeight: 44, justifyContent: "center", paddingLeft: space.md }}>
              <Small muted>{action.label}</Small>
            </Pressy>
          ) : foldRow}
        </View>
      )}
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
      {(action || !(title || action)) && foldRow}
      {blocks.length > 0 && <View>
        {blocks.map((b, i) => (
          <Animated.View key={b.id} entering={FadeIn.duration(200)} layout={LinearTransition.duration(260).easing(EASE)}>
            {i === lineAt && now !== undefined && <NowLine now={now} />}
            <BlockRow b={b} goal={plan.goals?.[b.id]} last={i === blocks.length - 1}
              state={now === undefined ? "plain" : i === current ? "now" : toMin(b.end) <= now ? "past" : "plain"} />
          </Animated.View>
        ))}
        {lineAtEnd && now !== undefined && <NowLine now={now} />}
      </View>}
    </Card>
  );
}

const span = (b: Block) => {
  const m = toMin(b.end) - toMin(b.start), h = Math.floor(m / 60);
  return m < 60 ? `${m} 分钟` : m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`;
};

function BlockRow({ b, goal, last, state }: { b: Block; goal?: string; last: boolean; state: "plain" | "now" | "past" }) {
  const c = useColors();
  const quiet = b.kind === "life";
  const live = state === "now";
  const past = state === "past";
  const minutes = toMin(b.end) - toMin(b.start);
  // 行高跟着时长走：45 分钟和 2 小时一眼看得出区别（Structured 的做法）
  const h = quiet ? 36 : Math.min(96, Math.max(56, 56 + (minutes - 30) * 0.4));
  const tint = c.kind[b.kind];
  return (
    <View style={{ flexDirection: "row", gap: space.md, minHeight: h }}
      accessible accessibilityLabel={`${b.start} 到 ${b.end}，${kindName(b)}${b.title}${b.pomodoros ? `，番茄 ${b.pomodoros} 个` : ""}${goal ? `，为了：${goal}` : ""}${live ? "，正在进行" : ""}`}>
      <Text style={[type.small, type.num, { width: 44, color: live ? c.text : c.muted, paddingTop: quiet ? 2 : 7 }]}>
        {b.start}
      </Text>
      <View style={{ alignItems: "center", width: 36 }}>
        {quiet ? (
          <View style={live ? { width: 10, height: 10, borderRadius: radius.pill, marginTop: 14, backgroundColor: c.primaryEdge }
            : { width: 6, height: 6, borderRadius: radius.pill, marginTop: 8, backgroundColor: c.kind.life }} />
        ) : (
          // 记号坐进一个这类事颜色的圆里；正在做的那件，圆是主色黄
          <View style={{ width: 32, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
            backgroundColor: live ? c.primary : `${tint}29`, opacity: past ? 0.6 : 1 }}>
            <Glyph name={b.title} star={b.task_id === "one-thing"} color={live ? c.onPrimary : tint}
              fill={past || live ? "full" : "empty"} />
          </View>
        )}
        {!last && <View style={{ flex: 1, width: 2, marginVertical: 4, borderRadius: 1,
          backgroundColor: past ? c.primaryEdge : c.line, opacity: past ? 0.5 : 1 }} />}
      </View>
      <View style={[{ flex: 1, marginBottom: last ? 0 : space.sm, gap: 2, paddingTop: quiet ? 0 : 4 },
        live && { backgroundColor: quiet ? c.sunken : c.soft, borderRadius: radius.md, padding: space.sm, paddingHorizontal: space.md }]}>
        {/* 吃饭、路上、自由时间只占一行：冒号前那段加时长，细节留给读屏 */}
        <Text numberOfLines={quiet ? 1 : undefined} style={quiet && !live ? [type.small, { color: c.muted, paddingTop: 1 }]
          : [type.body, { fontWeight: "500", color: live && !quiet ? c.onSoft : past ? c.muted : c.text }]}>
          {quiet ? `${b.title.split("：")[0]}${live ? "" : ` · ${span(b)}`}` : b.title}
        </Text>
        {(!quiet || live) && (
          <Small color={live && !quiet ? c.onSoft : c.muted}>
            {live ? `正在进行 · 到 ${b.end}` : [kindName(b), span(b), b.pomodoros ? `番茄 ×${b.pomodoros}` : ""].filter(Boolean).join(" · ")}
          </Small>
        )}
        {/* 长谈定下的「为了」单独一行，不被前面那串挤成省略号 */}
        {goal && (!quiet || live) && <Small color={live && !quiet ? c.onSoft : c.muted} lines={1}>{`为了：${goal}`}</Small>}
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
      <Text style={[type.small, type.num, { width: 44, color: c.primaryInk }]}>
        {fromMin(now)}
      </Text>
      <View style={{ width: 36, alignItems: "center" }}>
        <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: c.primaryEdge }} />
      </View>
      <View style={{ flex: 1, height: 1.5, borderRadius: radius.pill, backgroundColor: c.primaryEdge, opacity: 0.7 }} />
    </View>
  );
}
