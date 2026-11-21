import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { Redirect, router, useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, RefreshControl, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, Block, confirmPlan, deleteBlock, editBlock, getMe, getToday, isCrisis, Me, Plan, reflow, say, sayDay, transcribe } from "@/api";
import { Changes } from "@/components/changes";
import { planDiff } from "@/diff";
import { enter, haptic, Pressy, Skeleton } from "@/components/motion";
import { dayLabel, fromMin, toMin, useNow } from "@/components/plan-view";
import { Timeline } from "@/components/timeline";
import { Button, CrisisCard, ErrorState, Field, Icon, Notice, Screen, Small } from "@/components/ui";
import { scheduleReminders } from "@/notifications";
import { radius, space, TAB_SPACE, type, useColors } from "@/theme";

const EVENING = 19 * 60; // 这之后主按钮是「对个账」
const EXAMPLE = "9 点到 11 点上课，下午写报告，晚上健身一小时";
const TOUCH = 44;
const MAX_REC = 60; // 最长录这么多秒，到了自动停
const NO_MIC = "录不了音，用键盘上的话筒说也行。";

/** 「2026-11-21」所在那一周（星期一到星期日）：每天的星期几和几号。 */
function weekOf(day: string) {
  const d = new Date(`${day}T12:00:00`);
  const at = (d.getDay() + 6) % 7; // 星期一是 0
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() - at + i);
    return { wd: "一二三四五六日"[i], date: x.getDate(), today: i === at };
  });
}

/**
 * 今天：暖橙头卡（今天、日期、本周日期条、报电量小按钮）→ 输入条（说一句今天要做什么，点「排一下」）→ 按比例的时间轴。
 * 主按钮固定在标签栏上方：排出来的计划还没确认时是「用这个计划」，19:00 以后或正事都做完是「对个账」，对过账就不放。
 */
