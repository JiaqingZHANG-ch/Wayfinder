import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { getWeek, Week } from "@/api";
import { enter, Skeleton } from "@/components/motion";
import { Card, Display, ErrorState, Icon, Screen, Small, Stat, Title } from "@/components/ui";
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
  const [week, setWeek] = useState<Week | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    getWeek().then((w) => { setWeek(w); setError(false); }, () => setError(true));
  }, []);
  useFocusEffect(load);

  if (error && !week) return <Screen safeTop bottom={TAB_SPACE}><ErrorState onRetry={load} /></Screen>;
  if (!week) {
    return (
      <Screen safeTop bottom={TAB_SPACE}>
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
    <Screen safeTop bottom={TAB_SPACE}>
      <Animated.View entering={enter(0)} style={{ gap: 2 }}>
        <Text style={[type.small, type.num, { color: c.muted }]}>{md(week.start)} – {md(week.end)}</Text>
        <Display>这一周</Display>
      </Animated.View>

      <Animated.View entering={enter(1)}>
        {n === 0 ? (
          <Card style={{ gap: space.xs }}>
            <Title>这周还没有记录</Title>
            <Small muted>今晚对一次账，这里就有第一格。</Small>
            <Days week={week} />
          </Card>
        ) : (
          <Stat size="big" label="记了几晚" value={n} unit="/ 7 晚"
            sub={n === 7 ? "这 7 天每晚都记了。" : "不用天天满，记下来的每一天都算数。"}>
            <Days week={week} />
          </Stat>
        )}
      </Animated.View>

      {week.habits.length > 0 && (
        <Card i={2} style={{ gap: space.md }}>
          <Text style={[type.label, { color: c.muted }]}>习惯</Text>
          {week.habits.map((h) => <HabitRow key={h.id} h={h} start={week.start} />)}
          <View style={{ flexDirection: "row", gap: space.md, flexWrap: "wrap" }}>
            {([...(["done", "floor", "skip"] as Status[]), null]).map((s) => (
              <View key={s ?? "none"} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Dot s={s} size={10} />
                <Small muted>{s ? LEGEND[s] : "没记"}</Small>
              </View>
            ))}
          </View>
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
          <Small muted>记满 7 晚、离上次复盘满一周，这里会出现复盘。</Small>
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

/** 一个圆：做了实心、保底半满、没做空心；那天没对账只画一个小点。 */
function Dot({ s, size = 14 }: { s: Status | null; size?: number }) {
  const c = useColors();
  if (!s) return <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.line }} />
  </View>;
  return <Icon name={s === "done" ? "ellipse" : s === "floor" ? "contrast" : "ellipse-outline"} size={size}
    color={s === "skip" ? c.muted : c.kind.must} />;
}

function HabitRow({ h, start }: { h: Week["habits"][number]; start: string }) {
  const c = useColors();
  return (
    <View accessible style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
      accessibilityLabel={`${h.title}，7 天里做了 ${h.done_days} 天：${h.days.map((d, i) => `星期${wd(start, i)}${d ? STATUS_LABELS[d] : "没记"}`).join("，")}`}>
      <Text style={[type.label, { flex: 1, color: c.text }]} numberOfLines={1}>{h.title}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {h.days.map((d, i) => <Dot key={i} s={d} />)}
      </View>
      <Text style={[type.small, type.num, { width: 36, textAlign: "right", color: c.muted }]}>{h.done_days} 天</Text>
    </View>
  );
}

/** 一个项目一块：一句话说多半怎样，下面一条三段的比例条（比预想少 / 差不多 / 比预想多）。 */
function ProjectTile({ p, i }: { p: Week["projects"][number]; i: number }) {
  const c = useColors();
  const total = p.less + p.same + p.more;
  const cols: [string, number, number][] = [["比预想少", p.less, 0.35], ["差不多", p.same, 0.6], ["比预想多", p.more, 1]];
  const top = Math.max(p.less, p.same, p.more);
  const leaders = cols.filter(([, v]) => v === top);
  const said = !total ? "这周还没记" : leaders.length > 1 ? "有时多、有时少" :
    leaders[0][0] === "差不多" ? "多半和预想差不多" : `多半${leaders[0][0]}`;
  return (
    <Card i={i} style={{ gap: space.sm }}>
      <View accessible accessibilityLabel={total ? `${p.title}：${said}。比预想少 ${p.less} 次，差不多 ${p.same} 次，比预想多 ${p.more} 次` : `${p.title}：这周还没记`}
        style={{ gap: space.sm }}>
        <Small muted>{p.title}</Small>
        <Title>{said}</Title>
        {total > 0 && (
          <>
            <View style={{ flexDirection: "row", height: 6, borderRadius: radius.pill, overflow: "hidden", gap: 2 }}>
              {cols.filter(([, v]) => v > 0).map(([k, v, o]) => (
                <View key={k} style={{ flex: v, backgroundColor: c.kind.proj, opacity: o }} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: space.md }}>
              {cols.map(([k, v]) => <Small key={k} muted>{k} <Text style={type.num}>{v}</Text></Small>)}
            </View>
          </>
        )}
      </View>
    </Card>
  );
}
