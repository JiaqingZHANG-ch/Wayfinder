import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useEffectEvent, useState } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeOut, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Block, CheckinItem, checkinItems, DeepTalkState, getDeepTalk, getToday, isCrisis, OFFLINE, postCheckin, say, snoozeDeepTalk,
} from "@/api";
import { clayIcon } from "@/clay-icon";
import { EventIcon, Figure, Stage } from "@/components/clay";
import { ahead, haptic, Pressy, Skeleton } from "@/components/motion";
import { toMin } from "@/components/plan-view";
import { Body, Button, Card, CrisisCard, Field, Icon, IconName, Notice, Small, Title } from "@/components/ui";
import { Status, STATUS_LABELS, VS_PLAN_LABELS, VsPlan } from "@/labels";
import { motion, NightProvider, radius, space, type, useColors } from "@/theme";

type Choice = { status?: Status; vs_plan?: VsPlan };
type Step = { item: CheckinItem; vs?: boolean }; // vs：项目做了以后再问一句「和预想比」

const SHORT: Record<Status, string> = { done: "做了", floor: "保底", skip: "没做" };
const BEAN: Record<Status, number> = {
  done: require("../../assets/images/clay/bean-ochre.webp"),
  floor: require("../../assets/images/clay/bean-sage.webp"),
  skip: require("../../assets/images/clay/bean-grey.webp"),
};
const LATE = "来不及排了：";
const plain = (t: string) => t.replace("（保底）", "");

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
// 长谈邀请卡：每一步一个动词开头的标题，下面一句说清聊什么
const INVITE: Record<number, [string, string]> = {
  1: ["聊聊现状", "四个打分，两个问题。"],
  2: ["想想方向", "两个问题，说说你想往哪走。"],
  3: ["找找能量", "哪些事越做越有劲。聊完明天的安排会跟着变。"],
  4: ["写三个版本", "写三个五年后的你，几位顾问各说几句。"],
};

/** 每件事一屏（项目做了再问一句和预想比）；托盘格能点回去改；最后一件对完就存，换成收尾。 */
function stepsOf(items: CheckinItem[], all: Record<string, Choice>): Step[] {
  const out: Step[] = [];
  for (const item of items) {
    out.push({ item });
    const s = all[item.id]?.status;
    if (item.project && s && s !== "skip") out.push({ item, vs: true });
  }
  return out;
}

/** 晚间对账（v4 的 .recon / .closing）：夜里的配色，顶上托盘格、中间一张大卡、下面三个按钮；对完是坐在山坡上的收尾。 */
export default function Checkin() {
  return <NightProvider value><Flow /></NightProvider>;
}

