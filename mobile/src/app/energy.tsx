import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { ApiError, confirmPlan, isCrisis, Plan, postEnergy } from "@/api";
import { haptic, Pressy, Skeleton } from "@/components/motion";
import { PlanView } from "@/components/plan-view";
import { Sheet } from "@/components/sheet";
import { Button, CrisisCard, IconButton, Notice, Small, Title } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const nowHHMM = () => new Date().toTimeString().slice(0, 5);
const HINT = ["", "很累了", "有点累", "还行", "不错", "满格"];

/** 下课后报电量：底部弹出的面板。点一格 → 后端只重排今晚 → 先给你看，点「就这样」才算确认。 */
export default function EnergyScreen() {
  return <Sheet>{(close) => <EnergyPanel close={close} />}</Sheet>;
}

function EnergyPanel({ close }: { close: () => void }) {
  const [level, setLevel] = useState<number | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [from] = useState(nowHHMM);

  async function report(n: number) {
    haptic.select();
    setLevel(n);
    setBusy(true);
    setMessage(null);
    setCrisis(null);
    setPlan(null);
    try {
      const res = await postEnergy(n);
      if (isCrisis(res)) setCrisis(res.message);
      else setPlan(res);
    } catch (e) {
      // 409「今天已经过完了」是状态说明，不是出错
      setMessage({ text: (e as Error).message, error: !(e instanceof ApiError && e.status === 409) });
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true); // 连点两次「就这样」只发一次
    try {
      const res = await confirmPlan(plan.version);
      haptic.success();
      if (res.calendar === "reconnect") {
        setConfirmed(true);
        setMessage({ text: "计划确认好了。Google 日历的授权失效了，要在电脑上重新连一次才会写进日历。", error: false });
      } else if (res.calendar === "failed") {
        setConfirmed(true);
        setMessage({ text: "计划确认好了，但这次没写进日历。", error: false });
      } else close();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.lg, flexShrink: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Title>现在电量几格？</Title>
          <Small muted>只会动现在之后的安排。1–2 格时，习惯只排保底版。</Small>
        </View>
        <IconButton name="close" label="关闭" onPress={close} />
      </View>

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
        {plan && (
          <Animated.View entering={FadeIn.duration(260)} style={{ gap: space.md }}>
            <Small muted>今晚这样排：</Small>
            <PlanView plan={plan} from={from} />
          </Animated.View>
        )}
      </ScrollView>

      {plan && !confirmed && <Button label="就这样" icon="checkmark" busyLabel={busy ? "正在确认……" : undefined} onPress={confirm} />}
      {confirmed && <Button label="好" variant="secondary" onPress={close} />}
    </View>
  );
}

/** 五格电池：点第几格就亮到第几格。1–2 格是琥珀色，3 格以上是绿色（字色都过 AA）。 */
function Battery({ level, disabled, onPick }: { level: number | null; disabled: boolean; onPick: (n: number) => void }) {
  const c = useColors();
  const low = level !== null && level <= 2;
  const fill = low ? c.kind.flex : c.ok;
  const ink = low ? c.onWarm : c.onPrimary;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="电量" style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1, flexDirection: "row", gap: 6, padding: 6, borderRadius: radius.lg,
          borderWidth: 2, borderColor: c.line }}>
          {[1, 2, 3, 4, 5].map((n) => {
            const lit = level !== null && n <= level;
            return (
              <Pressy key={n} onPress={() => onPick(n)} disabled={disabled} scaleTo={0.92}
                accessibilityRole="radio" accessibilityState={{ checked: level === n, disabled }}
                accessibilityLabel={`电量 ${n} 格，${HINT[n]}`}
                style={{ flex: 1, height: 64, borderRadius: radius.md - 4, backgroundColor: lit ? fill : c.sunken,
                  alignItems: "center", justifyContent: "center" }}>
                <Text style={[type.title, { color: lit ? ink : c.muted, fontVariant: ["tabular-nums"] }]}>{n}</Text>
              </Pressy>
            );
          })}
        </View>
        <View style={{ width: 6, height: 24, marginLeft: 3, borderRadius: 3, backgroundColor: c.line }} />
      </View>
      <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingRight: 17 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Text key={n} style={[type.small, { flex: 1, textAlign: "center", color: level === n ? c.text : c.muted,
            fontWeight: level === n ? "600" : "400" }]}>{HINT[n]}</Text>
        ))}
      </View>
    </View>
  );
}
