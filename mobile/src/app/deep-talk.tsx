import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  answerDeepTalk, ApiError, confirmDeepTalk, Crisis, DeepTalkState, Energy, getDeepTalk, HabitProposal, isCrisis, OFFLINE,
  Profile, say, startCouncil, TalkConfirm,
} from "@/api";
import { Glyph, Sky } from "@/components/art";
import { EnergyPick } from "@/components/chips";
import { CouncilView, VERSION } from "@/components/council-view";
import { ahead, Bar, haptic, Pressy, Skeleton } from "@/components/motion";
import { useNow } from "@/components/plan-view";
import { Body, Button, Card, Chip, CrisisCard, Display, Field, IconButton, Notice, Small, Title } from "@/components/ui";
import { motion, radius, space, type, useColors } from "@/theme";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

// 追问三个小问题各自的灰字
const FOLLOW_HINT: Record<string, string> = { 在哪: "比如：图书馆三楼", 和谁: "比如：一个人", 用什么: "比如：笔记本和一支笔" };

/**
 * 深度长谈：全屏，一屏一个问题，版式照晚间对账。每屏答完马上存，关掉下次从没答的那一屏接着聊。
 * 一步的最后一屏答完是小结：这一步待确认的提议，一张一张确认或不要。
 * ?step=4&part=choose：第 4 次选了「先不选」以后，从「我」页回来选一个版本。
 */