export default function Today() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"say" | "confirm" | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null); // 排一下、确认的结果说明（没听清、日历没写进去）
  const [ask, setAsk] = useState(false); // 手动改过：问要不要把其余的重排
  const [reflowing, setReflowing] = useState(false);
  const [moved, setMoved] = useState<Block[] | null>(null); // 重排前的块；有它就列出改了几处
  const [mic, setMic] = useState<"rec" | "send" | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const secs = Math.floor(useAudioRecorderState(recorder).durationMillis / 1000);
  const last = useRef<string | null>(null);
  const now = useNow();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const load = useCallback(() => {
    getMe().then(setMe, () => {});
    return getToday().then((p) => {
      if (last.current && last.current !== p.day) setSaid(null); // 换了一天，昨天的说明不留
      last.current = p.day;
      setPlan(p);
      setError(null);
      // 定不上提醒也不挡着看计划
      scheduleReminders([...(p.reminders ?? []).map((r) => ({ ...r, day: p.day })), ...(p.later_reminders ?? [])]).catch(() => {});
    }, setError);
  }, []);

  // 每次回到这一页都重新拿：报完电量、对完账回来，看到的就是新计划。
  // 从提醒直接进报电量面板时，这页垫在下面、没有焦点，就在打开时先拿一次。
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (!navigation.isFocused()) load(); }, [load, navigation]);
  // 从后台切回来（比如第二天早上）也重新拿：不然还显示昨天的计划
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") load(); });
    return () => sub.remove();
  }, [load]);
  // 已经有计划时刷新失败：顶上说一句，4 秒后收起，计划照旧显示
  useEffect(() => {
    if (!error || !plan) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error, plan]);

  /** 排一下：这句话替换今天说过的全部事项，拿回一版还没确认的计划。 */
  async function arrange() {
    setBusy("say");
    setSaid(null);
    setCrisis(null);
    try {
      const res = await sayDay(text.trim());
      if (isCrisis(res)) setCrisis(res.message);
      else {
        haptic.success();
        setPlan(res);
        setAsk(false);
        setMoved(null);
        setText("");
      }
    } catch (e) {
      setSaid(say(e)); // 422：「没听清，换个说法或直接加」
    }
    setBusy(null);
  }

  /** 点话筒：没在录就请权限、开始录；在录就停下、送去转写，文字追加进输入框（不自动排）。 */
  async function toggleMic() {
    if (mic === "send") return;
    setSaid(null);
    if (mic === "rec") {
      setMic("send");
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
        const t = (await transcribe(recorder.uri!)).trim();
        if (t) setText((x) => (x.trim() ? x.trimEnd() + " " : "") + t);
        else setSaid("没听清，再说一次，或者直接打字。");
      } catch (e) {
        setSaid(e instanceof ApiError ? e.message : NO_MIC);
      }
      setMic(null);
      return;
    }
    try {
      if (Platform.OS === "web" && !window.isSecureContext) throw new Error("insecure");
      if (!(await requestRecordingPermissionsAsync()).granted) throw new Error("denied");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setMic("rec");
    } catch {
      setSaid(NO_MIC);
    }
  }
  // 录满 60 秒自动停（走和点停止一样的路）
  useEffect(() => {
    if (mic !== "rec") return;
    const t = setTimeout(toggleMic, MAX_REC * 1000);
    return () => clearTimeout(t);
  }, [mic]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm(version: number) {
    setBusy("confirm");
    setSaid(null);
    try {
      const res = await confirmPlan(version);
      haptic.success();
      if (res.calendar === "reconnect") setSaid("Google 日历的授权失效了，要在电脑上重新连一次。");
      else if (res.calendar === "failed") setSaid("这次没写进日历。");
      await load();
    } catch (e) {
      setSaid(say(e));
    }
    setBusy(null);
  }

  /** 手动改一块的时间（拖、拉、面板里改时长都走这里）：返回错误说明，成功是 null。 */
  async function edit(b: Block, start: number, end: number) {
    if (!plan) return null;
    try {
      const res = await editBlock(plan.version, b.id, fromMin(start), fromMin(end));
      setPlan(res);
      setAsk(true);
      setMoved(null);
      return null;
    } catch (e) {
      return stale(e);
    }
  }

  async function remove(b: Block) {
    if (!plan) return null;
    try {
      setPlan(await deleteBlock(b.id, plan.version));
      setAsk(true);
      setMoved(null);
      return null;
    } catch (e) {
      return stale(e);
    }
  }

  /** 409 = 计划在别处变过：重新拿一遍，让用户再来一次。 */
  function stale(e: unknown) {
    if (e instanceof ApiError && e.status === 409) {
      load();
      return "计划刚在别处改过，已经刷新，再试一次。";
    }
    return say(e);
  }

  async function doReflow() {
    if (!plan) return;
    setReflowing(true);
    try {
      const { before, ...next } = await reflow(plan.version);
      setPlan(next);
      setMoved(before);
      setAsk(false);
    } catch (e) {
      setSaid(stale(e));
    }
    setReflowing(false);
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (error instanceof ApiError && error.status === 409) return <Redirect href="/onboarding" />; // 还没建档
  if (error instanceof ApiError && error.status === 422 && !plan) {
    // 这一天的课和习惯排不下：说清楚原因，给去改设置的路（不是网络问题）
    return (
      <Screen scroll={false} safeTop>
        <ErrorState onRetry={load} title="今天排不出来" text={error.message}>
          <Button label="去改设置" variant="neutral" onPress={() => router.push("/settings?part=classes")} />
        </ErrorState>
      </Screen>
    );
  }
  if (error && !plan) return <Screen scroll={false} safeTop><ErrorState onRetry={load} /></Screen>;
  if (!plan) return <TodaySkeleton />;
  if (me && !me.consented) return <Redirect href="/consent" />; // 隐私说明换了新版本：老用户先看完再用

  // 正事：课、习惯、项目、可选；吃饭、路上、回家这些生活块不算
  const todo = plan.blocks.filter((b) => b.kind !== "life" && toMin(b.end) > now).length;
  const evening = !plan.checked_in && (now >= EVENING || !todo);
  const askBar = ask && !plan.checked_in && (
    <View style={{ gap: space.sm }}>
      <Text accessibilityLiveRegion="polite" style={[type.label, { color: c.text }]}>要不要把其余的按精力重新排一下？</Text>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}><Button label="重排" busyLabel={reflowing ? "正在重排……" : undefined} onPress={doReflow} /></View>
        <View style={{ flex: 1 }}><Button label="不用" variant="secondary" disabled={reflowing} onPress={() => setAsk(false)} /></View>
      </View>
    </View>
  );
  const main = evening ? <Button label="对个账" onPress={() => router.push("/checkin")} />
    : !plan.confirmed && !plan.checked_in ? (
      <Button label="用这个计划" busyLabel={busy === "confirm" ? "正在确认……" : undefined} onPress={() => confirm(plan.version)} />
    ) : undefined;
  const footer = askBar || main ? <View style={{ gap: space.md }}>{askBar}{main}</View> : undefined;
  const empty = !plan.items?.length;
  const canSay = !!text.trim() && !busy;
  const week = weekOf(plan.day);

  return (
    <Screen bottom={TAB_SPACE} footer={footer}
      refresh={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primaryEdge} />}>
      {/* 头卡顶满：抵掉 Screen 的内边距，状态栏叠在橙色上 */}
      <View style={{ marginTop: -space.lg, marginHorizontal: -space.lg, paddingTop: insets.top + space.lg, paddingHorizontal: space.lg,
        paddingBottom: space.lg, gap: space.lg, backgroundColor: c.head,
        borderBottomLeftRadius: radius.xl + 4, borderBottomRightRadius: radius.xl + 4 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={[type.display, { fontSize: 34, lineHeight: 42, color: c.onHead }]}>今天</Text>
            <Text style={[type.label, { color: c.onHead }]}>{dayLabel(plan.day)}</Text>
          </View>
          <Pressy onPress={() => router.push("/energy")} accessibilityRole="button" accessibilityLabel="报个电量" scaleTo={0.9}
            style={{ width: TOUCH + 4, height: TOUCH + 4, borderRadius: radius.pill, backgroundColor: c.primary, boxShadow: c.clayBtn,
              alignItems: "center", justifyContent: "center" }}>
            <Icon name="battery-half-outline" size={22} color={c.onPrimary} />
          </Pressy>
        </View>
        <View accessible accessibilityLabel={`本周，今天是星期${week.find((d) => d.today)?.wd}`}
          style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {week.map((d) => (
            <View key={d.wd} style={{ width: 40, paddingVertical: space.sm, borderRadius: radius.btn, alignItems: "center", gap: 2,
              backgroundColor: d.today ? c.surface : "transparent" }}>
              <Text style={[type.small, { color: d.today ? c.text : c.onHead }]}>{d.wd}</Text>
              <Text style={[type.label, type.num, { color: d.today ? c.text : c.onHead }]}>{d.date}</Text>
            </View>
          ))}
        </View>
      </View>

      {error && <Notice>没连上，显示的是刚才的计划。</Notice>}

      <Animated.View entering={enter(1)} style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Field style={{ flex: 1 }} placeholder="说说今天要做什么" accessibilityLabel="说说今天要做什么" value={text}
            onChangeText={setText} returnKeyType="done" onSubmitEditing={() => { if (canSay) arrange(); }} />
          {mic === "rec" && <Text accessibilityElementsHidden style={[type.label, type.num, { color: c.muted }]}>{secs} 秒</Text>}
          <Pressy onPress={toggleMic} disabled={mic === "send"} accessibilityRole="button"
            accessibilityLabel={mic === "rec" ? "停止录音" : "开始说话"} accessibilityState={{ busy: mic === "send" }} scaleTo={0.9}
            style={{ width: TOUCH, height: TOUCH, borderRadius: radius.pill, backgroundColor: mic === "rec" ? c.primary : c.surface2,
              opacity: mic === "send" ? 0.5 : 1, alignItems: "center", justifyContent: "center" }}>
            {mic === "send" ? <ActivityIndicator size="small" color={c.muted} />
              : <Icon name={mic === "rec" ? "stop" : "mic-outline"} size={20} color={mic === "rec" ? c.onPrimary : c.text} />}
          </Pressy>
        </View>
        <Button label="排一下" busyLabel={busy === "say" ? "正在排……" : undefined} disabled={!canSay} onPress={arrange} />
        {empty && (
          <View style={{ gap: space.xs, paddingHorizontal: space.xs }}>
            <Small muted>还没说今天要做的事。可以这样说：</Small>
            <Pressy onPress={() => setText(EXAMPLE)} accessibilityRole="button" accessibilityLabel={`填进例句：${EXAMPLE}`}
              accessibilityHint="填进输入框，再点排一下" scaleTo={0.98}
              style={{ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.btn,
                backgroundColor: c.surface2 }}>
              <Text style={[type.label, { color: c.text }]}>「{EXAMPLE}」</Text>
            </Pressy>
          </View>
        )}
      </Animated.View>

      {crisis && <CrisisCard message={crisis} />}
      {said && <Notice>{said}</Notice>}
      {plan.warnings.map((w) => <Notice key={w}>{w}</Notice>)}

      {moved && (
        <View style={{ gap: space.sm }}>
          {(() => { const ch = planDiff(moved, plan.blocks, "00:00"); return ch.length ? <Changes changes={ch} /> : <Notice>其余的不用动，照原来的来。</Notice>; })()}
          <Button label="知道了" variant="quiet" onPress={() => setMoved(null)} />
        </View>
      )}

      <Animated.View entering={enter(2)}>
        <Timeline blocks={plan.blocks} items={plan.items} now={now} onEdit={edit} onDelete={remove} />
      </Animated.View>
    </Screen>
  );
}

function TodaySkeleton() {
  return (
    <Screen bottom={TAB_SPACE}>
      <View style={{ marginTop: -space.lg, marginHorizontal: -space.lg }}><Skeleton height={220} r={radius.xl} /></View>
      <Skeleton height={48} r={radius.in} />
      <Skeleton height={320} r={radius.btn} />
    </Screen>
  );
}
