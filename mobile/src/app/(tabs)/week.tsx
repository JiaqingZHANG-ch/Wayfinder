import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { getWeek, Week } from "@/api";
import { enter, Skeleton } from "@/components/motion";
import { Body, Button, Card, Display, Icon, Screen, Small, Stat } from "@/components/ui";
import { radius, space, TAB_SPACE, type, useColors } from "@/theme";

/** 「2026-11-14」→「11/14」 */
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 本周：Bento 瓷砖，每块一个数一句话——记了几天、每个习惯做了几天、项目比预想多还是少，以及复盘入口。只摆事实，不打分。 */
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

  const n = week.logged_days;
  return (
    <Screen safeTop bottom={TAB_SPACE}>
      <Animated.View entering={enter(0)} style={{ gap: 2 }}>
        <Small muted>{md(week.start)} – {md(week.end)}</Small>
        <Display>这一周</Display>
      </Animated.View>

      <Animated.View entering={enter(1)}>
        <Stat size="big" label="记了几天" value={n} unit="/ 7 天"
          sub={n === 7 ? "这 7 天每晚都记了。" : n >= 5 ? "大部分晚上都留了记录。" : "不用天天满，记下来的每一天都算数。"}>
          <View style={{ flexDirection: "row", gap: 5, marginTop: space.sm }}>
            {Array.from({ length: 7 }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 20, borderRadius: 6, backgroundColor: i < n ? c.kind.must : c.hair }} />
            ))}
          </View>
        </Stat>
      </Animated.View>

      {week.habits.length > 0 && (
        <Animated.View entering={enter(2)} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
          {week.habits.map((h) => (
            <Stat key={h.id} label={h.title} value={h.done_days} unit="天" sub="7 天里做的（含保底）" style={{ minWidth: "40%" }} />
          ))}
        </Animated.View>
      )}

      {week.projects.map((p, i) => <ProjectTile key={p.id} p={p} i={3 + i} />)}

      {week.review ? (
        <Card i={4} onPress={() => router.push("/review")} label="打开这周的复盘"
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Icon name="leaf-outline" size={22} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: c.text }]}>{week.review === "due" ? "可以复盘了" : "今天复盘过了"}</Text>
            <Small muted>{week.review === "due" ? "大约 5 分钟，看看哪里要调。" : "还能回去点那几条调整。"}</Small>
          </View>
          <Text style={[type.small, { color: c.primary }]}>复盘</Text>
          <Icon name="chevron-forward" size={16} color={c.primary} />
        </Card>
      ) : (
        <Animated.View entering={enter(4)} style={{ flexDirection: "row", gap: space.sm, alignItems: "center", paddingHorizontal: space.xs }}>
          <Icon name="time-outline" size={16} color={c.muted} />
          <Small muted>记满 7 天、离上次复盘满一周，这里会出现复盘。</Small>
        </Animated.View>
      )}

      <Animated.View entering={enter(5)}>
        <Button label="改习惯和课表" icon="options-outline" variant="quiet" onPress={() => router.push("/settings")} />
      </Animated.View>
    </Screen>
  );
}

/** 一个项目一块：比预想少 / 差不多 / 比预想多 各几次，直接写数，不用颜色图例。 */
function ProjectTile({ p, i }: { p: Week["projects"][number]; i: number }) {
  const c = useColors();
  const total = p.less + p.same + p.more;
  const cols: [string, number][] = [["比预想少", p.less], ["差不多", p.same], ["比预想多", p.more]];
  return (
    <Card i={i} style={{ gap: space.sm }}>
      <View accessible accessibilityLabel={total ? `${p.title}：比预想少 ${p.less} 次，差不多 ${p.same} 次，比预想多 ${p.more} 次` : `${p.title}：这周还没记`}
        style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
          <Text style={[type.label, { color: c.text, flex: 1 }]} numberOfLines={1}>{p.title}</Text>
          <Small muted>{total ? `记了 ${total} 次` : "还没记"}</Small>
        </View>
        {total > 0 && (
          <View style={{ flexDirection: "row" }}>
            {cols.map(([k, v]) => (
              <View key={k} style={{ flex: 1 }}>
                <Text style={[type.stat, { color: v ? c.text : c.muted }]}>{v}</Text>
                <Small muted>{k}</Small>
              </View>
            ))}
          </View>
        )}
      </View>
    </Card>
  );
}
