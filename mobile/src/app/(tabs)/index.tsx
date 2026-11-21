import { Redirect, router, useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, RefreshControl, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, Block, getMe, getToday, Me, Plan } from "@/api";
import { clayIcon } from "@/clay-icon";
import { Battery, Bubble, EventIcon, Figure, Stage } from "@/components/clay";
import { enter, Skeleton } from "@/components/motion";
import { fromMin, toMin, useNow } from "@/components/plan-view";
import { Button, ErrorState, Notice, Screen } from "@/components/ui";
import { Change, planDiff } from "@/diff";
import { scheduleReminders } from "@/notifications";
import { radius, space, TAB_SPACE, type, useColors, useDark } from "@/theme";

const EVENING = 19 * 60; // 这之后主按钮是「对个账」

/**
 * 今天这一页按一天里的四个状态走：白天没报电量 → 报过了 → 晚上该对账（或今天走完了）→ 对完账收好了。
 * 页面只有三样：黏土舞台（小人、石子、导师一句话、电池）、现在还剩几分钟、接下来。
 */
type Phase = "day" | "reported" | "evening" | "over" | "done";

const FEEL: Record<number, string> = {
  1: "歇会儿，后面少排一点。", 2: "有点累，就少做一点。", 3: "好，照原计划。", 4: "不错，照原计划。", 5: "精神好。",
};

/** 导师在气泡里说的一句话。 */
function saying(phase: Phase, level: number | null, ready: boolean, tomorrow: string | null): string {
  if (phase === "done") return tomorrow ? `明天先做：${tomorrow}` : "今天收住了，晚安。";
  if (phase === "over") return "今天走完了，对个账？";
  if (phase === "evening") return "辛苦了，对个账？";
  if (level) return FEEL[level];
  return ready ? "还剩多少电？" : "下课后，告诉我还剩多少电。";
}

// 自由时间不算一件事，也不进「接下来」
const isFree = (b: Block) => b.kind === "life" && b.title.startsWith("自由时间");
// 吃饭、路上这类生活块只留冒号、括号前那段
const shortTitle = (b: Block) => (b.kind === "life" ? b.title.split(/[：（]/)[0] : b.title);

/** 行的副标题：课写到几点，项目写番茄，其余写时长；被重排改过的写「10 分钟 · 原 30」。 */
function note(b: Block, x?: Change): string {
  if (x?.was) return `${x.now.replace(" 分", "")} 分钟 · 原 ${x.was.replace(" 分", "")}`;
  if (x?.now.startsWith("挪到")) return `原 ${x.time}`;
  if (x) return x.now.replace(" 分", " 分钟");
  if (b.kind === "life") return "";
  if (b.kind === "class") return `到 ${b.end}`;
  if (b.pomodoros) return `${b.pomodoros} 个番茄`;
  return `${toMin(b.end) - toMin(b.start)} 分钟`;
}