function Flow() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<CheckinItem[] | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [moved, setMoved] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState("");
  const [blocker, setBlocker] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [touched, setTouched] = useState<Set<string>>(new Set()); // 这次动过的字段：只发这些，没动的不冲掉之前记的
  const touch = (k: string, set: (v: string) => void) => (v: string) => { set(v); setTouched((t) => new Set(t).add(k)); };
  const [sentenceMode, setSentenceMode] = useState(false);
  const [sentence, setSentence] = useState("");
  const [done, setDone] = useState(false);
  const [invite, setInvite] = useState<DeepTalkState | null>(null); // 今晚要不要请你接着聊（长谈）
  const [message, setMessage] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ from: Step; all: Record<string, Choice> } | null>(null); // 答完停一下再翻
  const [reader, setReader] = useState(false); // 开着读屏时不自动翻页，让人听完再点「下一件」

  useEffect(() => {
    getToday().then((plan) => {
      setItems(checkinItems(plan));
      setBlocks(plan.blocks);
      // 白天重排时拿掉的事已经不在计划里，自然不进对账；求解器只在 warnings 里留下「来不及排了」的，收尾时提一句
      setMoved(plan.warnings.filter((w) => w.startsWith(LATE)).map((w) => plain(w.slice(LATE.length))));
      if (plan.checkin) { // 再对一遍：上次选的先填好（没动的字段不会发回去）
        setChoices(plan.checkin.items);
        setNote(plan.checkin.note ?? "");
        setBlocker(plan.checkin.blocker ?? "");
        setTomorrow(plan.tomorrow_task ?? "");
      }
    }, () => setMessage(OFFLINE));
    AccessibilityInfo.isScreenReaderEnabled().then(setReader, () => {});
  }, []);
  const turn = useEffectEvent((p: { from: Step; all: Record<string, Choice> }) => forward(p.from, p.all));
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => turn(pending), 520);
    return () => clearTimeout(t);
  }, [pending]);

  const steps = stepsOf(items ?? [], choices);
  const step = steps[Math.min(idx, steps.length - 1)] as Step | undefined;
  const texts = () => Object.fromEntries(Object.entries({ note, blocker, tomorrow_task: tomorrow }).filter(([k]) => touched.has(k)));

  function go(i: number) {
    setPending(null);
    setMessage(null);
    setIdx(i);
  }

  /** 这件对完了：项目做了就接着问和预想比，否则回到第一件还没对的；都对完就存。 */
  function forward(from: Step, all: Record<string, Choice>) {
    const st = stepsOf(items ?? [], all);
    const here = st.findIndex((x) => x.item.id === from.item.id && !x.vs);
    if (!from.vs && st[here + 1]?.vs) return go(here + 1);
    const next = st.findIndex((x) => !x.vs && !all[x.item.id]?.status);
    if (next >= 0) return go(next);
    const picked: Record<string, { status: Status; vs_plan?: VsPlan }> = {};
    for (const [id, ch] of Object.entries(all)) {
      if (ch.status) picked[id] = { status: ch.status, vs_plan: ch.status === "skip" ? undefined : ch.vs_plan };
    }
    send({ result: { items: picked, ...texts() } });
  }

  /** 点了一个答案：记下，轻触感，停一下让人看到盖上的章，再翻（开着读屏时不自动翻）。 */
  function pick(ch: Choice) {
    if (!step) return;
    haptic.select();
    const all = { ...choices, [step.item.id]: { ...choices[step.item.id], ...ch } };
    setChoices(all);
    setPending(reader ? null : { from: step, all });
  }

  async function send(body: Parameters<typeof postCheckin>[0]) {
    setBusy(true);
    setInvite(null); // 重新存一遍：旧的邀请卡先撤掉，存成功后再问一次
    setMessage(null);
    try {
      const res = await postCheckin(body);
      if (isCrisis(res)) setCrisis(res.message);
      else {
        haptic.success();
        setDone(true);
        getDeepTalk().then((s) => setInvite(s.invite ? s : null), () => {}); // 拿不到就不请
      }
    } catch (e) {
      setMessage(say(e)); // 一句话没整理出来时，后端会说「请点按钮补上」
    } finally {
      setBusy(false);
    }
  }

  /** 晚安：收尾时写了明天先做什么、随手记了一句、卡在哪，就补存动过的那几样再走。 */
  async function bye() {
    if (!touched.size) return leave();
    setBusy(true);
    setMessage(null);
    try {
      const res = await postCheckin({ result: { items: {}, ...texts() } });
      if (isCrisis(res)) setCrisis(res.message);
      else leave();
    } catch (e) {
      setMessage(say(e));
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 560, alignSelf: "center" }}>{children}</View>
    </KeyboardAvoidingView>
  );
  const page = { flexGrow: 1, paddingTop: insets.top + space.sm, paddingHorizontal: 20, paddingBottom: insets.bottom + space.xl, gap: space.lg };

  if (crisis) {
    return shell(
      <ScrollView contentContainerStyle={page}>
        <CrisisCard message={crisis} />
        <Button label="继续" variant="secondary" onPress={() => setCrisis(null)} />
      </ScrollView>,
    );
  }

  if (done || items?.length === 0) {
    return shell(
      <Closing items={items ?? []} choices={choices} moved={moved} onEdit={(id) => {
        setDone(false);
        go(steps.findIndex((x) => x.item.id === id && !x.vs));
      }}>
        <Field placeholder="明天先做什么？可以不填" accessibilityLabel="明天先做的一件事" value={tomorrow}
          onChangeText={touch("tomorrow_task", setTomorrow)} />
        <Field placeholder="随手记一句" accessibilityLabel="今天想记的一句话" value={note} onChangeText={touch("note", setNote)} />
        <Field placeholder="卡在哪（可不写）" accessibilityLabel="今天卡在哪" value={blocker} onChangeText={touch("blocker", setBlocker)} />
        {message && <Notice tone="error">{message}</Notice>}
        {invite && (
          <Animated.View exiting={FadeOut.duration(motion.base)}>
            <Card style={{ gap: space.xs }}>
              <Text style={[type.eyebrow, { color: c.muted }]}>{`第 ${invite.step} 次长谈，约 10 分钟`}</Text>
              <Title>{INVITE[invite.step ?? 0]?.[0] ?? invite.steps.find((s) => s.step === invite.step)?.name}</Title>
              {!!INVITE[invite.step ?? 0] && <Small muted>{INVITE[invite.step ?? 0][1]}</Small>}
              <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
                <View style={{ flex: 1 }}><Button label="现在聊" variant="secondary" onPress={() => router.replace("/deep-talk")} /></View>
                <View style={{ flex: 1 }}><Button label="明天再说" variant="neutral" onPress={() => { snoozeDeepTalk().finally(() => setInvite(null)); }} /></View>
              </View>
            </Card>
          </Animated.View>
        )}
        <View style={{ marginTop: "auto", paddingTop: space.md }}>
          <Button label="晚安" busyLabel={busy ? "正在记……" : undefined} onPress={bye} />
        </View>
      </Closing>,
    );
  }

  if (sentenceMode) {
    return shell(
      <ScrollView contentContainerStyle={page} keyboardShouldPersistTaps="handled">
        <Top title="一句话说完" icon="chevron-back" label="回到逐项对账" onPress={() => { setMessage(null); setSentenceMode(false); }} />
        <Body muted>我帮你整理成对账。整理不出来的，再回去点按钮补上。</Body>
        <Field placeholder="比如：英语背了，看书只看了十分钟，复习比预想花得多" value={sentence}
          onChangeText={setSentence} multiline autoFocus />
        {message && <Notice tone="error">{message}</Notice>}
        <View style={{ marginTop: "auto" }}>
          <Button label="帮我记" busyLabel={busy ? "正在整理……" : undefined} disabled={!sentence.trim()} onPress={() => send({ sentence })} />
        </View>
      </ScrollView>,
    );
  }

  const top = (
    <Top title="对个账" icon="close" label="关闭" onPress={leave}>
      {idx === 0 && (
        <Pressy onPress={() => { go(0); setSentenceMode(true); }} accessibilityRole="button" accessibilityLabel="改成一句话说完"
          style={{ height: 44, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.btn,
            backgroundColor: c.surface, boxShadow: `0 4px 0 ${c.cardEdge}` }}>
          <Text style={[type.label, { fontSize: 13, color: c.text }]}>一句话说完</Text>
        </Pressy>
      )}
    </Top>
  );

  if (!items || !step) {
    return shell(
      <View style={page}>
        {top}
        {message ? <Notice tone="error">{message}</Notice> : (
          <>
            <Skeleton height={60} r={16} />
            <View style={{ flex: 1 }} />
            {[0, 1, 2].map((i) => <Skeleton key={i} height={54} r={radius.btn} />)}
          </>
        )}
      </View>,
    );
  }

  const it = step.item;
  const cur = choices[it.id];
  const answered = step.vs ? !!cur?.vs_plan : !!cur?.status;
  const b = blocks.find((x) => x.id === it.id || x.task_id === it.id);
  const sub = step.vs ? "和预想比，花的时间？" : it.one ? it.tag
    : b ? `${b.start} 开始，${b.pomodoros ? `${b.pomodoros} 个番茄` : `${toMin(b.end) - toMin(b.start)} 分钟`}` : it.tag;
  // 「昨晚定的一件事」没有保底版，只问做了没有
  const keys = (Object.keys(STATUS_LABELS) as Status[]).filter((k) => !(it.one && k === "floor"));

  return shell(
    <View style={page}>
      {top}
      {/* 托盘：一件事一格，对过的带记号；点一格回到那件改 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
        contentContainerStyle={{ flexGrow: 1, gap: 10, paddingBottom: 4 }}>
        {items.map((x) => {
          const s = choices[x.id]?.status;
          const on = x.id === it.id;
          return (
            <Pressy key={x.id} onPress={() => go(steps.findIndex((y) => y.item.id === x.id && !y.vs))} scaleTo={1}
              accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={`${plain(x.title)}，${s ? STATUS_LABELS[s] : "还没对"}，点一下回到这件`}
              style={{ flexGrow: 1, flexBasis: 0, minWidth: 96, height: 60, paddingHorizontal: space.sm, borderRadius: radius.btn,
                alignItems: "center", justifyContent: "center", gap: 1, backgroundColor: on ? c.line : c.surface,
                boxShadow: `0 4px 0 ${on ? c.primaryEdge : c.cardEdge}` }}>
              <Text numberOfLines={1} style={[type.label, { lineHeight: 20, color: c.text }]}>{plain(x.title)}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {s && <Dot s={s} />}
                <Text style={[type.small, { color: c.muted }]}>{s ? SHORT[s] : "还没对"}</Text>
              </View>
            </Pressy>
          );
        })}
      </ScrollView>

      {/* 中间一张大卡：这件事的黏土图标、名字、几点做多久；答了盖一个章 */}
      <View style={{ flex: 1, minHeight: 220, alignItems: "center", justifyContent: "center" }}>
        <Animated.View key={`${idx}-${step.vs ? "vs" : "s"}`} entering={ahead("right")}
          style={{ width: "100%", maxWidth: 300, minHeight: 200, padding: space.lg, borderRadius: radius.card, alignItems: "center",
            justifyContent: "center", gap: 4, backgroundColor: c.surface, boxShadow: c.clay }}>
          <EventIcon icon={clayIcon(it)} size={92} />
          <Text accessibilityRole="header" style={[type.display, { color: c.text, textAlign: "center", marginTop: 6 }]}>{it.title}</Text>
          <Text style={[type.body, { fontSize: 15, lineHeight: 22, color: c.muted, textAlign: "center" }]}>{sub}</Text>
          {!step.vs && cur?.status && <Seal key={cur.status} s={cur.status} />}
        </Animated.View>
      </View>

      <View style={{ gap: 12 }} accessibilityRole="radiogroup">
        {step.vs
          ? (Object.keys(VS_PLAN_LABELS) as VsPlan[]).map((k) => (
            <Answer key={k} label={VS_PLAN_LABELS[k]} on={cur?.vs_plan === k} onPress={() => pick({ vs_plan: k })} />
          ))
          : keys.map((k) => <Answer key={k} s={k} label={STATUS_LABELS[k]} on={cur?.status === k} onPress={() => pick({ status: k })} />)}
        {reader && answered ? <Button label="下一件" variant="secondary" onPress={() => forward(step, choices)} />
          : step.vs ? <Button label="跳过" variant="neutral" onPress={() => forward(step, choices)} />
            : <Text style={[type.small, { color: c.muted, textAlign: "center" }]}>没做也没关系。</Text>}
        {busy && <Small muted>正在记……</Small>}
        {message && <Notice tone="error">{message}</Notice>}
      </View>
    </View>,
  );
}

