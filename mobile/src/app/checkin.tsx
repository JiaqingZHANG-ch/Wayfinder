import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckinItem, checkinItems, CheckinResult, getToday, getWeek, isCrisis, OFFLINE, postCheckin, say } from "@/api";
import { Glow, Glyph, Sky } from "@/components/art";
import { ahead, Bar, EASE, from as start, haptic, Pressy, Skeleton } from "@/components/motion";
import { useNow } from "@/components/plan-view";
import { Body, Button, Card, CrisisCard, Display, Field, Icon, IconButton, IconName, Notice, Small, Title } from "@/components/ui";
import { Status, STATUS_LABELS, VS_PLAN_LABELS, VsPlan } from "@/labels";
import { motion, radius, space, type, useColors } from "@/theme";

type Choice = { status?: Status; vs_plan?: VsPlan };
type Step = { t: "status"; item: CheckinItem } | { t: "vs"; item: CheckinItem } | { t: "note" } | { t: "tomorrow" };

const STATUS_LOOK: Record<Status, { icon: IconName; sub: string }> = {
  done: { icon: "ellipse", sub: "按计划做完了" },
  floor: { icon: "contrast", sub: "做了最小的那一版，也算" },
  skip: { icon: "ellipse-outline", sub: "没关系，记下来就好" },
};
// 保底的事：今晚计划就是保底版，「按今晚的计划做了」= 保底；做满标准版才算「做了」
const FLOOR_SUB: Record<Status, string> = { done: "做满了标准版", floor: "按今晚的计划做了", skip: STATUS_LOOK.skip.sub };
const isFloor = (t: string) => t.endsWith("（保底）");
// 「差不多」用两条横线（读作等于），不和「没做」的空心圆撞
const VS_LOOK: Record<VsPlan, IconName> = { less: "remove-circle-outline", same: "reorder-two-outline", more: "add-circle-outline" };

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

/**
 * 晚间对账：全屏，一屏一问。每件事一屏（点完自动到下一屏），项目再问一句和预想比，
 * 然后「想说点什么」和「明天最想先做的一件事」，最后一个安静的完成页。也可以一句话说完，让模型整理。
 */
