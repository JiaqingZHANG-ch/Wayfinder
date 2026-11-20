import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ApiError, confirmPlan, isCrisis, Plan, postEnergy } from "@/api";
import { PlanView } from "@/components/plan-view";
import { Body, Button, CrisisCard, Notice, Screen, Small, Title } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const nowHHMM = () => new Date().toTimeString().slice(0, 5);
const HINT = ["", "很累了", "有点累", "还行", "不错", "满格"];

/** 下课后报电量 → 后端只重排今晚 → 先给你看，点「就这样」才算确认。 */
export default function EnergyScreen() {
  const c = useColors();
  const [level, setLevel] = useState<number | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from] = useState(nowHHMM);

  async function report(n: number) {
    setLevel(n);
    setBusy(true);
    setMessage(null);
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
      if (res.calendar === "reconnect") setMessage({ text: "计划确认好了。Google 日历的授权失效了，要在电脑上重新连一次才会写进日历。", error: false });
      else if (res.calendar === "failed") setMessage({ text: "计划确认好了，但这次没写进日历。", error: false });
      else router.replace("/");
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <Title>现在电量几格？</Title>
        <Body muted>只会动现在之后的安排。电量 1–2 格时，习惯只排保底版。</Body>
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = level === n;
          return (
            <Pressable key={n} onPress={() => report(n)} disabled={busy} accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: busy }} accessibilityLabel={`电量 ${n} 格，${HINT[n]}`}
              style={({ pressed }) => ({ flex: 1, aspectRatio: 0.8, maxHeight: 96, borderRadius: radius.lg,
                backgroundColor: on ? c.primary : c.card, borderWidth: 1, borderColor: on ? c.primary : c.line,
                alignItems: "center", justifyContent: "center", gap: 2, opacity: pressed ? 0.85 : 1 })}>
              <Text style={[type.display, { color: on ? c.onPrimary : c.text }]}>{n}</Text>
              <Text style={[type.small, { color: on ? c.onPrimary : c.muted }]}>{HINT[n]}</Text>
            </Pressable>
          );
        })}
      </View>
      {busy && <Small muted>正在重排今晚……</Small>}
      {crisis && <CrisisCard message={crisis} />}
      {message && <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice>}
      {plan && !busy && (
        <>
          <PlanView plan={plan} from={from} />
          <Button label="就这样" onPress={confirm} />
        </>
      )}
    </Screen>
  );
}