/** 顶上一行：标题、（第一屏的「一句话说完」）、右边一个方块按钮。 */
function Top({ title, icon, label, onPress, children }: {
  title: string; icon: IconName; label: string; onPress: () => void; children?: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}>
      <Text accessibilityRole="header" style={[type.display, { flex: 1, fontSize: 22, lineHeight: 30, color: c.text }]}>{title}</Text>
      {children}
      <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.94}
        style={{ width: 44, height: 44, borderRadius: radius.btn, alignItems: "center", justifyContent: "center",
          backgroundColor: c.line, boxShadow: `0 4px 0 ${c.cardEdge}` }}>
        <Icon name={icon} size={20} color={c.text} />
      </Pressy>
    </View>
  );
}

/** 一个答案按钮：三个答案同色同重（不打分），只靠左边的记号区分；选中的换主色底边。 */
function Answer({ s, label, on, onPress }: { s?: Status; label: string; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressy onPress={onPress} scaleTo={0.98} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label}
      style={{ minHeight: 54, borderRadius: radius.btn, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
        backgroundColor: c.line, boxShadow: `0 4px 0 ${on ? c.primaryEdge : c.cardEdge}` }}>
      {s && <Dot s={s} size={14} />}
      <Text style={[type.title, { fontSize: 18, lineHeight: 26, color: c.text }]}>{label}</Text>
    </Pressy>
  );
}

