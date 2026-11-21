import { Redirect, router, useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, RefreshControl, Text, View } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOutUp } from "react-native-reanimated";

import { ApiError, Block, getMe, getToday, getWeek, Me, Plan, Week } from "@/api";
import { Arc } from "@/components/art";
import { enter, Skeleton } from "@/components/motion";
import { dayLabel, kindName, PlanView, toMin, useNow } from "@/components/plan-view";
import { Body, Button, Card, Display, ErrorState, Icon, Notice, Screen, Small, Stat, Title } from "@/components/ui";
import { BATTERY_HINT } from "@/labels";
import { scheduleToday } from "@/notifications";
import { radius, space, TAB_SPACE, type, useColors } from "@/theme";

function greeting(h: number): string {
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 还剩多少分钟 → 大号数字和单位：50 →「50 分钟后结束」，90 →「1 小时 30 分后结束」 */
function spanParts(min: number, tail: string): [number, string][] {
  if (min < 60) return [[min, `分钟${tail}`]];
  const h = Math.floor(min / 60), m = min % 60;
  return m ? [[h, "小时"], [m, `分${tail}`]] : [[h, `小时${tail}`]];
}

const EVENING = 19 * 60; // 这之后实心按钮从「报电量」换成「对账」

/**
 * 今天这一页按一天里的四个状态画，一屏最多一个实心按钮（可以没有）：
 * 白天没报电量 → 报电量；报过了 → 不催，晚上再对账；今天走完没对账 → 按钮放进卡片；对完账 → 今天收好了。
 */
type Phase = "day" | "reported" | "evening" | "over" | "done";

export default function Today() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const c = useColors();
  const navigation = useNavigation();

  const load = useCallback(() => {
    getWeek().then(setWeek, () => {}); // 复盘入口和本周记录拿不到就不显示
    getMe().then(setMe, () => {});
    return getToday().then((p) => {
      setPlan(p);
      setError(null);
      scheduleToday(p.day, p.reminders ?? []).catch(() => {}); // 定不上提醒也不挡着看计划
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
  // 白天提前对过账：照样显示此刻和时间线，到晚上或今天走完才算「收好了」
  const phase: Phase = plan.checked_in && (!canReport || now >= EVENING) ? "done" : !canReport ? "over"
    : now >= EVENING ? "evening" : level ? "reported" : "day";
  const energy = () => router.push("/energy");
  const checkin = () => router.push("/checkin");
  const done = phase === "done";
  const classOver = plan.blocks.some((b) => b.kind === "class" && toMin(b.end) <= now); // 按钮和电量瓷砖用同一个判断
  const left = plan.blocks.filter((b) => b.kind !== "life" && toMin(b.end) > now);
  const lastEnd = plan.blocks.length ? plan.blocks[plan.blocks.length - 1].end : "";
  const summary = done ? "做过的都记下了。" : phase === "over" ? "今天的安排都走完了。"
    : left.length ? `今天还有 ${left.length} 件事，${lastEnd} 收尾。` : "剩下的都是休息时间。";
  const review = week?.review === "due" && (
    <Card i={4} onPress={() => router.push("/review")} label="打开这周的复盘"
      style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <Icon name="reader-outline" size={22} color={c.muted} />
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: c.text }]}>可以复盘这一周了</Text>
        <Small muted>一两分钟，只看事实。</Small>
      </View>
      <Icon name="chevron-forward" size={18} color={c.muted} />
    </Card>
  );
  const night = phase === "evening" || done; // 晚上复盘排在时间线前面，白天排在后面不挤掉时间线

  return (
    <Screen safeTop bottom={TAB_SPACE} sky={now}
      refresh={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}>
      <Animated.View entering={enter(0)} style={{ gap: space.xs }}>
        <Text style={[type.eyebrow, type.num, { color: c.muted }]}>{dayLabel(plan.day)}{now >= 24 * 60 ? " · 凌晨 4 点前还算这一天" : ""}</Text>
        <Display>{greeting(Math.floor(now / 60) % 24)}</Display>
        <Body muted>{summary}</Body>
      </Animated.View>

      {error && <Notice>没连上，显示的是刚才的计划。</Notice>}

      <Animated.View entering={enter(1)}>
        {/* 换的是哪种卡片才淡入；白天、报过、傍晚都是同一张「此刻」卡片，不重来 */}
        <Animated.View key={phase === "over" || done ? phase : "now"} entering={FadeIn.duration(320)}>
          {phase === "over" ? <OverCard blocks={plan.blocks} now={now} onCheckin={checkin} />
            : done ? <DoneCard blocks={plan.blocks} now={now} tomorrow={plan.tomorrow_task ?? null} />
            : <NowCard blocks={plan.blocks} now={now} />}
        </Animated.View>
      </Animated.View>

      {phase !== "over" && (
        <Animated.View entering={enter(2)} style={{ gap: space.xs }}>
          {phase === "day" && <Button label={classOver ? "下课了，报个电量" : "报个电量"} icon="battery-half-outline" onPress={energy} />}
          {phase === "evening" && <Button label="对个账" icon="moon-outline" onPress={checkin} />}
          {(phase === "day" || phase === "reported") && (
            <Button label={plan.checked_in ? "改一下今天的对账" : "提前对账"} variant="neutral" onPress={checkin} />
          )}
          {done && <Button label="再改一下今晚的对账" variant="neutral" onPress={checkin} />}
        </Animated.View>
      )}

      {!done && <Animated.View entering={enter(3)} style={{ flexDirection: "row", gap: space.md }}>
        <Stat label="电量" value={level ?? "—"} unit={level ? `格 · ${BATTERY_HINT[level]}` : undefined}
          sub={level ? (canReport ? "变了可以再报" : undefined) : !canReport ? "今天没报" : classOver ? "还没报" : "下课后报一下"}
          onPress={canReport ? energy : undefined} a11y={level ? `电量 ${level} 格，点一下重新报` : "报电量"}>
          <Cells n={5} lit={level ?? 0} color={c.kind.must} />
        </Stat>
        {week && (
          <Stat label="记了几晚" value={week.logged_days} unit="/ 7 晚">
            <Cells n={7} lit={-1} marks={week.logged} color={c.kind.must} round />
          </Stat>
        )}
      </Animated.View>}

      {night && review}

      {!done && (
        <Animated.View entering={enter(5)}>
          <PlanView plan={plan} now={now} showEnergy={false} fold title={canReport ? "接下来" : "今天"} />
        </Animated.View>
      )}

      {!night && review}
    </Screen>
  );
}

/** 瓷砖底下的一排小格：电量亮几格，或者七晚哪几晚记了。 */
function Cells({ n, lit, marks, color, round }: { n: number; lit: number; marks?: boolean[]; color: string; round?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 4, marginTop: space.sm }} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ flex: round ? undefined : 1, width: round ? 8 : undefined, height: round ? 8 : 6,
          borderRadius: radius.pill, backgroundColor: (marks ? marks[i] : i < lit) ? color : c.sunken }} />
      ))}
    </View>
  );
}

