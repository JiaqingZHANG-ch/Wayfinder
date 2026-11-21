import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { getSettings, Settings } from "@/api";
import { Arc, Glyph } from "@/components/art";
import { enter } from "@/components/motion";
import { useNow } from "@/components/plan-view";
import { Card, Display, Eyebrow, ListRow, Screen, Small } from "@/components/ui";
import { space, TAB_SPACE, type, useColors } from "@/theme";

/** 「我」：一行真的小结（几点起、几门课、几个习惯），下面是计划设置和隐私数据的入口，像系统设置那样分组。 */
export default function MeScreen() {
  const c = useColors();
  const now = useNow();
  const [s, setS] = useState<Settings | null>(null);
  useFocusEffect(useCallback(() => { getSettings().then(setS, () => {}); }, [])); // 拿不到就不写小结

  const classes = new Set((s?.timetable ?? []).map((x) => x.title)).size;
  const summary = s && [classes ? `${classes} 门课` : "", s.habits.length ? `${s.habits.length} 个习惯` : "",
    s.projects?.length ? `${s.projects.length} 个项目` : ""]
    .filter(Boolean).join(" · ");
  const evening = s?.reminders?.evening;
  const [w, setW] = useState(0);
  const marks = s ? [...s.habits.map((h) => [h.title, c.kind.must] as const), ...(s.projects ?? []).map((p) => [p.title, c.kind.proj] as const)] : [];

  return (
    <Screen safeTop bottom={TAB_SPACE} sky={now}>
      <Animated.View entering={enter(0)} style={{ gap: space.xs }}>
        <Text style={[type.eyebrow, type.num, { color: c.muted, minHeight: 16, letterSpacing: 0.5 }]}>{summary || " "}</Text>
        <Display>我</Display>
      </Animated.View>

      {s && marks.length > 0 && marks.length <= 4 && (
        // 我的一天：从起床到睡觉一道弧，弧下站着我的记号（和时间线、本周页里长一样）
        <Animated.View entering={enter(1)}>
          <View style={{ height: 130 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
            <Arc blocks={[{ id: "day", title: "", start: s.wake, end: s.sleep, kind: "life", task_id: null, pomodoros: null }]}
              now={0} width={w} height={112} />
            <View style={{ position: "absolute", left: 0, right: 0, top: 44, flexDirection: "row", justifyContent: "center",
              gap: marks.length > 3 ? 12 : 16 }}>
              {marks.map(([t, col]) => (
                <View key={t} accessible accessibilityLabel={t} style={{ width: 56, height: 56, borderRadius: 28,
                  alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}>
                  <Glyph name={t} color={col} size={32} />
                </View>
              ))}
            </View>
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", justifyContent: "space-between" }}
              accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={[type.eyebrow, type.num, { color: c.muted }]}>{s.wake} 起</Text>
              <Text style={[type.eyebrow, type.num, { color: c.muted }]}>{s.sleep} 睡</Text>
            </View>
          </View>
        </Animated.View>
      )}

      {s && marks.length > 4 && (
        // 记号多了一道弧站不下：横着一排，可以滑
        <Animated.View entering={enter(1)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.md, paddingVertical: space.xs, flexGrow: 1, justifyContent: "space-around" }}>
            {marks.map(([t, col]) => (
                <View key={t} accessible accessibilityLabel={t} style={{ alignItems: "center", gap: space.sm, width: 80 }}>
                  <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: `${col}29` }}>
                    <Glyph name={t} color={col} size={40} />
                  </View>
                  <Text style={[type.small, { fontSize: 12, lineHeight: 16, color: c.muted }]} numberOfLines={1}>{t}</Text>
                </View>
              ))}
          </ScrollView>
        </Animated.View>
      )}

      <Eyebrow>计划</Eyebrow>
      <Card i={1} style={{ paddingVertical: space.xs }}>
        <ListRow icon="alarm-outline" title="作息和习惯" sub="几点起、几点睡，每天想坚持的事"
          onPress={() => router.push("/settings?part=routine")} />
        <ListRow icon="school-outline" title="课表和项目" sub="每周的课，手上在做的项目" onPress={() => router.push("/settings?part=classes")} />
        <ListRow icon="notifications-outline" title="提醒" sub={evening ? `晚上 ${evening} 提醒对账` : "下课提醒、晚间对账提醒"}
          onPress={() => router.push("/settings?part=reminders")} last />
      </Card>

      <Eyebrow>隐私和数据</Eyebrow>
      <Card i={2} style={{ paddingVertical: space.xs }}>
        <ListRow icon="shield-checkmark-outline" title="我的数据" sub="所在国家、导出、删除" onPress={() => router.push("/data")} />
        <ListRow icon="document-text-outline" title="隐私说明" sub="数据存在哪、发给谁" onPress={() => router.push("/privacy")} last />
      </Card>

      <Animated.View entering={enter(3)} style={{ alignItems: "center", paddingTop: space.lg }}>
        <Small muted>Wayfinder {Constants.expoConfig?.version ?? ""}</Small>
      </Animated.View>
    </Screen>
  );
}
