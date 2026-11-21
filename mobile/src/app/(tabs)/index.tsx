import { Redirect, router, useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, RefreshControl, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, Block, confirmPlan, getMe, getToday, isCrisis, Me, Plan, postEnergy, say } from "@/api";
import { clayIcon } from "@/clay-icon";
import { Battery, Bubble, EventIcon, Figure, Stage } from "@/components/clay";
import { enter, haptic, Skeleton } from "@/components/motion";
import { fromMin, toMin, useNow } from "@/components/plan-view";
import { Button, ErrorState, Notice, Screen } from "@/components/ui";
import { Change, planDiff } from "@/diff";
import { scheduleReminders } from "@/notifications";
import { radius, space, TAB_SPACE, type, useColors, useDark, useNightScene } from "@/theme";

const EVENING = 19 * 60; // 这之后主按钮是「对个账」

/**
 * 今天这一页按一天里的四个状态走：白天没报电量 → 报过了 → 晚上该对账（或正事都做完了）→ 对完账收好了。
 * 页面只有三样：黏土舞台（小人、石子、导师一句话、电池）、现在还剩多久、接下来；主按钮固定在标签栏上方，不跟着滚。
 */
type Phase = "day" | "reported" | "evening" | "over" | "done";

const FEEL: Record<number, string> = {
  1: "歇会儿，后面少排一点。", 2: "有点累，就少做一点。", 3: "好，照原计划。", 4: "不错，照原计划。", 5: "精神好。",
};

/** 导师在气泡里说的一句话。 */
function saying(phase: Phase, level: number | null, ready: boolean, tomorrow: string | null): string {
  if (phase === "done") return tomorrow ? `明天先做：${tomorrow}` : "今天收住了，晚安。";
  if (phase === "over") return "正事都做完了，对个账？";
  if (phase === "evening") return "辛苦了，对个账？";
  if (level) return FEEL[level];
  return ready ? "还剩多少电？" : "下课后，告诉我还剩多少电。";
}

// 自由时间不算一件事，也不进「接下来」
const isFree = (b: Block) => b.kind === "life" && b.title.startsWith("自由时间");
// 正事：课、习惯、项目、可选；吃饭、路上、回家这些生活块不算
const real = (b: Block) => b.kind !== "life";
// 吃饭、路上这类生活块只留冒号、括号前那段
const shortTitle = (b: Block) => (b.kind === "life" ? b.title.split(/[：（]/)[0] : b.title);