export default function DeepTalk() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const [st, setSt] = useState<DeepTalkState | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 刚答完的开放问题：停在这一屏给他看导师的一句，点「接着聊」再往下
  const [said, setSaid] = useState<{ step: number; screen: string; reply: string } | null>(null);
  const [summary, setSummary] = useState<number | null>(null); // 刚做完的那一步：显示它的小结
  // 每屏的草稿按屏 id 存（屏 id 全轮唯一），换屏不用清
  const [text, setText] = useState<Record<string, string>>({});
  const [scores, setScores] = useState<Record<string, number | "skip">>({});
  const [follow, setFollow] = useState<Record<string, string>>({});
  const [energy, setEnergy] = useState<Record<string, Energy | null>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, Record<string, number>>>({});
  const [pick, setPick] = useState<number | null>(null);
  const [rechoose, setRechoose] = useState(useLocalSearchParams<{ part?: string }>().part === "choose");

  const load = () => { getDeepTalk().then(setSt, () => setMessage(OFFLINE)); };
  useEffect(load, []);

  // 只有存着「先不选」时才回来选；别的情况照常从没答的那一屏走
  const choosing = rechoose && st?.answers[4]?.choose === null;
  const onCouncil = !choosing && !said && summary === null && st?.step === 4 && st.screen === "council";
  // 每次进智囊团这一屏都先 POST 一次：后端重启过时 GET 会一直是 running，只有 POST 能重跑；进行中或看完了的不会重开
  useEffect(() => {
    if (onCouncil) startCouncil().then(setSt, (e) => setMessage(say(e)));
  }, [onCouncil]);
  const running = st?.council?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { getDeepTalk().then(setSt, () => {}); }, 3000);
    return () => clearInterval(t);
  }, [running]);

  /** 发一个请求：危机就停在危机卡片；409（不是这一屏）重新取状态；其余错误原样说给他。 */
  async function call(req: Promise<DeepTalkState | Crisis>, then?: (s: DeepTalkState) => void) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await req;
      if (isCrisis(res)) return setCrisis(res.message);
      setSt(res);
      then?.(res);
    } catch (e) {
      setMessage(say(e));
      if (e instanceof ApiError && e.status === 409) getDeepTalk().then(setSt, () => {});
    } finally {
      setBusy(false);
    }
  }

  function answer(step: number, screen: string, value: unknown) {
    call(answerDeepTalk(step, screen, value), (res) => {
      haptic.select();
      setRechoose(false);
      if (res.reply) setSaid({ step, screen, reply: res.reply });
      if (res.step !== step) setSummary(step);
    });
  }

  const decide = (what: TalkConfirm, accept: boolean, content?: string) => call(confirmDeepTalk(what, accept, content));

  const shell = (children: React.ReactNode, bottomBar?: React.ReactNode) => (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space.sm }}>
      <Sky min={now} />
      <View style={{ flex: 1, width: "100%", maxWidth: 560, alignSelf: "center" }}>
        {children}
        {bottomBar && <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>{bottomBar}</View>}
      </View>
    </KeyboardAvoidingView>
  );

  const top = (progress: number) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
      {/* 已答的屏都存了，关掉不用问 */}
      <IconButton name="close" label="关闭" onPress={leave} />
      <View style={{ flex: 1 }}><Bar value={progress} color={c.primary} height={6} duration={300} /></View>
    </View>
  );

  const page = (key: string, progress: number, body: React.ReactNode, bottom?: React.ReactNode) => shell(
    <>
      {top(progress)}
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.lg }} keyboardShouldPersistTaps="handled">
        <Animated.View key={key} entering={ahead("right")} style={{ flexGrow: 1, gap: space.lg }}>
          {body}
          {message && <Notice tone="error">{message}</Notice>}
        </Animated.View>
      </ScrollView>
    </>,
    bottom,
  );

  if (crisis) {
    return shell(
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}><CrisisCard message={crisis} /></ScrollView>,
      <Button label="继续" variant="secondary" onPress={() => setCrisis(null)} />,
    );
  }

  if (!st) {
    return shell(
      <>{top(0)}<View style={{ padding: space.lg, gap: space.md }}>{message ? (
        <><Notice tone="error">{message}</Notice><Button label="再试一次" icon="refresh" variant="secondary" onPress={() => { setMessage(null); load(); }} /></>
      ) : (
        <><Skeleton height={20} width="30%" /><Skeleton height={36} width="80%" /><Skeleton height={120} r={radius.md} /></>
      )}</View></>,
    );
  }

  const eyebrow = (step: number) => (
    <Text style={[type.eyebrow, { color: c.muted, marginBottom: -space.sm }]}>{`第 ${step} 次 · ${st.screens[step].name}`}</Text>
  );

  // —— 小结：这一步待确认的提议，一张一张来；第 4 次是「落地」和「投资自己」 ——
  if (!choosing && !said && (summary !== null || st.step === null)) { // 最后一屏是开放问题时，先看完导师的一句
    const step = summary ?? 4;
    const a = st.answers[step] ?? {};
    const ids = a.profile_ids ?? [];
    const p = st.proposals.profiles.find((x) => ids.includes(x.id));
    const later = step === 4 && !p;
    const proto = later ? st.proposals.habits.find((h) => h.source === "deep_talk" && h.status === "pending") : undefined;
    const tomorrow = later && !proto && st.can_set_tomorrow ? st.proposals.tomorrow : null;
    const invest = later && !proto && !tomorrow ? st.proposals.habits.filter((h) => h.source === "invest" && h.status === "pending") : [];
    const open = !!(p || proto || tomorrow || invest.length);
    let title: string;
    let body: React.ReactNode;
    if (p) {
      title = "我听到的，你看看对不对";
      body = <ProfileCard p={p} label={step === 3 ? "能量公式" : p.level} edits={edits} setEdits={setEdits} busy={busy} decide={decide} />;
    } else if (proto) {
      title = "先试一个月的小习惯";
      body = <HabitCard h={proto} label="一个月原型" yes="加进计划" edits={edits} setEdits={setEdits} busy={busy} decide={decide} />;
    } else if (tomorrow) {
      title = "明天的一件事";
      const v = edits.t ?? tomorrow;
      const keep = (accept: boolean) => decide({ kind: "tomorrow" }, accept, accept ? v.trim() : undefined);
      // 今晚对账已经写了一件：两句都给他看，留哪句他点
      body = st.tonight_task ? (
        <>
          <Body muted>今晚已经定了一件，留哪一句？</Body>
          <Card>
            <Text style={[type.eyebrow, { color: c.muted }]}>今晚对账时写的</Text>
            <Title>{st.tonight_task}</Title>
            <Button label="留这句" variant="secondary" disabled={busy} onPress={() => keep(false)} />
          </Card>
          <Card>
            <Text style={[type.eyebrow, { color: c.muted }]}>刚才聊出来的（可以改）</Text>
            <Field value={v} accessibilityLabel="刚才聊出来的明天的一件事" onChangeText={(t) => setEdits({ ...edits, t })} />
            <Button label="留这句" variant="secondary" disabled={busy || !v.trim()} onPress={() => keep(true)} />
          </Card>
        </>
      ) : (
        <Card>
          <Small muted>会写进今晚的对账，不对就直接改</Small>
          <Field value={v} accessibilityLabel="明天的一件事" onChangeText={(t) => setEdits({ ...edits, t })} />
          <Pair yes="对" no="不要" yesOff={!v.trim()} busy={busy} onYes={() => keep(true)} onNo={() => keep(false)} />
        </Card>
      );
    } else if (invest.length) {
      title = "投资自己";
      body = invest.map((h) => <HabitCard key={h.key} h={h} yes="好" edits={edits} setEdits={setEdits} busy={busy} decide={decide} />);
    } else {
      title = `第 ${step} 次聊完了`;
      body = (
        <>
          {step < 4 && <Body muted>下次对完账，我们接着聊第 {step + 1} 次。</Body>}
          {step === 4 && st.habits_full && <Body muted>等你哪天想换掉一个习惯时，可以从这里挑</Body>}
          {step === 4 && a.choose === null && <Body muted>想好了，可以从「我」页回来选一个版本。</Body>}
        </>
      );
    }
    return page(`sum-${step}-${title}-${p?.id}`, 1, (
      <>
        {eyebrow(step)}
        <Display>{title}</Display>
        {step === 3 && <Notice>明天的安排按你刚才说的累不累重排了</Notice>}
        {body}
      </>
    ), !open && <Button label="好" variant="secondary" onPress={leave} />);
  }

  // —— 一屏一个问题 ——
  const step = choosing ? 4 : said?.step ?? st.step!; // 走到这里 step 一定有：null 的情况上面小结已经接走
  const id = choosing ? "choose" : said?.screen ?? st.screen!;
  const screens = st.screens[step].screens;
  const idx = screens.findIndex((x) => x.id === id);
  const s = screens[idx];
  const progress = (idx + 1) / screens.length;
  const four = st.screens[4].screens;
  const titles = four.slice(0, 3).map((x) => x.question ?? "");
  const versions = four.slice(0, 3).map((x) => String(st.answers[4]?.[x.id] ?? ""));
  let body: React.ReactNode;
  let bottom: React.ReactNode;

  if (s.kind === "scores") {
    const items = s.items ?? [];
    const skippable = s.options ?? [];
    body = (
      <>
        {eyebrow(step)}
        <Display>最近这几样，各打几分？</Display>
        <Body muted>0 是很不满意，10 是很满意。</Body>
        {items.map((item) => {
          const v = scores[item];
          return (
            <View key={item} style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 }}>
                <Title>{item}</Title>
                <Text style={[type.label, type.num, { color: c.muted, flex: 1 }]}>{typeof v === "number" ? `${v} 分` : ""}</Text>
                {skippable.includes(item) && (
                  <Chip label="跳过" role="checkbox" on={v === "skip"}
                    onPress={() => setScores(v === "skip"
                      ? Object.fromEntries(Object.entries(scores).filter(([k]) => k !== item)) : { ...scores, [item]: "skip" })} />
                )}
              </View>
              <Dots label={item} from={0} to={10} value={typeof v === "number" ? v : undefined} dim={v === "skip"}
                onChange={(n) => setScores({ ...scores, [item]: n })} />
            </View>
          );
        })}
      </>
    );
    const ready = items.every((i) => scores[i] !== undefined);
    bottom = <Button label="下一步" disabled={!ready} busyLabel={busy ? "正在存……" : undefined}
      onPress={() => answer(step, s.id, Object.fromEntries(Object.entries(scores).filter(([k, v]) => items.includes(k) && v !== "skip")))} />;
  } else if (s.kind === "open") {
    body = (
      <>
        {eyebrow(step)}
        <Title>{s.question}</Title>
        <Field placeholder="几句话就行" value={text[s.id] ?? ""} multiline editable={!said} accessibilityLabel={s.question}
          onChangeText={(v) => setText({ ...text, [s.id]: v })} />
        {said && (
          <Animated.View entering={FadeIn.duration(motion.slow)}>
            <Body muted>{said.reply}</Body>
          </Animated.View>
        )}
      </>
    );
    bottom = said
      ? <Button label="接着聊" onPress={() => setSaid(null)} />
      : <Button label="说完了" disabled={!text[s.id]?.trim()} busyLabel={busy ? "正在听……" : undefined}
        onPress={() => answer(step, s.id, text[s.id].trim())} />;
  } else if (s.kind === "follow") {
    const flow = st.answers[step]?.flow;
    const picked = Object.keys(follow);
    body = (
      <>
        {eyebrow(step)}
        <Display>那次是在哪、和谁、用什么？</Display>
        {typeof flow === "string" && <Body muted>「{flow}」</Body>}
        <Small muted>点一个补一句，最多两个；不想补就直接下一步。</Small>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {(s.options ?? []).map((o) => (
            <Chip key={o} label={o} role="checkbox" on={o in follow} onPress={() => {
              if (o in follow) setFollow(Object.fromEntries(Object.entries(follow).filter(([k]) => k !== o)));
              else if (picked.length < 2) setFollow({ ...follow, [o]: "" });
            }} />
          ))}
        </View>
        {picked.map((o) => (
          <Field key={o} label={o} placeholder={FOLLOW_HINT[o]} value={follow[o]} onChangeText={(v) => setFollow({ ...follow, [o]: v })} />
        ))}
      </>
    );
    // 点了没写字的不发：后端要每一句都不是空的
    const filled = Object.fromEntries(Object.entries(follow).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    bottom = <Button label="下一步" busyLabel={busy ? "正在存……" : undefined} onPress={() => answer(step, s.id, filled)} />;
  } else if (s.kind === "energy") {
    const look = { habit: c.kind.must, class: c.kind.class, project: c.kind.proj };
    const value = (i: DeepTalkState["energy_items"][number]) => (i.id in energy ? energy[i.id] : i.energy);
    body = (
      <>
        {eyebrow(step)}
        <Display>这几件事，做起来是什么感觉？</Display>
        <Body muted>可以不标。标了，明天的安排按这个重排。</Body>
        {st.energy_items.length === 0 && <Notice>还没有习惯、课或项目可以标。</Notice>}
        {st.energy_items.map((i) => (
          <Card key={i.id} style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Glyph name={i.title} color={look[i.kind]} size={20} />
              <Title>{i.title}</Title>
            </View>
            <EnergyPick value={value(i)} onChange={(v) => setEnergy({ ...energy, [i.id]: v })} />
          </Card>
        ))}
      </>
    );
    bottom = <Button label="存下" busyLabel={busy ? "正在存……" : undefined}
      onPress={() => answer(step, s.id, Object.fromEntries(st.energy_items.map((i) => [i.id, value(i)])))} />;
  } else if (s.kind === "version") {
    body = (
      <>
        {eyebrow(step)}
        <Title>{s.question}</Title>
        <Field placeholder={s.hint} value={text[s.id] ?? ""} multiline accessibilityLabel={s.question}
          onChangeText={(v) => setText({ ...text, [s.id]: v })} />
      </>
    );
    bottom = <Button label="写好了" disabled={!text[s.id]?.trim()} busyLabel={busy ? "正在存……" : undefined}
      onPress={() => answer(step, s.id, text[s.id].trim())} />;
  } else if (s.kind === "council") {
    const status = st.council?.status ?? "running";
    body = (
      <>
        {eyebrow(step)}
        {status === "running" ? (
          <>
            <Display>几位顾问在看你写的三个版本</Display>
            <Body muted>大概一两分钟。也可以先关掉，下次打开接着看。</Body>
            {[0, 1].map((i) => <Skeleton key={i} height={140} r={radius.lg} />)}
          </>
        ) : status === "failed" || !st.council?.result ? (
          <Display>这次顾问们没能看完，你可以先自己打分</Display>
        ) : (
          <>
            <Display>顾问们看完了</Display>
            <CouncilView result={st.council.result} titles={titles} />
          </>
        )}
      </>
    );
    // 第 4 次可以分两晚：写完三个版本、看完点评就可以先关掉
    bottom = (
      <>
        {status !== "running" && <Button label="接着打分" busyLabel={busy ? "正在存……" : undefined} onPress={() => answer(step, s.id, true)} />}
        <Button label="今晚先到这" variant="secondary" onPress={leave} />
      </>
    );
  } else if (s.kind === "rate") {
    const items = s.items ?? [];
    body = (
      <>
        {eyebrow(step)}
        <Display>给三个版本打个分</Display>
        <Body muted>每项 1 到 5 个点。</Body>
        {VERSION.map((name, j) => (
          <Card key={j} style={{ gap: space.sm }}>
            <Text style={[type.eyebrow, { color: c.muted }]}>{`${name} · ${titles[j]}`}</Text>
            <Text numberOfLines={2} style={[type.label, { color: c.muted }]}>{versions[j]}</Text>
            {items.map((item) => (
              <View key={item} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text style={[type.label, { color: c.text, width: 84 }]}>{item}</Text>
                <View style={{ flex: 1 }}>
                  <Dots label={`${name} ${item}`} from={1} to={5} value={rates[j]?.[item]}
                    onChange={(n) => setRates({ ...rates, [j]: { ...rates[j], [item]: n } })} />
                </View>
              </View>
            ))}
          </Card>
        ))}
      </>
    );
    const ready = VERSION.every((_, j) => items.every((i) => rates[j]?.[i] !== undefined));
    bottom = <Button label="打好了" disabled={!ready} busyLabel={busy ? "正在存……" : undefined}
      onPress={() => answer(step, s.id, { 0: rates[0], 1: rates[1], 2: rates[2] })} />;
  } else if (s.kind === "choose") {
    body = (
      <>
        {eyebrow(step)}
        <Display>选一个版本</Display>
        <Body muted>也可以先不选，想好了再回来。</Body>
        <View accessibilityRole="radiogroup" style={{ gap: space.md }}>
          {VERSION.map((name, j) => (
            <Pressy key={j} onPress={() => { haptic.select(); setPick(j); }} accessibilityRole="radio"
              accessibilityState={{ checked: pick === j }} accessibilityLabel={`${name}，${titles[j]}`} scaleTo={0.97}
              style={{ gap: space.xs, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5,
                backgroundColor: pick === j ? c.soft : c.surface, borderColor: pick === j ? c.primary : "transparent",
                boxShadow: pick === j ? undefined : c.shadow }}>
              <Text style={[type.eyebrow, { color: pick === j ? c.onSoft : c.muted }]}>{`${name} · ${titles[j]}`}</Text>
              <Text numberOfLines={2} style={[type.body, { color: pick === j ? c.onSoft : c.text }]}>{versions[j]}</Text>
            </Pressy>
          ))}
        </View>
      </>
    );
    bottom = (
      <>
        <Button label="就选这个" disabled={pick === null} busyLabel={busy ? "正在想……" : undefined} onPress={() => answer(step, s.id, pick)} />
        <Button label="先不选" variant="neutral" disabled={busy} onPress={() => answer(step, s.id, null)} />
      </>
    );
  }

  return page(`${step}-${id}`, progress, body, bottom);
}