const HERO = { alignItems: "center", gap: space.sm, paddingVertical: space.sm } as const;

/** 首屏的弧：量出宽度再画。 */
function HeroArc({ blocks, now, done }: { blocks: Block[]; now: number; done?: boolean }) {
  const [w, setW] = useState(0);
  return (
    <View style={{ alignSelf: "stretch", height: 132 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Arc blocks={blocks} now={now} width={w} height={132} done={done} />
    </View>
  );
}

/** 大号数字：分钟变了，旧的往上淡出、新的从下面淡入。 */
function BigNumber({ parts }: { parts: [number, string][] }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", justifyContent: "center" }}>
      {parts.map(([n, u]) => (
        <View key={u} style={{ flexDirection: "row", alignItems: "baseline", marginRight: space.sm }}>
          <Animated.Text key={n} entering={FadeInUp.duration(200)} exiting={Platform.OS === "web" ? undefined : FadeOutUp.duration(200)}
            style={[type.hero, { color: c.text }]}>{n}</Animated.Text>
          <Text style={[type.label, { color: c.muted, marginLeft: space.xs }]}>{u}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * 「此刻」：一屏唯一的主角，不装在卡片里，直接画在天色上。
 * 上面是今天的弧（光点是现在），弧里是衬线大数字，下面是在做什么、然后做什么。空档里说下一件和离开始还有多久。
 */
function NowCard({ blocks, now }: { blocks: Block[]; now: number }) {
  const c = useColors();
  const cur = blocks.find((b) => toMin(b.start) <= now && now < toMin(b.end));
  const later = blocks.filter((b) => toMin(b.start) > now);
  const next = later.find((b) => b.kind !== "life") ?? later[0]; // 后面只剩吃饭、自由时间，也说一声
  const b = cur ?? next;
  if (!b) return null;
  const parts = cur ? spanParts(toMin(cur.end) - now, "后结束") : spanParts(toMin(b.start) - now, "后开始");
  const after = cur && next ? next : null;
  const meta = [kindName(b), b.pomodoros ? `番茄 ${b.pomodoros} 个` : ""].filter(Boolean).join(" · ");
  const said = parts.map(([n, u]) => `${n} ${u}`).join(" ");
  return (
    <View accessible accessibilityLabel={[cur ? "现在" : "接下来", b.title, said, after && `然后 ${after.start} ${after.title}`]
      .filter(Boolean).join("，")} style={HERO}>
      <View style={{ alignSelf: "stretch" }}>
        <HeroArc blocks={blocks} now={now} />
        <View style={{ position: "absolute", left: 0, right: 0, bottom: -8 }}>
          <BigNumber parts={parts} />
        </View>
      </View>
      <Text style={[type.eyebrow, type.num, { color: c.primary, marginTop: space.md }]}>
        {cur ? "现在" : "接下来"} · {b.start}–{b.end}
      </Text>
      <Text style={[type.display, { color: c.text, textAlign: "center" }]} numberOfLines={2}>
        {b.kind === "life" ? b.title.split("：")[0] : b.title}
      </Text>
      {meta !== "" && <Small muted>{meta}</Small>}
      {after && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs,
          paddingVertical: space.xs, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: c.surface }}>
          <Small muted>然后</Small>
          <Text style={[type.small, type.num, { color: c.text }]}>{after.start}</Text>
          <Text style={[type.small, { color: c.text, maxWidth: 200 }]} numberOfLines={1}>{after.title}</Text>
        </View>
      )}
    </View>
  );
}

/** 今天的安排走完了、还没对账：弧整道亮了，一句话，实心按钮就在下面。 */
function OverCard({ blocks, now, onCheckin }: { blocks: Block[]; now: number; onCheckin: () => void }) {
  const c = useColors();
  return (
    <View style={[HERO, { gap: space.md }]}>
      <HeroArc blocks={blocks} now={now} />
      <Text style={[type.eyebrow, { color: c.primary }]}>今天走完了</Text>
      <Title>花一两分钟对个账，就可以休息了。</Title>
      <Button label="对个账" icon="moon-outline" onPress={onCheckin} />
    </View>
  );
}

/** 对完账：弧收好，只说明天先做什么，然后晚安。 */
function DoneCard({ blocks, now, tomorrow }: { blocks: Block[]; now: number; tomorrow: string | null }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={`今天收好了，${tomorrow ? `明天先做：${tomorrow}` : "明天见"}，晚安`} style={[HERO, { gap: space.md }]}>
      <View style={{ alignSelf: "stretch" }}>
        <HeroArc blocks={blocks} now={now} done />
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 4, alignItems: "center" }}>
          <Icon name="moon" size={40} color={c.primary} />
        </View>
      </View>
      <Text style={[type.eyebrow, { color: c.primary }]}>今天收好了</Text>
      {tomorrow ? (
        <View style={{ gap: 2, alignItems: "center" }}>
          <Small muted>明天先做</Small>
          <Text style={[type.display, { color: c.text, textAlign: "center" }]}>{tomorrow}</Text>
        </View>
      ) : <Title>明天见。</Title>}
      <Text style={[type.label, { color: c.muted, fontWeight: "400" }]}>晚安。</Text>
    </View>
  );
}

function TodaySkeleton() {
  return (
    <Screen safeTop bottom={TAB_SPACE}>
      <Skeleton height={14} width={140} />
      <Skeleton height={36} width={120} />
      <Skeleton height={260} r={radius.xl} />
      <Skeleton height={52} r={radius.pill} />
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ flex: 1 }}><Skeleton height={96} r={radius.lg} /></View>
        <View style={{ flex: 1 }}><Skeleton height={96} r={radius.lg} /></View>
      </View>
      <Skeleton height={200} r={radius.lg} />
    </Screen>
  );
}
