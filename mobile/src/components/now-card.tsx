import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { doneBlock, pauseBlock, Plan, resumeBlock } from "@/api";
import { haptic } from "@/components/motion";
import { Button, Card, Small, Title } from "@/components/ui";
import { pickNow, pomodoro } from "@/runs";
import { radius, space, type, useColors } from "@/theme";

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * 「现在」卡：正在做（或者被打断、停着）的那一块，番茄倒计时，「被打断了 / 继续」和「做完了」。
 * 倒计时全按 plan.runs 和手机时钟算，每秒走一次；没点过按钮就从计划开始时间算起。
 * 继续时停得久（或往后推不开），onAsk 让今天页弹出「要不要重排」。
 */
export function NowCard({ plan, onPlan, onAsk, onError }: {
  plan: Plan; onPlan: (p: Plan) => void; onAsk: () => void; onError: (e: unknown) => void;
}) {
  const c = useColors();
  // 时间放进 state：React Compiler 会把渲染里的 new Date() 缓存住，倒计时就不走了
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const d = new Date(nowMs);
  const runs = plan.runs ?? {};
  const b = pickNow(plan.blocks, runs, d.getHours() * 60 + d.getMinutes());
  if (!b) return null;
  const p = pomodoro(b, runs[b.id], nowMs, Date.parse(`${plan.day}T${b.start}:00`));

  async function act(fn: () => Promise<Plan & { ask_reflow?: boolean }>) {
    setBusy(true);
    try {
      const res = await fn();
      haptic.select();
      onPlan(res);
      if (res.ask_reflow) onAsk();
    } catch (e) {
      onError(e);
    }
    setBusy(false);
  }

  const status = p.paused ? `停了 ${Math.max(1, Math.round(p.pausedSec / 60))} 分钟`
    : `第 ${p.index} 个番茄（共 ${p.total} 个）· ${p.phase === "focus" ? "专注" : "小歇"} 还剩 ${clock(p.leftSec)}`;
  const span = p.phase === "focus" ? 25 * 60 : 5 * 60;
  return (
    <Card>
      <View style={{ gap: space.xs }}>
        <Small muted>现在 {b.start}–{b.end}</Small>
        <Title>{b.title}</Title>
      </View>
      <View accessible accessibilityLabel={status} style={{ gap: space.xs }}>
        <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: c.surface2, overflow: "hidden" }}>
          <View style={{ width: `${p.paused ? 0 : Math.round(100 * (1 - p.leftSec / span))}%`, height: 8, backgroundColor: c.primary }} />
        </View>
        <Text style={[type.label, type.num, { color: c.muted }]}>{status}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          {p.paused
            ? <Button label="继续" disabled={busy} onPress={() => act(() => resumeBlock(b.id))} />
            : <Button label="被打断了" variant="secondary" disabled={busy} onPress={() => act(() => pauseBlock(b.id))} />}
        </View>
        <View style={{ flex: 1 }}>
          <Button label="做完了" variant={p.paused ? "secondary" : "primary"} disabled={busy} onPress={() => act(() => doneBlock(b.id))} />
        </View>
      </View>
    </Card>
  );
}
