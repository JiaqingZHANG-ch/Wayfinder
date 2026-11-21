import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  answerDeepTalk, ApiError, confirmDeepTalk, Crisis, DeepTalkState, Energy, getDeepTalk, isCrisis, OFFLINE, Profile, say,
  TalkConfirm,
} from "@/api";
import { Glyph, Sky } from "@/components/art";
import { EnergyPick } from "@/components/chips";
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

  const load = () => { getDeepTalk().then(setSt, () => setMessage(OFFLINE)); };
  useEffect(load, []);

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

  // —— 小结：这一步待确认的提议，一张一张来 ——
  if (!said && (summary !== null || st.step === null)) { // 最后一屏是开放问题时，先看完导师的一句
    const step = summary ?? 4;
    const ids = st.answers[step]?.profile_ids ?? [];
    const p = st.proposals.profiles.find((x) => ids.includes(x.id));
    let body: React.ReactNode;
    if (p) {
      body = <ProfileCard p={p} label={step === 3 ? "能量公式" : p.level} edits={edits} setEdits={setEdits} busy={busy} decide={decide} />;
    } else {
      body = step < 4 ? <Body muted>下次对完账，我们接着聊第 {step + 1} 次。</Body> : null;
    }
    return page(`sum-${step}-${p?.id}`, 1, (
      <>
        {eyebrow(step)}
        <Display>{p ? "我听到的，你看看对不对" : `第 ${step} 次聊完了`}</Display>
        {step === 3 && <Notice>明天的安排按你刚才说的累不累重排了</Notice>}
        {body}
      </>
    ), !p && <Button label="好" variant="secondary" onPress={leave} />);
  }

  // —— 一屏一个问题 ——
  const step = said?.step ?? st.step!; // 走到这里 step 一定有：null 的情况上面小结已经接走
  const id = said?.screen ?? st.screen!;
  const screens = st.screens[step].screens;
  const idx = screens.findIndex((x) => x.id === id);
  const s = screens[idx];
  const progress = (idx + 1) / screens.length;
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
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="对" disabled={!v.trim() || busy} onPress={() => decide({ kind: "profile", id: p.id }, true, v.trim())} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="不要" variant="neutral" disabled={busy} onPress={() => decide({ kind: "profile", id: p.id }, false)} />
        </View>
      </View>
    </Card>
  );
}