/** 一排可点的圆点：from…to 分，点到的那个和它左边的都亮。读屏念「健康 6 分」。 */
function Dots({ label, from, to, value, onChange, dim }: {
  label: string; from: number; to: number; value?: number; onChange: (n: number) => void; dim?: boolean;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", opacity: dim ? 0.4 : 1 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => (
        <Pressy key={n} onPress={() => { haptic.select(); onChange(n); }} accessibilityRole="radio"
          accessibilityState={{ checked: value === n }} accessibilityLabel={`${label} ${n} 分`} scaleTo={0.85}
          style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: value === n ? 20 : 14, height: value === n ? 20 : 14, borderRadius: radius.pill,
            backgroundColor: value !== undefined && n <= value ? c.primary : c.sunken }} />
        </Pressy>
      ))}
    </View>
  );
}

/** 一条待确认的档案提议：可以改字，「对」才记进档案，「不要」就不再显示。 */
function ProfileCard({ p, label, edits, setEdits, busy, decide }: {
  p: Profile; label: string; edits: Record<string, string>; setEdits: (e: Record<string, string>) => void; busy: boolean;
  decide: (what: TalkConfirm, accept: boolean, content?: string) => void;
}) {
  const c = useColors();
  const k = `p:${p.id}`;
  const v = edits[k] ?? p.content;
  return (
    <Card>
      <Text style={[type.eyebrow, { color: c.muted }]}>{label}</Text>
      <Small muted>不对就直接改</Small>
      <Field value={v} multiline accessibilityLabel={label} onChangeText={(t) => setEdits({ ...edits, [k]: t })} />
      <Pair yes="对" no="不要" yesOff={!v.trim()} busy={busy}
        onYes={() => decide({ kind: "profile", id: p.id }, true, v.trim())} onNo={() => decide({ kind: "profile", id: p.id }, false)} />
    </Card>
  );
}