/** 行的副标题：课写到几点，项目写番茄，其余写时长；被重排改过的写「10 分钟」，原来的 30 由 Row 划掉写在后面。 */
function note(b: Block, x?: Change): string {
  if (x?.was) return `${x.now.replace(" 分", "")} 分钟`;
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
  const [open, setOpen] = useState(false); // 电量阶梯开着
  const [live, setLive] = useState<number | null>(null); // 正在选的格数：小人跟着换表情，报上以后清掉
  const [said, setSaid] = useState<string | null>(null); // 报电量的结果说明（没报上、日历没写进去）
  const now = useNow();
  const c = useColors();
  const dark = useDark();
  const scene = useNightScene(); // 舞台的白天夜里只看钟点：系统深色时中午还是白天的小镇
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

  function openLadder(on: boolean) {
    setOpen(on);
    setLive(on ? (l) => l ?? plan?.energy_level ?? 3 : null);
  }

  /** 报电量：和 energy.tsx 点「就这样」一样，正式报一次再确认这一版；重新拿计划后被改的行就变色。 */
  async function report(n: number) {
    setOpen(false);
    setLive(n);
    setSaid(null);
    try {
      const saved = await postEnergy(n);
      if (isCrisis(saved)) return; // 只报格数不带字，不会是危机话术
      const res = await confirmPlan(saved.version);
      haptic.success();
      if (res.calendar === "reconnect") setSaid("Google 日历的授权失效了，要在电脑上重新连一次。");
      else if (res.calendar === "failed") setSaid("这次没写进日历。");
      await load();
    } catch (e) {
      setSaid(say(e));
    }
    setLive(null);
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

  const canReport = plan.blocks.some((b) => toMin(b.end) > now); // 今天还有没过去的安排
  const todo = plan.blocks.filter((b) => real(b) && toMin(b.end) > now).length; // 还没做的正事：一颗石子一件
  const level = plan.energy_level;
  // 正事都过去了（只剩吃饭、回家、自由时间）就不再问电量，改成对账；白天提前对过账，到晚上或正事做完才算「收好了」
  const phase: Phase = plan.checked_in && (!todo || now >= EVENING) ? "done" : !todo ? "over"
    : now >= EVENING ? "evening" : level ? "reported" : "day";
  const daytime = phase === "day" || phase === "reported";
  const classOver = plan.blocks.some((b) => b.kind === "class" && toMin(b.end) <= now);
  const ready = classOver || !plan.blocks.some((b) => b.kind === "class"); // 下课了（或今天没课）才问电量

  // 主角只是正事：正在做的那件，不然是下一件正事。吃饭、路上、自由时间都不当主角；只剩生活块时不报数字，说一句话
  const cur = plan.blocks.find((b) => real(b) && toMin(b.start) <= now && now < toMin(b.end));
  const later = plan.blocks.filter((b) => toMin(b.start) > now && !isFree(b));
  const next = cur ?? later.find(real);
  const lastEnd = plan.blocks.length ? plan.blocks[plan.blocks.length - 1].end : "";
  // 最后一块排到睡觉；补一行「睡」收尾
  const rows: Block[] = canReport && lastEnd
    ? [...later, { id: "sleep", title: "睡", start: lastEnd, end: lastEnd, kind: "life", task_id: null, pomodoros: null }]
    : later;
  const changes = before ? planDiff(before, plan.blocks, fromMin(now)) : [];
  const changeOf = (b: Block) => changes.find((x) => x.title === b.title && (x.time === b.start || x.now === `挪到 ${b.start}`));
  const left = next ? (cur ? toMin(next.end) : toMin(next.start)) - now : 0;
  const hours = Math.floor(left / 60), mins = left % 60; // 满 60 分钟写「5 小时 11 分」
  const hi = rows.find(real); // 卡片底的那一行：主角那件（主角是正在做的事时，是下一件正事）
  // 连着的生活块并成一行小字
  const groups = rows.reduce<Block[][]>((acc, b) => {
    const tail = acc[acc.length - 1];
    if (!real(b) && tail && !real(tail[0])) tail.push(b);
    else acc.push([b]);
    return acc;
  }, []);

  const footer = daytime ? (open ? <Button label="就这样" onPress={() => report(live ?? 3)} />
    : <Button label={level ? "再报一次" : "报个电量"} variant={level ? "secondary" : "primary"} onPress={() => openLadder(true)} />)
    : phase === "evening" || phase === "over" ? <Button label="对个账" onPress={() => router.push("/checkin")} /> : undefined;

  return (
    <Screen bottom={TAB_SPACE} footer={footer}
      refresh={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primaryEdge} />}>
      {/* 舞台顶满：抵掉 Screen 的内边距，状态栏叠在场景上 */}
      <View style={{ marginTop: -space.lg, marginHorizontal: -space.lg }}>
        <Stage night={scene} stones={todo}>
          <Bubble text={saying(phase, live ?? level, ready, plan.tomorrow_task ?? null)} top={Math.max(54, insets.top + 6)} hide={open}
            wide={!daytime} onPress={daytime ? () => openLadder(true) : phase === "done" ? undefined : () => router.push("/checkin")} />
          <Figure level={live ?? level} night={scene} onPress={daytime ? () => openLadder(true) : undefined} />
          {daytime && <Battery level={level} live={live} open={open} onOpen={openLadder} onLive={setLive} onPick={report} />}
        </Stage>
      </View>

      {error && <Notice>没连上，显示的是刚才的计划。</Notice>}
      {said && <Notice>{said}</Notice>}

      <Animated.View entering={enter(1)} accessible
        accessibilityLabel={next ? `${cur ? "现在" : "下一件"}，${shortTitle(next)}，${cur ? "还剩" : "还有"} ${hours ? `${hours} 小时 ` : ""}${mins} 分钟`
          : canReport ? "正事都做完了" : "今天走完了"}
        style={{ paddingHorizontal: space.xs }}>
        {next ? (
          <>
            <Text style={[type.label, { fontSize: 15, color: c.muted }]} numberOfLines={1}>
              {cur ? "现在" : `${next.start} 开始`}  <Text style={{ fontWeight: "700", color: c.text }}>{shortTitle(next)}</Text>
            </Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Text style={unit(c.text)}>{cur ? "还剩" : "还有"}</Text>
              {hours > 0 && <><Text style={[type.hero, { color: c.primaryInk }]}>{hours}</Text><Text style={unit(c.text)}>小时</Text></>}
              {(mins > 0 || !hours) && (
                <><Text style={[type.hero, { color: c.primaryInk }]}>{mins}</Text><Text style={unit(c.text)}>{hours ? "分" : "分钟"}</Text></>
              )}
            </View>
          </>
        ) : (
          // 只剩吃饭、回家、自由时间：不报「还有 311 分钟」，说一句人话
          <Text style={[type.title, { color: c.text }]}>{canReport ? "正事都做完了，歇会儿。" : "今天走完了。"}</Text>
        )}
      </Animated.View>

      {rows.length > 0 && (
        <Animated.View entering={enter(2)} style={{ gap: space.xs }}>
          <Text accessibilityRole="header" style={[type.label, { fontSize: 15, fontWeight: "700", color: c.text,
            paddingHorizontal: space.xs }]}>接下来</Text>
          {groups.map((g) => real(g[0])
            ? <Row key={`${g[0].id}${g[0].start}`} b={g[0]} x={changeOf(g[0])} first={g[0] === hi && !dark} />
            : <LifeRow key={`${g[0].id}${g[0].start}`} blocks={g} />)}
        </Animated.View>
      )}
    </Screen>
  );
}

