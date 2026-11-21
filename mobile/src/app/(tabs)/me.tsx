import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { DeepTalkState, getDeepTalk, getLetters, getProfile, getQuarter, getSettings, getToday, pendingCount, Profile, Quarter, restartDeepTalk, Settings } from "@/api";
import { clayIcon } from "@/clay-icon";
import { EventIcon, Figure } from "@/components/clay";
import { enter, Skeleton } from "@/components/motion";
import { Button, Card, ErrorState, ListRow, Notice, Screen, Small } from "@/components/ui";
import { radius, space, TAB_SPACE, type, useColors, useDark } from "@/theme";

/**
 * 「我」（v4 的 #pg-me）：顶上站着小人（表情跟今天报的电量，没报就是微笑），下面依次是我的方向、长谈进度和主按钮、我的记号，
 * 最后是计划设置和隐私数据的入口。读的时候方向、长谈、记号先放骨架（版面不跳）；全没拿到整页换 ErrorState，拿到一部分顶上说一句。
 */
export default function MeScreen() {
  const c = useColors();
  const dark = useDark();
  const [s, setS] = useState<Settings | null>(null);
  const [dir, setDir] = useState<{ talk: DeepTalkState; confirmed: Profile[] } | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [hasLetters, setHasLetters] = useState(false);
  const [quarter, setQuarter] = useState<{ available: boolean; last: Quarter | null } | null>(null);
  const load = useCallback(() => {
    setFailed(false);
    getToday().then((p) => setLevel(p.energy_level), () => {}); // 拿不到就和今天页一样微笑
    getLetters().then((r) => setHasLetters(r.letters.length > 0), () => {}); // 拿不到就不显示这一行
    getQuarter().then(setQuarter, () => {}); // 拿不到就不显示入口
    getSettings().then(setS, () => setFailed(true));
    Promise.all([getDeepTalk(), getProfile()]).then(([talk, p]) => setDir({ talk, confirmed: p.confirmed }), () => setFailed(true));
  }, []);
  useFocusEffect(load);
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
    : sure ? { label: "再点一次，从第 1 次重新开始（旧的留着）", quiet: true,
      go: () => restartDeepTalk().then(() => { setSure(false); router.push("/deep-talk"); }, () => {}) }
    : { label: "重新聊一次", quiet: true, go: () => setSure(true) };

  const classes = new Set((s?.timetable ?? []).map((x) => x.title)).size;
  const summary = s && [classes ? `${classes} 门课` : "", s.habits.length ? `${s.habits.length} 个习惯` : "",
    s.projects?.length ? `${s.projects.length} 个项目` : ""]
    .filter(Boolean).join("，");
  const evening = s?.reminders?.evening;
  const marks = s ? [...s.habits.map((h) => [h.title, "must"] as const), ...(s.projects ?? []).map((p) => [p.title, "proj"] as const)] : [];
  const label = [type.label, { fontSize: 13, color: c.muted }] as const;

  if (failed && !s && !dir) return <Screen safeTop bottom={TAB_SPACE}><ErrorState onRetry={load} /></Screen>;

  return (
    <Screen safeTop bottom={TAB_SPACE}>
      {/* 小镇的一角：顶满，紧贴状态栏下沿 */}
      <View style={{ marginTop: -space.xl, marginHorizontal: -space.lg, height: 212, alignItems: "center", overflow: "hidden",
        borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card, backgroundColor: c.surface2 }}>
        <View style={{ width: 149, height: 190, marginTop: 14 }}><Figure level={level} night={dark} left={0} top={0} /></View>
      </View>

      <Animated.View entering={enter(0)} style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between",
        gap: space.sm, paddingHorizontal: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: c.text }]}>我</Text>
        {!!summary && <Text style={[type.num, { fontSize: 15, color: c.muted }]}>{summary}</Text>}
      </Animated.View>

      {failed && <Notice>没连上，有些内容没显示。回到这一页会再试一次。</Notice>}
      {!dir && !failed && (
        <>
          <Skeleton height={56} width="70%" />
          <Skeleton height={140} r={radius.card} />
        </>
      )}
      {!s && !failed && <Skeleton height={96} />}

      {dir && (
        <Animated.View entering={enter(1)} style={{ gap: space.xs, paddingHorizontal: space.xs }}>
          <Text accessibilityRole="header" style={label}>我的方向</Text>
          {mission ? <Text style={[type.title, { lineHeight: 29, color: c.text }]}>「{mission.content}」</Text>
            : <Text style={[type.body, { color: c.muted }]}>聊完几次，这里会写下你想去的方向</Text>}
          {goals.map((g) => <Small key={g.id}>{g.content}</Small>)}
          {quarter?.last && ( // 点进去看这一季的回顾和几个视角的意见
            <Pressable accessibilityRole="button" accessibilityLabel="看这一季的回顾" onPress={() => router.push("/quarter")}
              style={{ minHeight: 44, justifyContent: "center" }}>
              <Small>{`这一季的重点：${quarter.last.focus}`}</Small>
            </Pressable>
          )}
          {quarter?.last?.goals.map((g, i) => <Small key={i}>{g.text}</Small>)}
        </Animated.View>
      )}

      {dir && (
        <Card i={2} style={{ gap: 10 }}>
          <Text style={[type.label, { fontSize: 15, fontWeight: "700", color: c.text }]}>长谈 <Text style={type.num}>{doneN} / 4</Text></Text>
          <View accessible accessibilityLabel={`4 次里聊完 ${doneN} 次`} style={{ flexDirection: "row", gap: space.sm }}>
            {[0, 1, 2, 3].map((k) => (
              <View key={k} style={{ flex: 1, height: 10, borderRadius: 5, borderWidth: 1.5,
                borderColor: k < doneN ? c.done : c.mark, backgroundColor: k < doneN ? c.done : "transparent" }} />
            ))}
          </View>
          <Button label={next.label} variant={"quiet" in next ? "neutral" : "primary"} onPress={next.go} />
        </Card>
      )}

      {quarter?.available && (
        <Card i={3} style={{ paddingVertical: space.xs }}>
          <ListRow icon="flag-outline" title="可以做一次季度回顾了" onPress={() => router.push("/quarter")} last />
        </Card>
      )}

      {s && marks.length > 0 && (
        // 我的记号：每个习惯和项目一个黏土图标，和今天、本周页里同一个；多了可以横着滑
        <Animated.View entering={enter(3)} style={{ gap: space.sm, paddingHorizontal: space.xs }}>
          <Text accessibilityRole="header" style={label}>我的记号</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.md, flexGrow: 1, justifyContent: "space-around" }}>
            {marks.map(([t, kind]) => (
              <View key={t} accessible accessibilityLabel={t} style={{ alignItems: "center", gap: space.xs, width: 80 }}>
                <EventIcon icon={clayIcon({ title: t, kind })} size={52} />
                <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{t}</Text>
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {hasLetters && (
        <Card i={4} style={{ paddingVertical: space.xs }}>
          <ListRow icon="mail-outline" title="给自己的信" onPress={() => router.push("/letter")} last />
        </Card>
      )}

      <Text accessibilityRole="header" style={[label, { paddingHorizontal: space.xs }]}>计划</Text>
      <Card i={4} style={{ paddingVertical: space.xs }}>
        <ListRow icon="alarm-outline" title="作息和习惯" sub="几点起、几点睡，每天想坚持的事"
          onPress={() => router.push("/settings?part=routine")} />
        <ListRow icon="school-outline" title="课表和项目" sub="每周的课，手上在做的项目" onPress={() => router.push("/settings?part=classes")} />
        <ListRow icon="notifications-outline" title="提醒" sub={evening ? `晚上 ${evening} 提醒对账` : "下课提醒、晚间对账提醒"}
          onPress={() => router.push("/settings?part=reminders")} last />
      </Card>

      <Text accessibilityRole="header" style={[label, { paddingHorizontal: space.xs }]}>隐私和数据</Text>
      <Card i={5} style={{ paddingVertical: space.xs }}>
        <ListRow icon="shield-checkmark-outline" title="我的数据" sub="所在国家、导出、删除" onPress={() => router.push("/data")} />
        <ListRow icon="document-text-outline" title="隐私说明" sub="数据存在哪、发给谁" onPress={() => router.push("/privacy")} last />
      </Card>

      <Animated.View entering={enter(6)} style={{ alignItems: "center", paddingTop: space.sm }}>
        <Small muted>Wayfinder {Constants.expoConfig?.version ?? ""}</Small>
      </Animated.View>
    </Screen>
  );
}
