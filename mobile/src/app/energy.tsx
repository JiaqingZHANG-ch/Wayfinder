import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { ApiError, Block, confirmPlan, getToday, isCrisis, Plan, postEnergy, say } from "@/api";
import { planDiff } from "@/diff";
import { EASE, haptic, Pressy, Skeleton } from "@/components/motion";
import { BATTERY_HINT } from "@/labels";
import { PlanView } from "@/components/plan-view";
import { Sheet } from "@/components/sheet";
import { Button, Card, CrisisCard, Icon, IconButton, Notice, Small, Title } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const nowHHMM = () => new Date().toTimeString().slice(0, 5);

/** 下课后报电量：底部弹出的面板。点一格 → 后端只重排今晚 → 先列出改了哪几处，点「就这样」才算确认。 */
export default function EnergyScreen() {
  return (
    <Sheet header={(close) => (
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Title>现在电量几格？</Title>
          <Small muted>只动现在之后的安排。</Small>
        </View>
        <IconButton name="close" label="关闭" onPress={close} />
      </View>
    )}>
      {(close) => <EnergyPanel close={close} />}
    </Sheet>
  );
}

function EnergyPanel({ close }: { close: () => void }) {
  const c = useColors();
  const [level, setLevel] = useState<number | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean; retry?: number } | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [from] = useState(nowHHMM);
  const [before, setBefore] = useState<Block[] | null>(null); // 报之前的安排，用来比出改了什么；拿不到就只显示新安排
  const [full, setFull] = useState(false); // 今晚完整的安排默认收起：用户要看的是改了什么

  useEffect(() => {
    getToday().then((p) => setBefore((b) => b ?? p.blocks), () => {});
  }, []);
  const changes = plan && before ? planDiff(before, plan.blocks, from) : null;

  async function report(n: number) {
    haptic.select();
    setLevel(n);
    setBusy(true);
    setMessage(null);
    setCrisis(null);
    // 换一格时不清掉上一次的结果：旧的改动先变淡留在原地，新的回来再换，面板不塌下去再长回来
    try {
      // 面板刚打开就点、原来的安排还没拿到时，先拿到再报，不然比出来是「不用动」
      if (!before) await getToday().then((p) => setBefore((b) => b ?? p.blocks), () => {});
      const res = await postEnergy(n, true); // 先预览：关掉面板就什么都没改
      if (isCrisis(res)) setCrisis(res.message);
      else setPlan(res);
    } catch (e) {
      // 409「今天已经过完了」是状态说明，不是出错；真出错时电池熄掉，不留一个没报上的格数
      const real = !(e instanceof ApiError && e.status === 409);
      if (real) { setLevel(null); setPlan(null); }
      setMessage({ text: say(e), error: real, retry: real ? n : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan || level === null) return;
    setBusy(true); // 连点两次「就这样」只发一次
    try {
      // 点「就这样」才正式报电量、存下这一版，再确认
      const saved = await postEnergy(level);
      if (isCrisis(saved)) { setCrisis(saved.message); return; }
      const res = await confirmPlan(saved.version);
      haptic.success();
      if (res.calendar === "reconnect") {
        setConfirmed(true);
        setMessage({ text: "计划确认好了。Google 日历的授权失效了，要在电脑上重新连一次才会写进日历。", error: false });
      } else if (res.calendar === "failed") {
        setConfirmed(true);
        setMessage({ text: "计划确认好了，但这次没写进日历。", error: false });
      } else close();
    } catch (e) {
      setMessage({ text: say(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.lg, flexShrink: 1 }}>
      <Battery level={level} disabled={busy || confirmed} onPick={report} />

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        {busy && !plan && (
          <View style={{ gap: space.sm }}>
            <Small muted>正在重排今晚……</Small>
            <Skeleton height={56} />
            <Skeleton height={56} />
          </View>
        )}
        {crisis && <CrisisCard message={crisis} />}
        {message && <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice>}
        {message?.retry && <Button label="再试一次" icon="refresh" variant="secondary" onPress={() => report(message.retry!)} />}
        {plan && (
          <Animated.View entering={FadeIn.duration(260)} pointerEvents={busy ? "none" : "auto"}
            style={{ gap: space.md, opacity: busy ? 0.4 : 1, transitionProperty: "opacity", transitionDuration: "160ms" }}>
            {changes && <Changes changes={changes} />}
            {changes && (
              <Pressy onPress={() => setFull(!full)} accessibilityRole="button" accessibilityState={{ expanded: full }}
                scaleTo={0.98} style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 44 }}>
                <Small muted>{full ? "收起今晚的安排" : "看今晚完整的安排"}</Small>
                <Icon name={full ? "chevron-up" : "chevron-down"} size={14} color={c.muted} />
              </Pressy>
            )}
            {(full || !changes) && <PlanView plan={plan} from={from} showEnergy={false} />}
          </Animated.View>
        )}
      </ScrollView>

      {plan && !confirmed && <Button label="就这样" icon="checkmark" disabled={busy} onPress={confirm} />}
      {confirmed && <Button label="好" variant="secondary" onPress={close} />}
    </View>
  );
}

/** 改了的几处，一行一句话：「看书　45 分 → 10 分（保底）」。新加的用绿色，今晚不排了的用灰色；一行接一行进场。 */
function Changes({ changes }: { changes: ReturnType<typeof planDiff> }) {
  const c = useColors();
  if (!changes.length) return <Text style={[type.label, { color: c.text }]}>今晚不用动，照原来的来。</Text>;
  const floors = changes.some((x) => x.title.endsWith("（保底）"));
  return (
    <Card style={{ gap: space.sm }}>
      <Text style={[type.label, { color: c.text }]}>帮你改了 {changes.length} 处</Text>
      {changes.map((x, i) => {
        const floor = x.title.endsWith("（保底）");
        const name = floor ? x.title.slice(0, -4) : x.title;
        const dropped = x.now === "今晚不排了";
        const said = x.was ? `从 ${x.was} 改成 ${x.now}${floor ? "，保底" : ""}` : x.now;
        return (
          <Animated.View key={`${x.time}${x.title}`} entering={FadeInDown.delay(120 + i * 60).duration(240).easing(EASE)}
            accessible accessibilityLabel={`${x.time} ${name}，${said}`}
            style={{ flexDirection: "row", gap: space.sm, alignItems: "baseline", minHeight: 28 }}>
            <Text style={[type.small, type.num, { width: 44, color: c.muted }]}>{x.time}</Text>
            <Text style={[type.label, { flex: 1, color: dropped ? c.muted : c.text }]} numberOfLines={1}>{name}</Text>
            {x.was && <Text style={[type.small, type.num, { color: c.muted, textDecorationLine: "line-through" }]}>{x.was}</Text>}
            {x.was && <Small muted>→</Small>}
            <Text style={[type.small, type.num, { fontWeight: dropped ? "400" : "600",
              color: dropped ? c.muted : x.was ? c.text : c.ok }]}>{x.now}{floor ? "（保底）" : ""}</Text>
          </Animated.View>
        );
      })}
      {floors && <Small muted>累的时候，习惯只排保底的那几分钟。</Small>}
    </Card>
  );
}

const CELLS = [1, 2, 3, 4, 5];

/**
 * 一节电池，五格连在一起：点一格，或者横着滑、松手才算选了。亮的格子从第 1 格依次亮到第 n 格，只用一个颜色。
 * 格子里不写数字，选了几格写在电池上方。
 */
function Battery({ level, disabled, onPick }: { level: number | null; disabled: boolean; onPick: (n: number) => void }) {
  const c = useColors();
  const [hover, setHover] = useState<number | null>(null); // 滑动中指着的格数，松手前只是预览
  const width = useSharedValue(0);
  const last = useRef<number | null>(null);
  const shown = hover ?? level;

  const point = (n: number) => {
    if (last.current === n) return;
    last.current = n;
    haptic.select();
    setHover(n);
  };
  const release = (commit: boolean) => {
    const n = last.current;
    last.current = null;
    setHover(null);
    if (commit && n !== null) onPick(n);
  };
  const slide = usePanGesture({
    enabled: !disabled,
    activeOffsetX: [-8, 8],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      if (width.value > 0) scheduleOnRN(point, Math.max(1, Math.min(5, Math.ceil((e.x / width.value) * 5))));
    },
    onDeactivate: (e) => { scheduleOnRN(release, !e.canceled); }, // 被系统打断（来电、手势被抢）不算选了
  });

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="电量" style={{ gap: space.md }}>
      {/* 没选时是一句小字提示，选了是大字；高度固定，选的时候电池不往下跳 */}
      <View style={{ height: 56, justifyContent: "center" }}>
        {/* 只有数字用衬线大字，「格 · 还行」用标题字，基线对齐 */}
        <Text style={{ textAlign: "center" }}>
          {shown ? <>
            <Text style={[type.big, { color: c.text }]}>{shown}</Text>
            <Text style={[type.title, { color: c.text }]}> 格 · {BATTERY_HINT[shown]}</Text>
          </> : <Text style={[type.label, { color: c.muted, fontWeight: "400" }]}>点一格，或者横着滑</Text>}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <GestureDetector gesture={slide}>
          <View onLayout={(e) => width.set(e.nativeEvent.layout.width)}
            style={{ flex: 1, flexDirection: "row", gap: 3, padding: 5, borderRadius: radius.lg, borderWidth: 2, borderColor: c.line }}>
            {CELLS.map((n) => (
              <Cell key={n} n={n} lit={shown !== null && n <= shown} checked={level === n} disabled={disabled}
                onPress={() => onPick(n)} />
            ))}
          </View>
        </GestureDetector>
        <View style={{ width: 8, height: 28, marginLeft: 3, borderRadius: 4, backgroundColor: c.line }} />
      </View>
      <View style={{ flexDirection: "row", paddingLeft: 7, paddingRight: 18 }}>
        {CELLS.map((n) => (
          <Text key={n} style={[type.small, { flex: 1, textAlign: "center", color: shown === n ? c.text : c.muted,
            fontWeight: shown === n ? "600" : "400" }]}>{BATTERY_HINT[n]}</Text>
        ))}
      </View>
    </View>
  );
}

/** 一格：亮起来时从第 1 格往后依次亮，每格错开 40ms；熄灭不等。 */
function Cell({ n, lit, checked, disabled, onPress }: { n: number; lit: boolean; checked: boolean; disabled: boolean; onPress: () => void }) {
  const c = useColors();
  const on = useSharedValue(lit ? 1 : 0);
  useEffect(() => {
    on.set(lit ? withDelay((n - 1) * 40, withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) })) : withTiming(0, { duration: 120 }));
  }, [lit, n, on]);
  const fill = useAnimatedStyle(() => ({ opacity: on.value }));
  return (
    <Pressy onPress={onPress} disabled={disabled} scaleTo={0.94}
      accessibilityRole="radio" accessibilityState={{ checked, disabled }} accessibilityLabel={`电量 ${n} 格，${BATTERY_HINT[n]}`}
      style={{ flex: 1, height: 64, borderRadius: 6, backgroundColor: c.sunken, overflow: "hidden" }}>
      <Animated.View pointerEvents="none" style={[{ flex: 1, backgroundColor: c.kind.must }, fill]} />
    </Pressy>
  );
}
