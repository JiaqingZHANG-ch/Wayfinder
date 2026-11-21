import { router, useFocusEffect } from "expo-router";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { getWeek, Week } from "@/api";
import { type ClayIcon, clayIcon } from "@/clay-icon";
import { Bean, EventIcon } from "@/components/clay";
import { enter, Pressy, Skeleton } from "@/components/motion";
import { Button, Card, ErrorState, Icon, Screen } from "@/components/ui";
import { Status, STATUS_LABELS } from "@/labels";
import { radius, space, TAB_SPACE, type, useColors, useDark } from "@/theme";

const LEGEND: Record<Status, string> = { done: "做了", floor: "保底", skip: "没做" }; // 图例说的是过去的某天，不用对账按钮的「今天没做」

/** 「2026-11-14」→「11月14日」 */
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
/** 「11月17日 – 23日」：同一个月后半段只写日 */
const range = (a: string, b: string) => `${md(a)} – ${a.slice(5, 7) === b.slice(5, 7) ? `${Number(b.slice(8, 10))}日` : md(b)}`;
/** start 起第 i 天是星期几：「一」…「日」 */
const wd = (start: string, i: number) => "日一二三四五六"[(new Date(`${start}T12:00:00`).getDay() + i) % 7];

/**
 * 本周（v4 的 #pg-week）：一张记号表——第一行是夜豆（这 7 晚哪几晚记了），下面每个习惯一行七个记号；
 * 再往下是每个项目的估时对比，用石子堆画；复盘入口在最上面。只摆事实，不打分。
 * r4：不再是一摞白卡，只有记号表一张卡，其余靠留白和对齐分组。
 */
export default function WeekScreen() {
  const c = useColors();
  const dark = useDark();
  const [week, setWeek] = useState<Week | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    getWeek().then((w) => { setWeek(w); setError(false); }, () => setError(true));
  }, []);
  useFocusEffect(load);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") load(); });
    return () => sub.remove();
  }, [load]);

  if (error && !week) return <Screen safeTop bottom={TAB_SPACE}><ErrorState onRetry={load} /></Screen>;
  if (!week) {
    return (
      <Screen safeTop bottom={TAB_SPACE}>
        <Skeleton height={36} width={140} />
        <Skeleton height={52} r={radius.btn} />
        <Skeleton height={260} r={radius.card} />
        <Skeleton height={140} r={radius.card} />
      </Screen>
    );
  }

  const n = week.logged_days;
  const last = week.logged.length - 1; // 最后一格是今天
  return (
    <Screen safeTop bottom={TAB_SPACE}>
      <Animated.View entering={enter(0)} style={{ gap: 2, paddingHorizontal: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.display, { fontWeight: "900", color: c.text }]}>本周</Text>
          <Text style={[type.num, { fontSize: 15, color: c.muted }]}>{range(week.start, week.end)}</Text>
        </View>
        <Text style={[type.small, { color: c.muted }]}>
          {n === 0 ? "今晚对一次账，这里就有第一格。" : n === 7 ? "这 7 天每晚都记了。" : "不用天天满，记下来的每一天都算数。"}
        </Text>
      </Animated.View>

      {week.review ? (
        <Animated.View entering={enter(1)} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingLeft: space.xs }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.body, { fontWeight: "900", color: c.text }]}>{week.review === "due" ? "可以复盘这一周了" : "今天复盘过了"}</Text>
            <Text style={[type.small, { color: c.muted }]}>{week.review === "due" ? "一两分钟，只看事实。" : "还能回去点那几条调整。"}</Text>
          </View>
          <Button hug label="看看" variant={week.review === "due" ? "primary" : "secondary"} accessibilityHint="打开这周的复盘"
            onPress={() => router.push("/review")} />
        </Animated.View>
      ) : (
        <Animated.View entering={enter(1)} style={{ flexDirection: "row", gap: space.sm, alignItems: "center", paddingHorizontal: space.xs }}>
          <Icon name="time-outline" size={16} color={c.muted} />
          <Text style={[type.small, { flex: 1, color: c.muted }]}>从第一次对账起满一周、离上次复盘也满一周，这里会出现复盘。</Text>
        </Animated.View>
      )}

      <Card i={2} style={{ gap: 0, paddingTop: space.md }}>
        <Line h={28}>
          {week.logged.map((_, i) => (
            <Text key={i} style={[type.small, { fontWeight: "800", color: i === last ? c.text : c.muted }]}>{wd(week.start, i)}</Text>
          ))}
        </Line>
        <Line name="记了" sub={`${n} 晚`} h={48}
          label={`这 7 晚记了 ${n} 晚：${week.logged.map((x, i) => `星期${wd(week.start, i)}${x ? "记了" : i === last ? "今天还没记" : "没记"}`).join("，")}`}>
          {/* 今天还没记只画空圈，和「那晚没记」的短线分开 */}
          {week.logged.map((x, i) => x ? <Bean key={i} night={dark} w={26} /> : <Mark key={i} s={i === last ? "skip" : null} />)}
        </Line>
        {week.habits.map((h) => (
          <Line key={h.id} icon={clayIcon({ title: h.title, kind: "must" })} name={h.title} sub={`${h.done_days} 天`}
            label={`${h.title}，7 天里做了 ${h.done_days} 天：${h.days.map((d, i) => `星期${wd(week.start, i)}${d ? STATUS_LABELS[d] : "没记"}`).join("，")}`}>
            {h.days.map((d, i) => <Mark key={i} s={d} />)}
          </Line>
        ))}
        {week.habits.length > 0 ? (
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: space.sm }}>
            {([...(["done", "floor", "skip"] as Status[]), null]).map((s) => (
              <View key={s ?? "none"} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Mark s={s} size={12} />
                <Text style={[type.small, { fontWeight: "800", color: c.muted }]}>{s ? LEGEND[s] : "没记"}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Pressy onPress={() => router.push("/settings?part=routine")} accessibilityRole="button" accessibilityLabel="去加一个习惯"
            scaleTo={1} fadeTo={0.8} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, marginTop: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: "800", color: c.text }]}>还没有要坚持的习惯</Text>
              <Text style={[type.small, { color: c.muted }]}>加一个，这里会按天画出哪天做了。</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={c.muted} />
          </Pressy>
        )}
      </Card>

      {week.projects.map((p, i) => <Project key={p.id} p={p} i={3 + i} night={dark} />)}
    </Screen>
  );
}

