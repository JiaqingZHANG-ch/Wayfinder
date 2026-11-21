import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { getWeek, Week } from "@/api";
import { Glyph } from "@/components/art";
import { enter, Skeleton } from "@/components/motion";
import { useNow } from "@/components/plan-view";
import { Card, Display, ErrorState, Icon, Screen, Small, Title } from "@/components/ui";
import { Status, STATUS_LABELS } from "@/labels";
import { radius, space, TAB_SPACE, type, useColors } from "@/theme";

const LEGEND: Record<Status, string> = { done: "做了", floor: "保底", skip: "没做" }; // 图例说的是过去的某天，不用对账按钮的「今天没做」

/** 「2026-11-14」→「11/14」 */
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** start 起第 i 天是星期几：「一」…「日」 */
const wd = (start: string, i: number) => "日一二三四五六"[(new Date(`${start}T12:00:00`).getDay() + i) % 7];

/** 本周：每块一个数一句话——哪几晚记了、每个习惯哪几天做了、项目比预想多还是少，以及复盘入口。只摆事实，不打分。 */
export default function WeekScreen() {
  const c = useColors();
  const now = useNow();
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

  if (error && !week) return <Screen safeTop bottom={TAB_SPACE} sky={now}><ErrorState onRetry={load} /></Screen>;
  if (!week) {
    return (
      <Screen safeTop bottom={TAB_SPACE} sky={now}>
        <Skeleton height={16} width={100} />
        <Skeleton height={36} width={140} />
        <Skeleton height={168} r={radius.lg} />
        <View style={{ flexDirection: "row", gap: space.md }}>
          <View style={{ flex: 1 }}><Skeleton height={120} r={radius.lg} /></View>
          <View style={{ flex: 1 }}><Skeleton height={120} r={radius.lg} /></View>
        </View>
      </Screen>
    );
  }

  const n = week.logged_days;
  return (
    <Screen safeTop bottom={TAB_SPACE} sky={now}>
      <Animated.View entering={enter(0)} style={{ gap: space.xs }}>
        <Text style={[type.eyebrow, type.num, { color: c.muted }]}>{md(week.start)} – {md(week.end)}</Text>
        <Display>这一周</Display>
      </Animated.View>

      {n === 0 ? (
        <Card i={1} style={{ gap: space.xs }}>
          <Title>这周还没有记录</Title>
          <Small muted>今晚对一次账，这里就有第一格。</Small>
          <Days week={week} />
        </Card>
      ) : (
        // 这一周的招牌图：不装卡片，直接画在天色上。每个习惯一行七个它自己的记号，那晚没记的列就是一排小点
        <Animated.View entering={enter(1)} style={{ gap: space.lg }}>
          <View accessible accessibilityLabel={`这 7 天记了 ${n} 晚`}>
            <Text>
              <Text style={[type.big, { color: c.text }]}>{n}</Text>
              <Text style={[type.title, { color: c.muted }]}> / 7 晚</Text>
            </Text>
            <Small muted>{n === 7 ? "这 7 天每晚都记了。" : "不用天天满，记下来的每一天都算数。"}</Small>
          </View>
          {week.habits.length > 0 ? (
            <View style={{ gap: space.md }}>
              <View style={{ flexDirection: "row" }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {week.logged.map((_, i) => (
                  <Text key={i} style={[type.eyebrow, { flex: 1, textAlign: "center",
                    color: i === week.logged.length - 1 ? c.primary : c.muted }]}>{wd(week.start, i)}</Text>
                ))}
              </View>
              {week.habits.map((h) => <HabitRow key={h.id} h={h} start={week.start} />)}
              <View style={{ flexDirection: "row", gap: space.md, flexWrap: "wrap", justifyContent: "center", paddingTop: space.xs }}>
                {([...(["done", "floor", "skip"] as Status[]), null]).map((s) => (
                  <View key={s ?? "none"} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Mark name="" s={s} size={11} />
                    <Small muted>{s ? LEGEND[s] : "没记"}</Small>
                  </View>
                ))}
              </View>
            </View>
          ) : <Days week={week} />}
        </Animated.View>
      )}

      {week.habits.length === 0 && (
        <Card i={2} onPress={() => router.push("/settings?part=routine")} label="去加一个习惯" style={{ gap: 2 }}>
          <Text style={[type.eyebrow, { color: c.muted }]}>习惯</Text>
          <Text style={[type.label, { color: c.text }]}>还没有要坚持的习惯</Text>
          <Small muted>加一个，这里会按天画出哪天做了。</Small>
        </Card>
      )}

      {week.projects.map((p, i) => <ProjectTile key={p.id} p={p} i={3 + i} />)}

      {week.review ? (
        <Card i={4} onPress={() => router.push("/review")} label="打开这周的复盘"
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Icon name="reader-outline" size={22} color={c.muted} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: c.text }]}>{week.review === "due" ? "可以复盘这一周了" : "今天复盘过了"}</Text>
            <Small muted>{week.review === "due" ? "一两分钟，只看事实。" : "还能回去点那几条调整。"}</Small>
          </View>
          <Icon name="chevron-forward" size={18} color={c.muted} />
        </Card>
      ) : (
        <Animated.View entering={enter(4)} style={{ flexDirection: "row", gap: space.sm, alignItems: "center", paddingHorizontal: space.xs }}>
          <Icon name="time-outline" size={16} color={c.muted} />
          <Small muted>从第一次对账起满一周、离上次复盘也满一周，这里会出现复盘。</Small>
        </Animated.View>
      )}
    </Screen>
  );
}

