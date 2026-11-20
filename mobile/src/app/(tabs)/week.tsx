import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { getWeek, Week } from "@/api";
import { Bar, enter, Ring, Skeleton } from "@/components/motion";
import { Body, Button, Card, Display, Eyebrow, Icon, Screen, Small, Title } from "@/components/ui";
import { radius, space, TAB_SPACE, type, useColors } from "@/theme";

/** 「2026-11-14」→「11/14」 */
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 本周：记了几天、每个习惯做了几天、项目比预想多还是少，以及复盘入口。只摆事实，不打分。 */
export default function WeekScreen() {
  const c = useColors();
  const [week, setWeek] = useState<Week | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    getWeek().then((w) => { setWeek(w); setError(null); }, (e: Error) => setError(e.message));
  }, []));

  if (error && !week) {
    return (
      <Screen safeTop bottom={TAB_SPACE}>
        <Display>这一周</Display>
        <Body muted>没拿到这周的记录：{error}</Body>
      </Screen>
    );
  }
  if (!week) {
    return (
      <Screen safeTop bottom={TAB_SPACE}>
        <Skeleton height={36} width={140} />
        <Skeleton height={168} r={radius.lg} />
        <Skeleton height={200} r={radius.lg} />
      </Screen>
    );
  }

  return (
    <Screen safeTop bottom={TAB_SPACE}>
      <Animated.View entering={enter(0)} style={{ gap: space.xs }}>
        <Small muted>{md(week.start)} – {md(week.end)}</Small>
        <Display>这一周</Display>
      </Animated.View>

      <Card i={1} style={{ flexDirection: "row", alignItems: "center", gap: space.xl, padding: space.xl }}>
        <Ring value={week.logged_days / 7} size={112} stroke={11} color={c.primary} label={`这 7 天记录了 ${week.logged_days} 天`}>
          <Text style={[type.display, { color: c.text, fontVariant: ["tabular-nums"] }]}>{week.logged_days}</Text>
          <Text style={[type.small, { color: c.muted, marginTop: -4 }]}>/ 7 天</Text>
        </Ring>
        <View style={{ flex: 1, gap: space.xs }}>
          <Title>记了 {week.logged_days} 天</Title>
          <Small muted>{week.logged_days >= 5 ? "这周大部分晚上都留了记录。" : "不用天天满，记下来的每一天都算数。"}</Small>
        </View>
      </Card>

      {week.review ? (
        <Card i={2} onPress={() => router.push("/review")} label="打开这周的复盘"
          style={{ backgroundColor: c.soft, borderColor: "transparent", flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Icon name="leaf" size={26} color={c.onSoft} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: c.onSoft, fontWeight: "600" }]}>
              {week.review === "due" ? "可以复盘了" : "今天复盘过了"}
            </Text>
            <Text style={[type.small, { color: c.onSoft }]}>
              {week.review === "due" ? "大约 5 分钟，看看哪里要调。" : "还能回去点那几条调整。"}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={c.onSoft} />
        </Card>
      ) : (
        <Animated.View entering={enter(2)} style={{ flexDirection: "row", gap: space.sm, alignItems: "center", paddingHorizontal: space.xs }}>
          <Icon name="time-outline" size={16} color={c.muted} />
          <Small muted>记满 7 天、离上次复盘满一周，这里会出现复盘。</Small>
        </Animated.View>
      )}

      {week.habits.length > 0 && (
        <>
          <Eyebrow>习惯 · 做了几天（含保底）</Eyebrow>
          <Card i={3} style={{ gap: space.lg }}>
            {week.habits.map((h) => (
              <View key={h.id} style={{ gap: space.sm }} accessible accessibilityLabel={`${h.title}，7 天里做了 ${h.done_days} 天`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={[type.label, { color: c.text }]}>{h.title}</Text>
                  <Text style={[type.small, { color: c.muted, fontVariant: ["tabular-nums"] }]}>{h.done_days} / 7</Text>
                </View>
                <Bar value={h.done_days / 7} color={c.kind.must} />
              </View>
            ))}
          </Card>
        </>
      )}

      {week.projects.length > 0 && (
        <>
          <Eyebrow>项目 · 和预想比</Eyebrow>
          <Card i={4} style={{ gap: space.lg }}>
            {week.projects.map((p) => <ProjectRow key={p.id} p={p} />)}
            <View style={{ flexDirection: "row", gap: space.lg }}>
              <Legend color={c.kind.proj} text="比预想少" />
              <Legend color={c.kind.class} text="差不多" />
              <Legend color={c.kind.flex} text="比预想多" />
            </View>
          </Card>
        </>
      )}

      <Animated.View entering={enter(5)}>
        <Button label="改习惯和课表" icon="options-outline" variant="secondary" onPress={() => router.push("/settings")} />
      </Animated.View>
    </Screen>
  );
}

function ProjectRow({ p }: { p: Week["projects"][number] }) {
  const c = useColors();
  const total = p.less + p.same + p.more;
  return (
    <View style={{ gap: space.sm }} accessible
      accessibilityLabel={total ? `${p.title}：比预想少 ${p.less} 次，差不多 ${p.same} 次，比预想多 ${p.more} 次` : `${p.title}：这周还没记`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[type.label, { color: c.text, flex: 1 }]} numberOfLines={1}>{p.title}</Text>
        <Text style={[type.small, { color: c.muted }]}>{total ? `记了 ${total} 次` : "还没记"}</Text>
      </View>
      <View style={{ flexDirection: "row", height: 8, borderRadius: radius.pill, overflow: "hidden", backgroundColor: c.sunken, gap: 2 }}>
        {total > 0 && [[p.less, c.kind.proj], [p.same, c.kind.class], [p.more, c.kind.flex]].map(([n, color], i) =>
          Number(n) > 0 ? <View key={i} style={{ flex: Number(n), backgroundColor: String(color) }} /> : null)}
      </View>
    </View>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color }} />
      <Small muted>{text}</Small>
    </View>
  );
}