export default function Checkin() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const [items, setItems] = useState<CheckinItem[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState("");
  const [blocker, setBlocker] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [touched, setTouched] = useState<Set<string>>(new Set()); // 这次动过的字段：只发这些，没动的不冲掉之前记的
  const touch = (k: string, set: (v: string) => void) => (v: string) => { set(v); setTouched((t) => new Set(t).add(k)); };
  const [sentenceMode, setSentenceMode] = useState(false);
  const [sentence, setSentence] = useState("");
  const [logged, setLogged] = useState<boolean[] | null>(null); // 这 7 天哪晚记了
  const [done, setDone] = useState<CheckinResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reader, setReader] = useState(false); // 开着读屏时不自动翻页，让人听完再点「下一步」
  const [back, setBack] = useState(false); // 刚才是往回翻：新的一屏从左边进来

  useEffect(() => {
    getToday().then((plan) => {
      setItems(checkinItems(plan));
      if (plan.checkin) { // 再改一下：上次选的先填好（没动的字段不会发回去）
        setChoices(plan.checkin.items);
        setNote(plan.checkin.note ?? "");
        setBlocker(plan.checkin.blocker ?? "");
        setTomorrow(plan.tomorrow_task ?? "");
      }
    }, () => setMessage(OFFLINE));
    getWeek().then((w) => setLogged(w.logged), () => {});
    AccessibilityInfo.isScreenReaderEnabled().then(setReader, () => {});
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

  /** 换到第 i 屏：先取消还没到点的自动翻页，清掉上一屏的提示。 */
  function go(i: number) {
    if (advance.current) clearTimeout(advance.current);
    advance.current = null;
    setMessage(null);
    setBack(i < idx);
    setIdx(i);
  }

  /** 点了一个选项：记下，轻触感，停一下让人看到选中，再翻到下一屏（开着读屏时不自动翻）。 */
  function pick(id: string, ch: Choice) {
    haptic.select();
    setChoices((all) => ({ ...all, [id]: { ...all[id], ...ch } }));
    if (advance.current) clearTimeout(advance.current);
    if (!reader) advance.current = setTimeout(() => go(idx + 1), 320);
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
        getWeek().then((w) => setLogged(w.logged), () => {});
      }
    } catch (e) {
      setMessage(say(e)); // 一句话没整理出来时，后端会说「请点按钮补上」
    } finally {
      setBusy(false);
    }
  }

  function saveButtons() {
    const picked: Record<string, { status: Status; vs_plan?: VsPlan }> = {};
    for (const [id, ch] of Object.entries(choices)) {
      if (ch.status) picked[id] = { status: ch.status, vs_plan: ch.status === "skip" ? undefined : ch.vs_plan };
    }
    const texts = { note, blocker, tomorrow_task: tomorrow };
    send({ result: { items: picked, ...Object.fromEntries(Object.entries(texts).filter(([k]) => touched.has(k))) } });
  }

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

  if (crisis) {
    return shell(
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}><CrisisCard message={crisis} /></ScrollView>,
      <Button label="继续" variant="secondary" onPress={() => setCrisis(null)} />,
    );
  }

  if (done) {
    // 今晚对过的事，一件一个它自己的记号：做了实心、保底半满、没做描边
    const marks = (items ?? []).filter((it) => done.saved.items?.[it.id]?.status);
    const big = marks.length > 5 ? 40 : 56;
    return shell(
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.xl }}>
        {marks.length ? (
          <View style={{ alignItems: "center", justifyContent: "center", minHeight: 160, alignSelf: "stretch" }}
            accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Glow color={c.kind.must} size={320} opacity={0.16} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.xl, maxWidth: 320 }}>
              {marks.map((it, i) => {
                const s = done.saved.items?.[it.id]?.status;
                return (
                  <Animated.View key={it.id} entering={start(ZoomIn.delay(i * 80).duration(320).easing(EASE), { transform: [{ scale: 0.6 }] })}>
                    <Glyph name={it.title} star={it.one} color={c.kind[it.kind]} size={big}
                      fill={s === "done" ? "full" : s === "floor" ? "half" : "empty"} />
                  </Animated.View>
                );
              })}
            </View>
          </View>
        ) : (
          <Animated.View entering={FadeIn.duration(360)}>
            <Animated.View entering={start(ZoomIn.duration(360).easing(EASE), { transform: [{ scale: 0.9 }] })}
              style={{ width: 112, height: 112, borderRadius: radius.pill, backgroundColor: c.soft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="moon" size={40} color={c.primary} />
            </Animated.View>
          </Animated.View>
        )}
        <Animated.View entering={FadeIn.delay(250).duration(motion.slow)} style={{ alignSelf: "stretch", alignItems: "center", gap: space.md }}>
          <Display center>{done.closing}</Display>
          {logged !== null && (
            <View style={{ alignItems: "center", gap: space.sm }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {logged.map((x, i) => (
                  <View key={i} style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: x ? c.kind.must : c.sunken }} />
                ))}
              </View>
              <Small muted>这 7 天记了 {logged.filter(Boolean).length} 晚</Small>
            </View>
          )}
          {!!done.saved.tomorrow_task?.trim() && (
            <Card style={{ alignSelf: "stretch", gap: 2, marginTop: space.md }}>
              <Small muted>明天先做</Small>
              <Title>{done.saved.tomorrow_task.trim()}</Title>
            </Card>
          )}
        </Animated.View>
      </View>,
      <>
        <Button label="晚安" icon="moon-outline" variant="secondary" onPress={leave} />
        <Button label="再改一下" variant="neutral" onPress={() => { setDone(null); go(0); }} />
      </>,
    );
  }

  const top = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
      {idx > 0 && !sentenceMode
        ? <IconButton name="chevron-back" label="上一步" onPress={() => go(idx - 1)} />
        : sentenceMode
          ? <IconButton name="chevron-back" label="回到逐项对账" onPress={() => { setMessage(null); setSentenceMode(false); }} />
          : <IconButton name="close" label="关闭" onPress={leave} />}
      <View style={{ flex: 1 }}>
        {!sentenceMode && <Bar value={(idx + 1) / steps.length} color={c.primary} height={6} duration={300} />}
      </View>
      {/* 和复盘一样：第一屏右边是「一句话说完」，往后右边是关闭 */}
      {idx > 0 && !sentenceMode && <IconButton name="close" label="关闭" onPress={leave} />}
      {idx === 0 && !sentenceMode && (
        <Pressy onPress={() => { go(idx); setSentenceMode(true); }} accessibilityRole="button" accessibilityLabel="改成一句话说完"
          style={{ minHeight: 44, justifyContent: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: space.md,
            borderRadius: radius.pill, borderWidth: 1, borderColor: c.line }}>
            <Icon name="sparkles-outline" size={14} color={c.text} />
            <Text style={[type.small, { color: c.text, fontWeight: "600" }]}>一句话说完</Text>
          </View>
        </Pressy>
      )}
    </View>
  );

  if (sentenceMode) {
    return shell(
      <>
        {top}
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <Animated.View entering={ahead("right")} style={{ gap: space.lg }}>
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
      <>{top}<View style={{ padding: space.lg, gap: space.md }}>{message ? <Notice tone="error">{message}</Notice> : (
        <>
          <Skeleton height={36} width="70%" />
          <View style={{ flex: 1 }} />
          {[0, 1, 2].map((i) => <Skeleton key={i} height={72} r={radius.lg} />)}
        </>
      )}</View></>,
    );
  }

  let body: React.ReactNode;
  let bottom: React.ReactNode = null;
  if (step.t === "status") {
    const cur = choices[step.item.id]?.status;
    const floor = isFloor(step.item.title);
    // 「昨晚定的一件事」没有保底版，只问做了没有
    const keys = (Object.keys(STATUS_LABELS) as Status[]).filter((k) => !(step.item.one && k === "floor"));
    body = (
      <>
        <ItemHead item={step.item} />
        <Display>{step.item.title}</Display>
        <BigMark item={step.item} status={cur} />
        <View style={{ gap: space.md, marginTop: "auto" }} accessibilityRole="radiogroup">
          {keys.map((k) => (
            <Option key={k} icon={STATUS_LOOK[k].icon} title={STATUS_LABELS[k]} sub={floor ? FLOOR_SUB[k] : STATUS_LOOK[k].sub}
              mark={{ name: step.item.title, star: step.item.one, fill: k === "done" ? "full" : k === "floor" ? "half" : "empty",
                color: c.kind[step.item.kind] }}
              on={cur === k} onPress={() => pick(step.item.id, { status: k })} />
          ))}
        </View>
      </>
    );
    bottom = cur // 再改一下时已经选好了：直接下一步
      ? <Button label="下一步" onPress={() => go(idx + 1)} />
      : <Button label="先不记这件" variant="neutral" onPress={() => go(idx + 1)} />;
  } else if (step.t === "vs") {
    const cur = choices[step.item.id]?.vs_plan;
    body = (
      <>
        <ItemHead item={step.item} title />
        <Display>和预想比，花的时间？</Display>
        <BigMark item={step.item} status={choices[step.item.id]?.status} />
        <View style={{ gap: space.md, marginTop: "auto" }} accessibilityRole="radiogroup">
          {(Object.keys(VS_PLAN_LABELS) as VsPlan[]).map((k) => (
            <Option key={k} icon={VS_LOOK[k]} title={VS_PLAN_LABELS[k]} on={cur === k}
              onPress={() => pick(step.item.id, { vs_plan: k })} />
          ))}
        </View>
      </>
    );
    bottom = <Button label={cur ? "下一步" : "跳过"} variant={cur ? "primary" : "neutral"} onPress={() => go(idx + 1)} />;
  } else if (step.t === "note") {
    body = (
      <>
        <Display>想说点什么吗？</Display>
        <Body muted>都可以不填。「今天的一句话」会原样出现在今晚的结尾。</Body>
        <Field label="今天的一句话" placeholder="比如：今天比想的顺" value={note} onChangeText={touch("note", setNote)} multiline />
        <Field label="今天卡在哪" placeholder="比如：下午一直犯困" value={blocker} onChangeText={touch("blocker", setBlocker)} />
      </>
    );
    bottom = <Button label={note || blocker ? "下一步" : "不写，下一步"} variant={note || blocker ? "primary" : "neutral"} onPress={() => go(idx + 1)} />;
  } else {
    body = (
      <>
        <Display>明天最想先做的一件事？</Display>
        <Body muted>可不填。填了，明天的计划会先给它留 30 分钟。</Body>
        <Field accessibilityLabel="明天的一件事" placeholder="比如：把报告第三节写完" value={tomorrow} onChangeText={touch("tomorrow_task", setTomorrow)} />
        {items.length === 0 && <Notice>今天的计划里没有要对账的事，记一句话或者明天的事就好。</Notice>}
        {message && <Notice tone="error">{message}</Notice>}
      </>
    );
    bottom = <Button label="记好了" icon="checkmark" busyLabel={busy ? "正在记……" : undefined} onPress={saveButtons} />;
  }

  return shell(
    <>
      {top}
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.lg }} keyboardShouldPersistTaps="handled">
        {/* 选项贴在底部按钮上方，单手够得着；往前翻从右边进，往回翻从左边进 */}
        <Animated.View key={`${idx}-${step.t}`} entering={ahead(back ? "left" : "right")} exiting={Platform.OS === "web" ? undefined : FadeOut.duration(120)}
          style={{ flexGrow: 1, gap: space.lg }}>
          {body}
        </Animated.View>
      </ScrollView>
    </>,
    bottom,
  );
}

