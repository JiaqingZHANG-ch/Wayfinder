import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getQuarter, isCrisis, OFFLINE, postQuarter, Quarter, QuarterGoal, say, startQuarterCouncil } from "@/api";
import { Dots } from "@/components/dots";
import { ahead, Bar, Skeleton } from "@/components/motion";
import { Body, Button, Card, Chip, CrisisCard, Display, Field, IconButton, Notice, Title } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
const STEPS = 4; // 打分、重点、开始/停下/继续、目标；第 5 屏是结果

/** 季度回顾：全屏，一屏一问，版式照深度长谈。字都是他自己写的，原样存、原样显示。 */
export default function QuarterScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [areas, setAreas] = useState<string[] | null>(null);
  const [step, setStep] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [text, setText] = useState({ start: "", stop: "", keep: "" });
  const [goals, setGoals] = useState<QuarterGoal[]>([{ text: "", check: "" }]);
  const [saved, setSaved] = useState<Quarter | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);

  const [view, setView] = useState<Pick<Quarter, "council" | "council_status" | "message"> | null>(null); // 视角的状态
  const load = () => {
    getQuarter().then((r) => {
      setAreas(r.areas);
      if (!r.available && r.last?.council_status) { // 做过「请几个视角看看」：直接回到那份结果页，不用重填表单
        setSaved(r.last);
        setView(r.last);
        // 后端重启过会停在 running：再 POST 一次（幂等，线程没了就重跑），不然一直转圈
        if (r.last.council_status === "running") startQuarterCouncil().catch((e) => setMessage(say(e)));
      }
    }, () => setMessage(OFFLINE));
  };
  useEffect(load, []);

  async function askCouncil() {
    setMessage(null);
    setBusy(true);
    try {
      await startQuarterCouncil();
      setView({ council_status: "running" }); // 开过的也先当在看：下一次轮询就拿到结果
    } catch (e) { setMessage(say(e)); } finally { setBusy(false); }
  }
  const running = view?.council_status === "running";
  useEffect(() => { // 开会时每 3 秒查一次
    if (!running) return;
    const t = setInterval(() => {
      getQuarter().then((r) => { if (r.last) setView(r.last); }, () => { setView(null); setMessage(OFFLINE); });
    }, 3000);
    return () => clearInterval(t);
  }, [running]);

  const all = areas ? [...areas, ...(extra.trim() ? [extra.trim()] : [])] : [];
  const lowest = all.reduce<string | null>((m, a) => (m === null || (scores[a] ?? 11) < (scores[m] ?? 11) ? a : m), null);
  const pick = focus && all.includes(focus) ? focus : null; // 重点是自加的那项又被删掉时，当作没选
  const extraBad = extra.trim() !== "" && (extra.trim().length < 2 || !!areas?.includes(extra.trim()));
  const kept = goals.filter((g) => g.text.trim() || g.check.trim());

  async function save() {
    if (!pick) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await postQuarter({
        scores: Object.fromEntries(all.map((a) => [a, scores[a]])), extra_area: extra.trim() || undefined, focus: pick,
        start: text.start.trim(), stop: text.stop.trim(), keep: text.keep.trim(),
        goals: kept.map((g) => ({ text: g.text.trim(), check: g.check.trim() })),
      });
      if (isCrisis(res)) return setCrisis(res.message);
      setSaved(res);
    } catch (e) { setMessage(say(e)); } finally { setBusy(false); }
  }

  const shell = (children: React.ReactNode, bottom?: React.ReactNode) => (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space.sm }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 560, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <IconButton name="close" label="关闭" onPress={leave} />
          <View style={{ flex: 1 }}><Bar value={saved ? 1 : step / STEPS} color={c.primaryEdge} height={6} duration={300} /></View>
        </View>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.lg }} keyboardShouldPersistTaps="handled">
          <Animated.View key={saved ? "done" : step} entering={ahead("right")} style={{ gap: space.lg }}>
            {children}
            {message && <Notice tone="error">{message}</Notice>}
          </Animated.View>
        </ScrollView>
        {bottom && <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>{bottom}</View>}
      </View>
    </KeyboardAvoidingView>
  );

  if (crisis) return shell(<CrisisCard message={crisis} />, <Button label="继续" variant="secondary" onPress={() => setCrisis(null)} />);
  if (!areas) {
    return shell(message
      ? <Button label="再试一次" icon="refresh" variant="secondary" onPress={() => { setMessage(null); load(); }} />
      : <><Skeleton height={36} width="80%" /><Skeleton height={120} r={radius.md} /></>);
  }

  if (saved) {
    return shell(
      <>
        <Display>{`这一季的重点：${saved.focus}`}</Display>
        {saved.goals.map((g, i) => (
          <Card key={i}>
            <Title>{g.text}</Title>
            <Body muted>{`每周看：${g.check}`}</Body>
          </Card>
        ))}
        {running && <><Body muted>大概一两分钟。也可以先关掉，下次再看。</Body><Skeleton height={140} r={radius.lg} /></>}
        {view?.council_status === "crisis" && <CrisisCard message={view.message ?? ""} />}
        {view?.council_status === "failed" && <Body muted>这次没能看完，可以再点一次。</Body>}
        {view?.council && view.council_status === "done" && (
          <>
            {view.council.lenses.map((l) => (
              <Card key={l.title}>
                <Title>{l.title}</Title>
                <Body>{`看到：${l.sees}`}</Body>
                <Body>{`不确定的：${l.unknown}`}</Body>
                <Body>{`一个月内试试：${l.test}`}</Body>
              </Card>
            ))}
            {view.council.disagreement !== "" && <Card><Title>他们的分歧</Title><Body>{view.council.disagreement}</Body></Card>}
          </>
        )}
      </>,
      <>
        {view?.council_status !== "done" && view?.council_status !== "crisis" && (
          <Button label="请几个视角看看" variant="secondary" disabled={running || busy} onPress={askCouncil} />
        )}
        <Button label="好" onPress={leave} />
      </>,
    );
  }

  const next = () => { setMessage(null); setStep(step + 1); };
  const back = step > 0 ? <Button label="上一步" variant="neutral" onPress={() => { setMessage(null); setStep(step - 1); }} /> : null;
  const bar = (button: React.ReactNode) => <>{button}{back}</>;

  if (step === 0) {
    return shell(
      <>
        <Display>最近这几样，各打几分？</Display>
        <Body muted>0 是很不满意，10 是很满意。</Body>
        {all.map((a, i) => (
          <View key={a} style={{ gap: space.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 }}>
              <Title>{a}</Title>
              <Text style={[type.label, type.num, { color: c.muted, flex: 1 }]}>{scores[a] === undefined ? "" : `${scores[a]} 分`}</Text>
            </View>
            <Dots label={a} from={0} to={10} value={scores[a]} ends={i === 0} onChange={(n) => setScores({ ...scores, [a]: n })} />
          </View>
        ))}
        <Field placeholder="再加一项，可以不加" value={extra} maxLength={8} accessibilityLabel="再加一项"
          onChangeText={setExtra} />
      </>,
      bar(<Button label="下一步" disabled={extraBad || !all.every((a) => scores[a] !== undefined)} onPress={next} />),
    );
  }

  if (step === 1) {
    return shell(
      <>
        <Display>接下来 90 天，先照顾哪一项？</Display>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {all.map((a) => <Chip key={a} label={a} on={pick === a} onPress={() => setFocus(a)} />)}
        </View>
        {pick && lowest && scores[pick] > scores[lowest] && <Body muted>{`分最低的是『${lowest}』，你选了『${pick}』。先这样记下。`}</Body>}
      </>,
      bar(<Button label="下一步" disabled={!pick} onPress={next} />),
    );
  }

  if (step === 2) {
    const rows = [["开始做", "start"], ["停下", "stop"], ["继续", "keep"]] as const;
    return shell(
      <>
        <Display>下一季，想开始、停下、继续什么？</Display>
        {rows.map(([name, k]) => (
          <Field key={k} label={name} value={text[k]} multiline onChangeText={(v) => setText({ ...text, [k]: v })} />
        ))}
      </>,
      bar(<Button label="下一步" disabled={!(text.start.trim() || text.stop.trim() || text.keep.trim())} onPress={next} />),
    );
  }

  const set = (i: number, k: keyof QuarterGoal, v: string) => setGoals(goals.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  return shell(
    <>
      <Display>下一季想做到的事，最多 3 条</Display>
      {goals.map((g, i) => (
        <Card key={i}>
          <Field label="目标" value={g.text} maxLength={60} onChangeText={(v) => set(i, "text", v)} />
          <Field label="每周看什么" value={g.check} maxLength={60} onChangeText={(v) => set(i, "check", v)} />
        </Card>
      ))}
      {goals.length < 3 && <Button label="再加一条" variant="neutral" onPress={() => setGoals([...goals, { text: "", check: "" }])} />}
    </>,
    bar(<Button label="保存" busyLabel={busy ? "正在存……" : undefined}
      disabled={busy || kept.length === 0 || kept.some((g) => !g.text.trim() || !g.check.trim())} onPress={save} />),
  );
}