/** 记号：做了实心、保底半满、没做空心（和本周页一样）。 */
function Dot({ s, size = 10 }: { s: Status; size?: number }) {
  const c = useColors();
  const color = s === "done" ? c.primary : s === "floor" ? c.done : c.mark;
  return (
    <View style={{ width: size, height: size, borderRadius: size, overflow: "hidden", borderWidth: s === "done" ? 0 : 2, borderColor: color,
      backgroundColor: s === "done" ? color : "transparent" }}>
      {s === "floor" && <View style={{ width: "50%", height: "100%", backgroundColor: color }} />}
    </View>
  );
}

/** 大卡右上角盖的章：一颗黏土豆子写着「做了 / 保底 / 没做」。 */
function Seal({ s }: { s: Status }) {
  return (
    <Animated.View entering={ZoomIn.springify().stiffness(450).damping(8)} pointerEvents="none"
      style={{ position: "absolute", right: -14, top: -18, width: 96, height: 64, alignItems: "center", justifyContent: "center",
        transform: [{ rotate: "-8deg" }] }}>
      <Image source={BEAN[s]} contentFit="fill" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <Text style={[type.body, { fontSize: 16, lineHeight: 22, fontWeight: "700", color: "#2A1606" }]}>{SHORT[s]}</Text>
    </Animated.View>
  );
}