export default function Today() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [before, setBefore] = useState<Block[] | null>(null); // 这次重排之前的计划：比出哪几行被改了
  const last = useRef<Plan | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const c = useColors();
  const dark = useDark();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const load = useCallback(() => {
    getMe().then(setMe, () => {});
    return getToday().then((p) => {
      const old = last.current;
      // shortcut: 改过的行只在这次打开 App 期间标出来；要留到当晚得让后端带上重排前的计划
      if (old && old.day === p.day && old.version !== p.version) setBefore(old.blocks);
      else if (old && old.day !== p.day) setBefore(null);
      last.current = p;
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

  const canReport = plan.blocks.some((b) => toMin(b.end) > now); // 今天还有没过去的安排
  const level = plan.energy_level;
  // 白天提前对过账：照样显示现在和接下来，到晚上或今天走完才算「收好了」
  const phase: Phase = plan.checked_in && (!canReport || now >= EVENING) ? "done" : !canReport ? "over"
    : now >= EVENING ? "evening" : level ? "reported" : "day";
  const classOver = plan.blocks.some((b) => b.kind === "class" && toMin(b.end) <= now);
  const ready = classOver || !plan.blocks.some((b) => b.kind === "class"); // 下课了（或今天没课）才问电量

  const cur = plan.blocks.find((b) => toMin(b.start) <= now && now < toMin(b.end));
  const later = plan.blocks.filter((b) => toMin(b.start) > now && !isFree(b));
  const next = cur ?? later.find((b) => b.kind !== "life") ?? later[0];
  const todo = plan.blocks.filter((b) => b.kind !== "life" && toMin(b.end) > now).length; // 还没做的事：一颗石子一件
  const lastEnd = plan.blocks.length ? plan.blocks[plan.blocks.length - 1].end : "";
  // 最后一块排到睡觉；补一行「睡」收尾
  const rows: Block[] = canReport && lastEnd
    ? [...later, { id: "sleep", title: "睡", start: lastEnd, end: lastEnd, kind: "life", task_id: null, pomodoros: null }]
    : later;
  const changes = before ? planDiff(before, plan.blocks, fromMin(now)) : [];
  const changeOf = (b: Block) => changes.find((x) => x.title === b.title && (x.time === b.start || x.now === `挪到 ${b.start}`));
  const left = next && (cur ? toMin(next.end) : toMin(next.start)) - now;

  return (
    <Screen bottom={TAB_SPACE} refresh={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primaryEdge} />}>
      {/* 舞台顶满：抵掉 Screen 的内边距，状态栏叠在场景上 */}
      <View style={{ marginTop: -space.lg, marginHorizontal: -space.lg }}>
        <Stage night={dark} stones={todo}>
          <Bubble text={saying(phase, level, ready, plan.tomorrow_task ?? null)} top={Math.max(54, insets.top + 6)} />
          <Figure level={level} night={dark} />
          {(phase === "day" || phase === "reported") && <Battery level={level} onPress={() => router.push("/energy")} />}
        </Stage>
      </View>

      {error && <Notice>没连上，显示的是刚才的计划。</Notice>}

      <Animated.View entering={enter(1)} accessible
        accessibilityLabel={next ? `${cur ? "现在" : "下一件"}，${shortTitle(next)}，${cur ? "还剩" : "还有"} ${left} 分钟` : "今天走完了"}
        style={{ paddingHorizontal: space.xs }}>
        <Text style={[type.body, { fontSize: 15, lineHeight: 22, fontWeight: "800", color: c.text }]} numberOfLines={1}>
          {next ? `${cur ? "现在" : `${next.start} 开始`} · ${shortTitle(next)}` : "今天走完了"}
        </Text>
        {next && (
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
            <Text style={unit(c.text)}>{cur ? "还剩" : "还有"}</Text>
            <Text style={[type.hero, { color: c.primaryInk }]}>{left}</Text>
            <Text style={unit(c.text)}>分钟</Text>
          </View>
        )}
      </Animated.View>

      {rows.length > 0 && (
        <Animated.View entering={enter(2)} style={{ gap: space.xs }}>
          <Text accessibilityRole="header" style={[type.body, { fontSize: 15, lineHeight: 22, fontWeight: "800", color: c.text,
            paddingHorizontal: space.xs }]}>接下来</Text>
          {rows.map((b, i) => <Row key={`${b.id}${b.start}`} b={b} x={changeOf(b)} first={i === 0 && !dark} />)}
        </Animated.View>
      )}

      {(phase === "evening" || phase === "over") && <Button label="对个账" onPress={() => router.push("/checkin")} />}
    </Screen>
  );
}

const unit = (color: string) => [type.body, { fontSize: 17, lineHeight: 24, fontWeight: "800" as const, color }];

/** 接下来的一行：时间、黏土图标、标题和副标题。下一件是一块卡片底；被重排改过的行是浅主色底。 */
function Row({ b, x, first }: { b: Block; x?: Change; first: boolean }) {
  const c = useColors();
  const life = b.kind === "life";
  const sub = note(b, x);
  return (
    <View accessible accessibilityLabel={[b.start, shortTitle(b), sub, x && "改过"].filter(Boolean).join("，")}
      style={[{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingLeft: space.xs, paddingRight: space.sm,
        borderRadius: radius.btn }, first && { minHeight: 56, backgroundColor: c.surface, boxShadow: c.clay, marginBottom: 6 },
        x && { backgroundColor: c.tint }]}>
      <Text style={[type.num, { width: 44, fontSize: 15, color: c.text }]}>{b.start}</Text>
      <EventIcon icon={b.id === "sleep" ? "sleep" : clayIcon(b)} dim={life} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { fontSize: 16, lineHeight: 20, fontWeight: "800", color: life ? c.muted : c.text }]}
          numberOfLines={1}>{shortTitle(b)}</Text>
        {!!sub && <Text style={[type.small, { lineHeight: 17, fontWeight: "800", color: c.muted }]} numberOfLines={1}>{sub}</Text>}
      </View>
    </View>
  );
}

function TodaySkeleton() {
  return (
    <Screen bottom={TAB_SPACE}>
      <View style={{ marginTop: -space.lg, marginHorizontal: -space.lg }}><Skeleton height={300} r={24} /></View>
      <Skeleton height={22} width={140} />
      <Skeleton height={60} width={200} />
      <Skeleton height={56} r={radius.btn} />
      <Skeleton height={200} r={radius.btn} />
    </Screen>
  );
}
