import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInRight, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckinItem, checkinItems, CheckinResult, getToday, getWeek, isCrisis, postCheckin } from "@/api";
import { Bar, haptic, Pressy } from "@/components/motion";
import { Body, Button, CrisisCard, Display, Field, Icon, IconButton, IconName, Notice, Small, Title } from "@/components/ui";
import { Status, STATUS_LABELS, VS_PLAN_LABELS, VsPlan } from "@/labels";
import { motion, radius, space, type, useColors } from "@/theme";

type Choice = { status?: Status; vs_plan?: VsPlan };
type Step = { t: "status"; item: CheckinItem } | { t: "vs"; item: CheckinItem } | { t: "note" } | { t: "tomorrow" };

const STATUS_LOOK: Record<Status, { icon: IconName; sub: string }> = {
  done: { icon: "checkmark-circle", sub: "按计划做完了" },
  floor: { icon: "leaf", sub: "做了最小的那一版，也算" },
  skip: { icon: "moon", sub: "没关系，记下来就好" },
};
const VS_LOOK: Record<VsPlan, IconName> = { less: "remove-circle-outline", same: "ellipse-outline", more: "add-circle-outline" };

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

/**
 * 晚间对账：全屏，一屏一问。每件事一屏（点完自动到下一屏），项目再问一句和预想比，
 * 然后「想说点什么」和「明天最想先做的一件事」，最后一个安静的完成页。也可以一句话说完，让模型整理。
 */
