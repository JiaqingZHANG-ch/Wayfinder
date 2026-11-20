import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { confirmPlan, isCrisis, Plan, postEnergy } from "@/api";
import { PlanView } from "@/components/plan-view";

const nowHHMM = () => new Date().toTimeString().slice(0, 5);

/** 下课后报电量 → 后端只重排今晚 → 先给你看，点「就这样」才算确认。 */
export default function EnergyScreen() {
  const [level, setLevel] = useState<number | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from] = useState(nowHHMM);

  async function report(n: number) {
    setLevel(n);
    setBusy(true);
    setMessage(null);
    try {
      const res = await postEnergy(n);
      if (isCrisis(res)) setMessage(res.message);
      else setPlan(res);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true); // 连点两次「就这样」只发一次
    try {
      const res = await confirmPlan(plan.version);
      if (res.calendar === "reconnect") setMessage("计划确认好了。Google 日历的授权失效了，要在电脑上重新连一次才会写进日历。");
      else if (res.calendar === "failed") setMessage("计划确认好了，但这次没写进日历。");
      else router.replace("/");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.ask}>现在电量几格？</Text>
      <View style={styles.levels}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => report(n)}
            disabled={busy}
            style={[styles.level, level === n && styles.chosen]}
            accessibilityRole="button"
            accessibilityLabel={`电量 ${n} 格`}
          >
            <Text style={[styles.levelText, level === n && styles.chosenText]}>{n}</Text>
          </Pressable>
        ))}
      </View>
      {busy && <Text style={styles.note}>正在重排今晚……</Text>}
      {message && <Text style={styles.message}>{message}</Text>}
      {plan && !busy && (
        <>
          <Text style={styles.note}>只动了现在之后的安排，下面是今晚剩下的：</Text>
          <PlanView plan={plan} from={from} />
          <Pressable onPress={confirm} style={styles.confirm} accessibilityRole="button">
            <Text style={styles.confirmText}>就这样</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 560, width: "100%", alignSelf: "center" },
  ask: { fontSize: 18, fontWeight: "500" },
  levels: { flexDirection: "row", gap: 8 },
  level: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: "#dadce0",
    alignItems: "center", justifyContent: "center" },
  chosen: { backgroundColor: "#1a73e8", borderColor: "#1a73e8" },
  levelText: { fontSize: 18 },
  chosenText: { color: "#fff" },
  note: { color: "#5f6368" },
  message: { color: "#b3261e" },
  confirm: { marginTop: 8, backgroundColor: "#1a73e8", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  confirmText: { color: "#fff", fontSize: 16 },
});