/**
 * 收尾：夜里的舞台上，小人坐下打哈欠（和今天页同一套母版图），一句「今天收住了」，排不上的事说一句，
 * 今天的账一件一块（点了回去改）。children 是下面的输入和「晚安」。
 */
function Closing({ items, choices, moved, onEdit, children }: {
  items: CheckinItem[]; choices: Record<string, Choice>; moved: string[]; onEdit: (id: string) => void; children: React.ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const marks = items.filter((x) => choices[x.id]?.status);
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + space.xl }} keyboardShouldPersistTaps="handled">
      <Stage night stones={0}><Figure level={1} night /></Stage>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: space.lg, gap: space.md }}>
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={[type.display, { color: c.text }]}>今天收住了。</Text>
          {moved.length > 0 && (
            <Text style={[type.body, { lineHeight: 24, color: c.muted }]}>{moved.join("、")}今天没排上。</Text>
          )}
        </View>
        {marks.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }} accessibilityLabel="今天的账，点一下可以改">
            {marks.map((x) => {
              const s = choices[x.id].status!;
              return (
                <Pressy key={x.id} onPress={() => onEdit(x.id)} scaleTo={1} accessibilityRole="button"
                  accessibilityLabel={`${plain(x.title)}：${STATUS_LABELS[s]}，点一下改`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: radius.btn,
                    backgroundColor: c.line, boxShadow: `0 4px 0 ${c.cardEdge}` }}>
                  <Dot s={s} />
                  <Text style={[type.label, { color: c.text }]}>{plain(x.title)}</Text>
                </Pressy>
              );
            })}
          </View>
        )}
        {children}
      </View>
    </ScrollView>
  );
}