export default function Checkin() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<CheckinItem[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState("");
  const [blocker, setBlocker] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [sentenceMode, setSentenceMode] = useState(false);
  const [sentence, setSentence] = useState("");
  const [logged, setLogged] = useState<number | null>(null);
  const [done, setDone] = useState<CheckinResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getToday().then((plan) => setItems(checkinItems(plan)), (e: Error) => setMessage(e.message));
    getWeek().then((w) => setLogged(w.logged_days), () => {});
    return () => { if (advance.current) clearTimeout(advance.current); };
  }, []);

  const steps: Step[] = [];
  for (const item of items ?? []) {
    steps.push({ t: "status", item });
    const s = choices[item.id]?.status;
    if (item.project && s && s !== "skip") steps.push({ t: "vs", item });
  }
  steps.push({ t: "note" }, { t: "tomorrow" });
  const step = steps[Math.min(idx, steps.length - 1)];

  /** 点了一个选项：记下，轻触感，停一下让人看到选中，再翻到下一屏。 */
  function pick(id: string, ch: Choice) {
    haptic.select();
    setChoices((all) => ({ ...all, [id]: { ...all[id], ...ch } }));
    if (advance.current) clearTimeout(advance.current);
    advance.current = setTimeout(() => setIdx((i) => i + 1), 320);
  }

  async function send(body: Parameters<typeof postCheckin>[0]) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await postCheckin(body);
      if (isCrisis(res)) setCrisis(res.message);
      else {
        haptic.success();
        setDone(res);
        getWeek().then((w) => setLogged(w.logged_days), () => {});
      }
    } catch (e) {
      setMessage((e as Error).message); // 一句话没整理出来时，后端会说「请点按钮补上」
    } finally {
      setBusy(false);
    }
  }

  function saveButtons() {
    const picked: Record<string, { status: Status; vs_plan?: VsPlan }> = {};
    for (const [id, ch] of Object.entries(choices)) {
      if (ch.status) picked[id] = { status: ch.status, vs_plan: ch.status === "skip" ? undefined : ch.vs_plan };
    }
    send({ result: { items: picked, note, blocker, tomorrow_task: tomorrow } });
  }

  const shell = (children: React.ReactNode, bottomBar?: React.ReactNode) => (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space.sm }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 560, alignSelf: "center" }}>
        {children}
        {bottomBar && <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>{bottomBar}</View>}
      </View>
    </KeyboardAvoidingView>
  );

  if (crisis) {
    return shell(
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}><CrisisCard message={crisis} /></ScrollView>,
      <Button label="继续" variant="secondary" onPress={() => setCrisis(null)} />,
    );
  }

  if (done) {
    return shell(
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.xl }}>
        <Animated.View entering={ZoomIn.springify().damping(14)} style={{ width: 112, height: 112, borderRadius: radius.pill,
          backgroundColor: c.soft, alignItems: "center", justifyContent: "center" }}>
          <Icon name="checkmark" size={56} color={c.primary} />
        </Animated.View>
        <Animated.View entering={FadeIn.delay(250).duration(motion.slow)} style={{ alignItems: "center", gap: space.md }}>
          <Display center>{done.closing}</Display>
          {logged !== null && (
            <View style={{ alignItems: "center", gap: space.sm }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {Array.from({ length: 7 }, (_, i) => (
                  <View key={i} style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: i < logged ? c.primary : c.sunken }} />
                ))}
              </View>
              <Small muted>这 7 天记录了 {logged} 天</Small>
            </View>
          )}
        </Animated.View>
      </View>,
      <>
        <Button label="回到今天" onPress={leave} />
        <Button label="再改一下" variant="quiet" onPress={() => { setDone(null); setIdx(0); }} />
      </>,
    );
  }

  const top = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
      {idx > 0 && !sentenceMode
        ? <IconButton name="chevron-back" label="上一步" onPress={() => setIdx(idx - 1)} />
        : <IconButton name="close" label="关闭" onPress={sentenceMode ? () => setSentenceMode(false) : leave} />}
      <View style={{ flex: 1 }}>
        {!sentenceMode && <Bar value={(idx + 1) / steps.length} color={c.primary} height={6} />}
      </View>
      {!sentenceMode && (
        <Pressy onPress={() => setSentenceMode(true)} accessibilityRole="button" accessibilityLabel="改成一句话说完"
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm }}>
          <Text style={[type.small, { color: c.primary, fontWeight: "600" }]}>一句话说完</Text>
        </Pressy>
      )}
    </View>
  );

  if (sentenceMode) {
    return shell(
      <>
        {top}
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeInRight.duration(motion.base)} style={{ gap: space.lg }}>
            <Display>一句话说说今天</Display>
            <Body muted>我帮你整理成对账。整理不出来的，再回去点按钮补上。</Body>
            <Field placeholder="比如：英语背了，看书只看了十分钟，复习比预想花得多" value={sentence}
              onChangeText={setSentence} multiline autoFocus />
            {message && <Notice tone="error">{message}</Notice>}
          </Animated.View>
        </ScrollView>
      </>,
      <Button label="帮我记" icon="sparkles" busyLabel={busy ? "正在整理……" : undefined} disabled={!sentence.trim()}
        onPress={() => send({ sentence })} />,
    );
  }

  if (!items) {
    return shell(
      <>{top}<View style={{ padding: space.lg }}>{message ? <Notice tone="error">{message}</Notice> : <Small muted>正在读今天的计划……</Small>}</View></>,
    );
  }

  const counter = items.length > 0 && (step.t === "status" || step.t === "vs")
    ? `第 ${items.indexOf(step.item) + 1} / ${items.length} 件` : null;

  let body: React.ReactNode;
  let bottom: React.ReactNode = null;
  if (step.t === "status") {
    const cur = choices[step.item.id]?.status;
    body = (
      <>
        <Display>{step.item.title}</Display>
        <View style={{ gap: space.md }} accessibilityRole="radiogroup">
          {(Object.keys(STATUS_LABELS) as Status[]).map((k) => (
            <Option key={k} icon={STATUS_LOOK[k].icon} title={STATUS_LABELS[k]} sub={STATUS_LOOK[k].sub}
              on={cur === k} onPress={() => pick(step.item.id, { status: k })} />
          ))}
        </View>
      </>
    );
    bottom = <Button label="先不记这件" variant="quiet" onPress={() => setIdx(idx + 1)} />;
  } else if (step.t === "vs") {
    const cur = choices[step.item.id]?.vs_plan;
    body = (
      <>
        <Display>和预想比，花的时间？</Display>
        <Body muted>{step.item.title}</Body>
        <View style={{ gap: space.md }} accessibilityRole="radiogroup">
          {(Object.keys(VS_PLAN_LABELS) as VsPlan[]).map((k) => (
            <Option key={k} icon={VS_LOOK[k]} title={VS_PLAN_LABELS[k]} on={cur === k}
              onPress={() => pick(step.item.id, { vs_plan: k })} />
          ))}
        </View>
      </>
    );
    bottom = <Button label="跳过" variant="quiet" onPress={() => setIdx(idx + 1)} />;
  } else if (step.t === "note") {
    body = (
      <>
        <Display>想说点什么吗？</Display>
        <Body muted>都可以不填。写下的那句话，会原样出现在今晚的结尾。</Body>
        <Field label="今天的一句话" placeholder="不写也行" value={note} onChangeText={setNote} multiline />
        <Field label="今天卡在哪" placeholder="可不填" value={blocker} onChangeText={setBlocker} />
      </>
    );
    bottom = <Button label={note || blocker ? "下一步" : "跳过"} variant={note || blocker ? "primary" : "secondary"} onPress={() => setIdx(idx + 1)} />;
  } else {
    body = (
      <>
        <Display>明天最想先做的一件事？</Display>
        <Body muted>填了，明天的计划会先给它留 30 分钟。</Body>
        <Field label="明天的一件事" placeholder="可不填" value={tomorrow} onChangeText={setTomorrow} />
        {items.length === 0 && <Notice>今天的计划里没有要对账的事，记一句话或者明天的事就好。</Notice>}
        {message && <Notice tone="error">{message}</Notice>}
      </>
    );
    bottom = <Button label="记好了" icon="checkmark" busyLabel={busy ? "正在记……" : undefined} onPress={saveButtons} />;
  }

  return shell(
    <>
      {top}
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Animated.View key={`${idx}-${step.t}`} entering={FadeInRight.duration(motion.base)} style={{ gap: space.lg }}>
          {counter && <Small muted>{counter}</Small>}
          {body}
        </Animated.View>
      </ScrollView>
    </>,
    bottom,
  );
}

/** 一屏一问里的大选项：左边图标，中间字，选中时陶土色边框和一个勾。 */
function Option({ icon, title, sub, on, onPress }: { icon: IconName; title: string; sub?: string; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressy onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }}
      accessibilityLabel={sub ? `${title}，${sub}` : title} scaleTo={0.97}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 72, padding: space.lg,
        borderRadius: radius.lg, backgroundColor: on ? c.soft : c.card, borderWidth: 2,
        borderColor: on ? c.primary : c.line }}>
      <View style={{ width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
        backgroundColor: on ? c.card : c.sunken }}>
        <Icon name={icon} size={24} color={on ? c.primary : c.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Title color={on ? c.onSoft : c.text}>{title}</Title>
        {sub && <Small color={on ? c.onSoft : c.muted}>{sub}</Small>}
      </View>
      {on && <Animated.View entering={ZoomIn.duration(motion.fast)}><Icon name="checkmark-circle" size={24} color={c.primary} /></Animated.View>}
    </Pressy>
  );
}