/** 一条习惯提议：原型（名字可以改）或「投资自己」（写为什么、适合在什么时候）。 */
function HabitCard({ h, label, yes, edits, setEdits, busy, decide }: {
  h: HabitProposal; label?: string; yes: string; edits: Record<string, string>; setEdits: (e: Record<string, string>) => void;
  busy: boolean; decide: (what: TalkConfirm, accept: boolean, content?: string) => void;
}) {
  const c = useColors();
  const k = `h:${h.key}`;
  const v = edits[k] ?? h.title;
  const proto = h.source === "deep_talk";
  return (
    <Card>
      {label && <Text style={[type.eyebrow, { color: c.muted }]}>{label}</Text>}
      {proto
        ? <Field value={v} accessibilityLabel="习惯的名字" onChangeText={(t) => setEdits({ ...edits, [k]: t })} />
        : <Title>{h.title}</Title>}
      <Small muted>{`标准版 ${h.minutes} 分钟 · 保底版 ${h.floor_min} 分钟`}</Small>
      {h.why && <Body>{h.why}</Body>}
      {h.when && <Small muted>{`适合在${h.when}`}</Small>}
      <Pair yes={yes} no="先不要" yesOff={!v.trim()} busy={busy}
        onYes={() => decide({ kind: "habit", key: h.key }, true, proto ? v.trim() : undefined)}
        onNo={() => decide({ kind: "habit", key: h.key }, false)} />
    </Card>
  );
}

/** 提议卡底下的两个按钮：左边接受，右边不要。 */
function Pair({ yes, no, yesOff, busy, onYes, onNo }: {
  yes: string; no: string; yesOff?: boolean; busy: boolean; onYes: () => void; onNo: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <View style={{ flex: 1 }}><Button label={yes} disabled={yesOff || busy} onPress={onYes} /></View>
      <View style={{ flex: 1 }}><Button label={no} variant="neutral" disabled={busy} onPress={onNo} /></View>
    </View>
  );
}