/** 七格，哪晚记了哪格亮，下面标星期几。 */
function Days({ week }: { week: Week }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={week.logged.map((x, i) => `星期${wd(week.start, i)}${x ? "记了" : "没记"}`).join("，")}
      style={{ gap: 4, marginTop: space.sm }}>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {week.logged.map((x, i) => (
          // 最后一格是今天：还没记时只描边，和「那天没记」分开
          <View key={i} style={{ flex: 1, height: 20, borderRadius: 6, backgroundColor: x ? c.kind.must : i === week.logged.length - 1 ? "transparent" : c.hair,
            borderWidth: !x && i === week.logged.length - 1 ? 1.5 : 0, borderColor: c.line }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {week.logged.map((_, i) => (
          <Text key={i} style={[type.small, { flex: 1, textAlign: "center", color: c.muted }]}>{wd(week.start, i)}</Text>
        ))}
      </View>
    </View>
  );
}

const DAY = 28;

/** 一天一个这件事自己的记号：做了实心、保底半满、没做空心；那天没对账只画一个小点。图例用圆（name 为空）。 */
function Mark({ name, s, size = DAY }: { name: string; s: Status | null; size?: number }) {
  const c = useColors();
  return <Glyph name={name} size={size} color={!s ? c.muted : s === "skip" ? c.muted : c.kind.must}
    fill={!s ? "none" : s === "done" ? "full" : s === "floor" ? "half" : "empty"} />;
}

function HabitRow({ h, start }: { h: Week["habits"][number]; start: string }) {
  const c = useColors();
  return (
    <View accessible style={{ gap: space.sm }}
      accessibilityLabel={`${h.title}，7 天里做了 ${h.done_days} 天：${h.days.map((d, i) => `星期${wd(start, i)}${d ? STATUS_LABELS[d] : "没记"}`).join("，")}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text style={[type.eyebrow, { flex: 1, color: c.muted }]} numberOfLines={1}>{h.title}</Text>
        <Text style={[type.eyebrow, type.num, { color: c.muted }]}>{h.done_days} 天</Text>
      </View>
      <View style={{ flexDirection: "row" }}>
        {h.days.map((d, i) => <View key={i} style={{ flex: 1, alignItems: "center" }}><Mark name={h.title} s={d} /></View>)}
      </View>
    </View>
  );
}

/** 一个项目一块：一句话说多半怎样，下面一条三段的比例条（比预想少 / 差不多 / 比预想多）。 */
function ProjectTile({ p, i }: { p: Week["projects"][number]; i: number }) {
  const c = useColors();
  const total = p.less + p.same + p.more;
  const cols: [string, number, number][] = [["比预想少", p.less, 0.45], ["差不多", p.same, 0.7], ["比预想多", p.more, 1]];
  const top = Math.max(p.less, p.same, p.more);
  const leaders = cols.filter(([, v]) => v === top);
  const said = !total ? "这周还没记" : leaders.length > 1 ? "有时多、有时少" :
    leaders[0][0] === "差不多" ? "多半和预想差不多" : `多半${leaders[0][0]}`;
  return (
    <Card i={i} style={{ gap: space.sm }}>
      <View accessible accessibilityLabel={total ? `${p.title}：${said}。比预想少 ${p.less} 次，差不多 ${p.same} 次，比预想多 ${p.more} 次` : `${p.title}：这周还没记`}
        style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Glyph name={p.title} size={12} color={c.kind.proj} />
          <Text style={[type.eyebrow, { color: c.muted }]}>{p.title}</Text>
        </View>
        <Title>{said}</Title>
        {total > 0 && (
          <>
            <View style={{ flexDirection: "row", height: 10, borderRadius: radius.pill, overflow: "hidden", gap: 2 }}>
              {cols.filter(([, v]) => v > 0).map(([k, v, o]) => (
                <View key={k} style={{ flex: v, backgroundColor: c.kind.proj, opacity: o }} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: space.md, flexWrap: "wrap" }}>
              {cols.map(([k, v, o]) => (
                <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.kind.proj, opacity: o }} />
                  <Small muted>{k} <Text style={type.num}>{v}</Text></Small>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </Card>
  );
}