/** 记号表的一行：图标、名字和一行小字、七格。表头、夜豆、习惯三种行共用，七格才能上下对齐。 */
function Line({ icon, name, sub, label, h = 56, children }: {
  icon?: ClayIcon; name?: string; sub?: string; label?: string; h?: number; children: ReactNode;
}) {
  const c = useColors();
  return (
    <View accessible={!!label} accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: h }}>
      <View style={{ width: 36 }}>{icon && <EventIcon icon={icon} size={36} />}</View>
      <View style={{ width: 68 }}>
        {name && <Text style={[type.body, { fontSize: 15, lineHeight: 18, fontWeight: "900", color: c.text }]} numberOfLines={2}>{name}</Text>}
        {sub && <Text style={[type.small, type.num, { lineHeight: 17, color: c.muted }]}>{sub}</Text>}
      </View>
      <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between" }} importantForAccessibility="no-hide-descendants">
        {(Array.isArray(children) ? children : [children]).map((x, i) => (
          <View key={i} style={{ width: 26, alignItems: "center" }}>{x}</View>
        ))}
      </View>
    </View>
  );
}

/** 一天的记号：做了实心、保底半实、没做空心，那天没记一道短线。 */
function Mark({ s, size = 18 }: { s: Status | null; size?: number }) {
  const c = useColors();
  if (!s) return <View style={{ width: size * 0.67, height: 3, borderRadius: 2, backgroundColor: c.mark, marginVertical: (size - 3) / 2 }} />;
  const col = s === "skip" ? c.mark : c.done;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", borderWidth: s === "done" ? 0 : 2, borderColor: col,
      backgroundColor: s === "done" ? col : "transparent" }}>
      {s === "floor" && <View style={{ width: "50%", height: "100%", backgroundColor: col }} />}
    </View>
  );
}

const PILE = 4; // 一堆最多叠 4 颗，再多看数字

/** 一个项目：名字、几次对账和一句话，下面三堆石子（比预想少 / 差不多 / 比预想多），一颗一次。不装卡片。 */
function Project({ p, i, night }: { p: Week["projects"][number]; i: number; night: boolean }) {
  const c = useColors();
  const total = p.less + p.same + p.more;
  const cols: [string, number][] = [["比预想少", p.less], ["差不多", p.same], ["比预想多", p.more]];
  const top = Math.max(p.less, p.same, p.more);
  const leaders = cols.filter(([, v]) => v === top);
  const said = !total ? "这周还没记" : leaders.length > 1 ? "有时多、有时少" :
    leaders[0][0] === "差不多" ? "多半和预想差不多" : `多半${leaders[0][0]}`;
  const tall = Math.min(top, PILE) * 31;
  return (
    <Animated.View entering={enter(i)} accessible style={{ gap: space.md, paddingHorizontal: space.xs, paddingTop: space.sm }}
      accessibilityLabel={total ? `${p.title}：${said}。比预想少 ${p.less} 次，差不多 ${p.same} 次，比预想多 ${p.more} 次` : `${p.title}：这周还没记`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <EventIcon icon={clayIcon({ title: p.title, kind: "proj" })} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { fontWeight: "900", color: c.text }]} numberOfLines={1}>{p.title}</Text>
          <Text style={[type.small, { color: c.muted }]}>{total ? `${total} 次对账，${said}` : said}</Text>
        </View>
      </View>
      {total > 0 && (
        <View style={{ flexDirection: "row", gap: space.md }} importantForAccessibility="no-hide-descendants">
          {cols.map(([k, v]) => (
            <View key={k} style={{ flex: 1, alignItems: "center", gap: 2 }}>
              <View style={{ height: tall, justifyContent: "flex-end", gap: 2 }}>
                {Array.from({ length: Math.min(v, PILE) }, (_, j) => <Bean key={j} night={night} w={44} h={29} />)}
              </View>
              <Text style={[type.num, { fontFamily: type.hero.fontFamily, fontSize: 20, lineHeight: 28, color: c.text }]}>{v}</Text>
              <Text style={[type.small, { fontWeight: "800", color: c.muted }]}>{k}</Text>
            </View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}