/** 每屏标题上面那行：这件事的记号和它是什么（习惯 / 项目 / 昨晚定的一件事）。title：项目那屏再带上事情名。 */
/** 每屏中间的大记号：选了「做了」就填满、「保底」填一半，和本周页一样；还没选是淡的描边。 */
function BigMark({ item, status }: { item: CheckinItem; status?: Status }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, minHeight: 120, alignItems: "center", justifyContent: "center" }}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Glow color={c.kind[item.kind]} size={240} opacity={!status || status === "skip" ? 0.1 : 0.28} />
      <Animated.View key={status ?? "none"} entering={ZoomIn.duration(220)}>
        <Glyph name={item.title} star={item.one} color={c.kind[item.kind]} size={144}
          fill={status === "done" ? "full" : status === "floor" ? "half" : "empty"} dim={!status || status === "skip"} />
      </Animated.View>
    </View>
  );
}

function ItemHead({ item, title }: { item: CheckinItem; title?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: -space.sm }}>
      <Glyph name={item.title} star={item.one} color={c.kind[item.kind]} size={16} />
      <Text style={[type.eyebrow, { color: c.muted }]}>{title ? `${item.tag} · ${item.title}` : item.tag}</Text>
    </View>
  );
}

/**
 * 一屏一问里的大选项：左边图标，中间字，选中时陶土色边框和一个勾。
 * mark：用这件事自己的记号代替图标（实心 = 做了，半满 = 保底，空心 = 没做，和本周页一样）。
 */