const unit = (color: string) => [type.label, { fontSize: 17, lineHeight: 24, color }];

/** 生活块（吃饭、路上、回家、睡）：一行淡淡的小字，没有图标；连着的几块并在这一行里，各带各的时间。 */
function LifeRow({ blocks }: { blocks: Block[] }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={blocks.map((b) => `${b.start}，${shortTitle(b)}`).join("；")}
      style={{ flexDirection: "row", alignItems: "center", minHeight: 30, paddingLeft: space.xs, paddingRight: space.sm }}>
      <Text numberOfLines={1} style={[type.small, { flex: 1, color: c.muted }]}>
        {blocks.map((b, i) => (
          <Text key={`${b.id}${b.start}`}>{i > 0 && "    "}<Text style={type.num}>{b.start}</Text>{"  "}{shortTitle(b)}</Text>
        ))}
      </Text>
    </View>
  );
}

/** 接下来的一件正事：时间、黏土图标、标题和副标题。下一件是一块卡片底；被重排改过的行是浅主色底。 */
function Row({ b, x, first }: { b: Block; x?: Change; first: boolean }) {
  const c = useColors();
  const sub = note(b, x);
  return (
    <View accessible accessibilityLabel={[b.start, shortTitle(b), sub, x?.was && `原来 ${x.was.replace(" 分", " 分钟")}`, x && "改过"]
      .filter(Boolean).join("，")}
      style={[{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingLeft: space.xs, paddingRight: space.sm,
        borderRadius: radius.btn }, first && { minHeight: 56, backgroundColor: c.surface, boxShadow: c.clay, marginBottom: 6 },
        x && { backgroundColor: c.tint }]}>
      <Text style={[type.num, { width: 44, fontSize: 15, color: c.text }]}>{b.start}</Text>
      <View style={{ width: 32 }}><EventIcon icon={clayIcon(b)} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.label, { fontSize: 16, lineHeight: 20, color: c.text }]}
          numberOfLines={1}>{shortTitle(b)}</Text>
        {!!sub && (
          <Text style={[type.small, { lineHeight: 17, color: c.muted }]} numberOfLines={1}>
            {sub}{x?.was && <>{"  "}<Text style={{ textDecorationLine: "line-through" }}>{x.was.replace(" 分", "")}</Text></>}
          </Text>
        )}
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
