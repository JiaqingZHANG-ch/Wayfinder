import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { doneBlock, pauseBlock, Plan, resumeBlock, startBlock } from "@/api";
import { haptic } from "@/components/motion";
import { Button, Card, Small, Title } from "@/components/ui";
import { pickNow, pomodoro } from "@/runs";
import { radius, space, type, useColors } from "@/theme";

const UNDO_MS = 5000; // 点了「做完了」多久才真发出去（这段时间里能撤销）

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * 「现在」卡：到点还没开始的块给「开始」；开始以后是番茄倒计时、「被打断了 / 继续」和「做完了」。
 * 倒计时全按 plan.runs 和手机时钟算，每秒走一次。开始晚了、继续时停得久（或往后推不开），onAsk 让今天页弹出「要不要重排」。
 * 「做完了」先不发：卡上 5 秒「撤销」，到时才发；这期间离开今天页就立刻发出去。
 * shortcut: 5 秒内把 App 杀掉这次就没记上（晚上对账还能补），真要可靠再做服务器端撤销。
 */
export function NowCard({ plan, onPlan, onAsk, onError }: {
  plan: Plan; onPlan: (p: Plan) => void; onAsk: () => void; onError: (e: unknown) => void;
}) {
  const c = useColors();
  // 时间放进 state：React Compiler 会把渲染里的 new Date() 缓存住，倒计时就不走了
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // 点了「做完了」、还能撤销的那一块
  const undo = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearInterval(t);
      if (undo.current) { // 离开今天页：不等了，直接记上
        clearTimeout(undo.current.timer);
        doneBlock(undo.current.id).catch(() => {});
      }
    };
  }, []);
  const d = new Date(nowMs);
  const runs = plan.runs ?? {};
  const b = pickNow(plan.blocks, runs, d.getHours() * 60 + d.getMinutes());
  if (!b) return null;
  const run = runs[b.id];

  function finish(id: string) {
    haptic.select();
    setPending(id);
    undo.current = { id, timer: setTimeout(() => {
      undo.current = null;
      setPending(null);
      act(() => doneBlock(id));
    }, UNDO_MS) };
  }
  function cancel() {
    if (undo.current) clearTimeout(undo.current.timer);
    undo.current = null;
    setPending(null);
  }

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

  const head = (
    <View style={{ gap: space.xs }}>
      <Small muted>现在 {b.start}–{b.end}</Small>
      <Title>{b.title}</Title>
    </View>
  );
  if (pending === b.id) {
    return (
      <Card>
        {head}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.label, { color: c.muted, flex: 1 }]} accessibilityLiveRegion="polite">记为做完了</Text>
          <View style={{ flex: 1 }}><Button label="撤销" variant="secondary" onPress={cancel} /></View>
        </View>
      </Card>
    );
  }
  if (!run) {
    return (
      <Card>
        {head}
        <Text style={[type.label, type.num, { color: c.muted }]}>{b.start}–{b.end} · 还没开始</Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}><Button label="开始" disabled={busy} onPress={() => act(() => startBlock(b.id))} /></View>
          <View style={{ flex: 1 }}><Button label="做完了" variant="secondary" disabled={busy} onPress={() => finish(b.id)} /></View>
        </View>
      </Card>
    );
  }
  const p = pomodoro(b, run, nowMs);
  const status = p.paused ? `停了 ${Math.max(1, Math.round(p.pausedSec / 60))} 分钟`
    : `第 ${p.index} 个番茄（共 ${p.total} 个）· ${p.phase === "focus" ? "专注" : "小歇"} 还剩 ${clock(p.leftSec)}`;
  const span = p.phase === "focus" ? 25 * 60 : 5 * 60;
  return (
    <Card>
      {head}
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
          <Button label="做完了" variant={p.paused ? "secondary" : "primary"} disabled={busy} onPress={() => finish(b.id)} />
        </View>
      </View>
    </Card>
  );
}