function Option({ icon, title, sub, on, onPress, mark }: {
  icon: IconName; title: string; sub?: string; on: boolean; onPress: () => void;
  mark?: { name: string; star?: boolean; fill: "full" | "half" | "empty"; color: string };
}) {
  const c = useColors();
  return (
    <Pressy onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }}
      accessibilityLabel={sub ? `${title}，${sub}` : title} scaleTo={0.97}
      style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 72, padding: space.lg,
        borderRadius: radius.lg, backgroundColor: on ? c.soft : c.surface, borderWidth: 1.5,
        borderColor: on ? c.primary : "transparent", boxShadow: on ? undefined : c.shadow }}>
      <View style={{ width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
        backgroundColor: on ? c.card : c.sunken }}>
        {mark ? <View style={{ opacity: on ? 1 : 0.6 }}><Glyph name={mark.name} star={mark.star} fill={mark.fill} size={22} color={mark.color} /></View>
          : <Icon name={icon} size={24} color={on ? c.primary : c.muted} />}
      </View>
      <View style={{ flex: 1 }}>
        <Title color={on ? c.onSoft : c.text}>{title}</Title>
        {sub && <Small color={on ? c.onSoft : c.muted}>{sub}</Small>}
      </View>
      {on && <Animated.View entering={ZoomIn.duration(motion.fast)}><Icon name="checkmark-circle" size={24} color={c.primary} /></Animated.View>}
    </Pressy>
  );
}
