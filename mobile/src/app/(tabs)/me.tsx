import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { DeepTalkState, getDeepTalk, getProfile, getSettings, pendingCount, Profile, restartDeepTalk, Settings } from "@/api";
import { Glyph } from "@/components/art";
import { enter, Pressy } from "@/components/motion";
import { useNow } from "@/components/plan-view";
import { Body, Card, Display, Eyebrow, ListRow, Screen, Small } from "@/components/ui";
import { space, TAB_SPACE, type, useColors } from "@/theme";

/** 「我」：一行真的小结（几点起、几门课、几个习惯），下面是计划设置和隐私数据的入口，像系统设置那样分组。 */
export default function MeScreen() {
  const c = useColors();
  const now = useNow();
  const [s, setS] = useState<Settings | null>(null);
  const [dir, setDir] = useState<{ talk: DeepTalkState; confirmed: Profile[] } | null>(null);
  useFocusEffect(useCallback(() => {
    getSettings().then(setS, () => {}); // 拿不到就不写小结
    Promise.all([getDeepTalk(), getProfile()]).then(([talk, p]) => setDir({ talk, confirmed: p.confirmed }), () => {}); // 拿不到就不显示方向卡
  }, []));
  const latest = (level: string) => dir?.confirmed.filter((p) => p.level === level).sort((a, b) => b.id - a.id)[0];
  const mission = latest("使命") || latest("方向");
  // 和后端「为了」同一套：重新聊一次后，新一轮的第 4 次做完前还是旧目标
  const roundIds = new Set(dir?.talk.active_goal_ids ?? []);
  const goals = (dir?.confirmed ?? []).filter((p) => p.level === "目标" && roundIds.has(p.id)).sort((a, b) => a.id - b.id).slice(0, 3);
  const doneN = dir?.talk.steps.filter((x) => x.status === "done").length ?? 0;
  const c4 = dir?.talk.answers["4"]?.choose;
  const needChoose = dir?.talk.steps.some((x) => x.step === 4 && x.status === "done") && (c4 === null || c4 === undefined);
  // 「重新聊一次」会开新的一轮、卡上的目标跟着换：第一下只问一句，第二下才真的开
  const [sure, setSure] = useState(false);
  const owe = dir ? dir.talk.steps.reduce((n, x) => n + pendingCount(dir.talk, x.step), 0) : 0; // 关掉长谈时没确认完的提议
  const next = owe > 0 ? { label: `还有 ${owe} 条等你确认`, go: () => router.push("/deep-talk") }
    : needChoose ? { label: "选一个版本", go: () => router.push("/deep-talk?step=4&part=choose") }
    : doneN < 4 ? { label: doneN ? `接着聊第 ${doneN + 1} 次` : "开始第一次长谈", go: () => router.push("/deep-talk") }
    : sure ? { label: "从第 1 次重新开始，旧的会留着 · 再点一次确定", quiet: true,
      go: () => restartDeepTalk().then(() => { setSure(false); router.push("/deep-talk"); }, () => {}) }
    : { label: "重新聊一次", quiet: true, go: () => setSure(true) };

  const classes = new Set((s?.timetable ?? []).map((x) => x.title)).size;
  const summary = s && [classes ? `${classes} 门课` : "", s.habits.length ? `${s.habits.length} 个习惯` : "",
    s.projects?.length ? `${s.projects.length} 个项目` : ""]
    .filter(Boolean).join(" · ");
  const evening = s?.reminders?.evening;
  const marks = s ? [...s.habits.map((h) => [h.title, c.kind.must] as const), ...(s.projects ?? []).map((p) => [p.title, c.kind.proj] as const)] : [];

  return (
    <Screen safeTop bottom={TAB_SPACE} sky={now}>
      <Animated.View entering={enter(0)} style={{ gap: space.xs }}>
        <Text style={[type.eyebrow, type.num, { color: c.muted, minHeight: 16, letterSpacing: 0.5 }]}>{summary || " "}</Text>
        <Display>我</Display>
      </Animated.View>

      {dir && (
        <Animated.View entering={enter(1)}>
          <Card style={{ gap: space.xs }}>
            <Eyebrow>我的方向</Eyebrow>
            {mission ? <Text style={[type.title, { color: c.text }]}>{mission.content}</Text> : <Body muted>聊完几次，这里会写下你想去的方向</Body>}
            {goals.map((g) => <Small key={g.id}>{`· ${g.content}`}</Small>)}
            <Pressy onPress={next.go} accessibilityRole="button" accessibilityLabel={next.label} style={{ paddingTop: space.sm }}>
              <Text style={[type.small, { color: "quiet" in next ? c.muted : c.primary, fontWeight: "500" }]}>{next.label}</Text>
            </Pressy>
          </Card>
        </Animated.View>
      )}

      {s && marks.length > 0 && (
        // 我的记号：每个习惯和项目一个，和时间线、本周页里长一样；多了可以横着滑
        <Animated.View entering={enter(1)} style={{ gap: space.sm }}>
          <Eyebrow>我的记号</Eyebrow>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.md, paddingVertical: space.xs, flexGrow: 1, justifyContent: "space-around" }}>
            {marks.map(([t, col]) => (
                <View key={t} accessible accessibilityLabel={t} style={{ alignItems: "center", gap: space.sm, width: 80 }}>
                  <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: `${col}29` }}>
                    <Glyph name={t} color={col} size={40} />
                  </View>
                  <Text style={[type.small, { color: c.muted }]} numberOfLines={1}>{t}</Text>
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
