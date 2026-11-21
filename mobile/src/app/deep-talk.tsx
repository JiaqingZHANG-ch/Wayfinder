import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  answerDeepTalk, ApiError, confirmDeepTalk, Crisis, DeepTalkState, declineLetter, dayText, Energy, getDeepTalk, getProfile, HabitProposal, isCrisis, OFFLINE,
  pendingCount, postLetter, Profile, say, startCouncil, TalkConfirm,
} from "@/api";
import { Glyph } from "@/components/art";
import { EnergyPick } from "@/components/chips";
import { Changes } from "@/components/changes";
import { CouncilView, VERSION } from "@/components/council-view";
import { Dots } from "@/components/dots";
import { ahead, Bar, haptic, Pressy, Skeleton } from "@/components/motion";
import { Body, Button, Card, Chip, CrisisCard, Display, Field, IconButton, Notice, Row, Small, Title } from "@/components/ui";
import { motion, radius, space, type, useColors } from "@/theme";
import { planDiff } from "@/diff";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

// 追问三个小问题各自的灰字
const FOLLOW_HINT: Record<string, string> = { 在哪: "比如：图书馆三楼", 和谁: "比如：一个人", 用什么: "比如：笔记本和一支笔" };
// 落地卡眉标：档案层级名换成人话
const LEVEL_NAME: Record<string, string> = { 近期观察: "我看到的一点", 使命: "你想去的方向，一句话" };
// 版本打分每一项下面的一句
const RATE_HINT: Record<string, string> = { 资源: "时间、钱、人够吗", 喜欢: "想到就有劲吗", 信心: "做得成吗", 和自己一致: "像你想成为的人吗" };

/**
 * 深度长谈：全屏，一屏一个问题，版式照晚间对账。每屏答完马上存，关掉下次从没答的那一屏接着聊。
 * 一步的最后一屏答完是小结：这一步待确认的提议，一张一张确认或不要。
 * ?step=4&part=choose：第 4 次选了「先不选」以后，从「我」页回来选一个版本。
 */
export default function DeepTalk() {
  const c = useColors();
  const insets = useSafeAreaInsets();
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
  // 关掉时没确认完的提议：下次打开先回到那一步的小结，不然就再也找不到了
  const owed = st ? st.steps.find((x) => x.status === "done" && pendingCount(st, x.step) > 0)?.step ?? null : null;
  const shown = st ? summary ?? owed ?? (st.step === null ? 4 : null) : null; // 显示哪一步的小结，null = 显示问题屏
  const onCouncil = !choosing && !said && shown === null && st?.step === 4 && st.screen === "council";
  // 智囊团开不起来或连着查不到：给「再试一次」，kick 加一就再 POST 一次
  const [councilErr, setCouncilErr] = useState<string | null>(null);
  const [kick, setKick] = useState(0);
  // 每次进智囊团这一屏都先 POST 一次：后端重启过时 GET 会一直是 running，只有 POST 能重跑；进行中或看完了的不会重开
  useEffect(() => {
    if (!onCouncil) return;
    let cancelled = false;
    startCouncil().then((res) => {
      if (cancelled) return;
      setSt(res);
      if (!res.council) setCouncilErr("顾问们没开始看，再试一次。"); // POST 完了还是 null：不算在看，不能一直转圈
    }, (e) => { if (!cancelled) setCouncilErr(say(e)); });
    return () => { cancelled = true; };
  }, [onCouncil, kick]);
  const running = st?.council?.status === "running";
  useEffect(() => {
    if (!running || councilErr) return;
    let cancelled = false;
    let misses = 0;
    const t = setInterval(() => {
      getDeepTalk().then((res) => { if (!cancelled) { misses = 0; setSt(res); } }, () => {
        if (cancelled || ++misses < 3) return;
        clearInterval(t);
        setCouncilErr(OFFLINE);
      });
    }, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [running, councilErr]);
  // 原型习惯「为了」哪条目标：和后端一样取第 4 次确认过的第一条目标；确认过的不在 proposals 里，从档案拿
  const protoPending = !!st?.proposals.habits.some((h) => h.source === "deep_talk" && h.status === "pending");
  const goalIds = (st?.answers[4]?.profile_ids ?? []).join(",");
  const [goal, setGoal] = useState<string | null>(null);
  useEffect(() => {
    if (!protoPending) return;
    const ids = goalIds.split(",").map(Number);
    getProfile().then((p) => setGoal(p.confirmed.find((x) => x.level === "目标" && ids.includes(x.id))?.content ?? null), () => {});
  }, [protoPending, goalIds]);
  const busyRef = useRef(false); // 同一帧里连点两下，busy 状态还没生效，靠它挡住第二下

  /** 发一个请求：危机就停在危机卡片；409（不是这一屏）重新取状态；其余错误原样说给他。 */
  async function call(req: () => Promise<DeepTalkState | Crisis>, then?: (s: DeepTalkState) => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await req();
      if (isCrisis(res)) return setCrisis(res.message);
      setSt(res);
      then?.(res);
    } catch (e) {
      setMessage(say(e));
      if (e instanceof ApiError && e.status === 409) { // 服务器那边已经往前走了：本地停着的回应和小结也作废
        setSaid(null);
        setSummary(null);
        getDeepTalk().then(setSt, () => {});
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function answer(step: number, screen: string, value: unknown) {
    call(() => answerDeepTalk(step, screen, value), (res) => {
      haptic.select();
      setRechoose(false);
      if (res.reply) setSaid({ step, screen, reply: res.reply });
      if (res.tomorrow_change) setTomorrow(res.tomorrow_change);
      if (res.step !== step) { setSummary(step); markLand(res, step); }
    });
  }

  // 这一场他点了「对」/「加进计划」的内容，第 4 次小结里原样列出
  const [kept, setKept] = useState<{ step: number; text: string }[]>([]);
  const [landN, setLandN] = useState<Record<number, number>>({}); // 每一步开始落地时待确认的卡片数
  const [tomorrowPlans, setTomorrow] = useState<DeepTalkState["tomorrow_change"]>(); // 第 3 次标完累不累：明天改前改后
  const markLand = (s: DeepTalkState, step: number) => setLandN((m) => (step in m ? m : { ...m, [step]: pendingCount(s, step) }));
  const decide = (what: TalkConfirm, accept: boolean, content?: string) => call(() => confirmDeepTalk(what, accept, content), () => {
    const text = content ?? (what.kind === "habit" ? st?.proposals.habits.find((h) => h.key === what.key)?.title : undefined);
    if (st) markLand(st, shown ?? 4);
    if (accept && text) setKept((k) => [...k, { step: shown ?? 4, text }]);
    setSummary(shown); // 回来补确认的：最后一张答完停在这一步的「聊完了」，不直接跳进下一步的问题
  });

  const shell = (children: React.ReactNode, bottomBar?: React.ReactNode) => (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space.sm }}>
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
      <View style={{ flex: 1 }}><Bar value={progress} color={c.primaryEdge} height={6} duration={300} /></View>
    </View>
  );

  const page = (key: string, progress: number, body: React.ReactNode, bottom?: React.ReactNode, center?: boolean) => shell(
    <>
      {top(progress)}
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.lg }} keyboardShouldPersistTaps="handled">
        <Animated.View key={key} entering={ahead("right")} style={{ flexGrow: 1, gap: space.lg, justifyContent: center ? "center" : undefined }}>
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

  const eyebrow = (step: number, extra?: string) => (
    <Text style={[type.eyebrow, { color: c.muted, marginBottom: -space.sm }]}>{`第 ${step} 次 · ${st.screens[step].name}${extra ?? ""}`}</Text>
  );

  // —— 小结：这一步待确认的提议，一张一张来；第 4 次是「落地」和「投资自己」 ——
  if (!choosing && !said && shown !== null) { // 最后一屏是开放问题时，先看完导师的一句
    const step = shown;
    const a = st.answers[step] ?? {};
    const ids = a.profile_ids ?? [];
    const p = st.proposals.profiles.find((x) => ids.includes(x.id));
    const later = step === 4 && !p;
    const proto = later ? st.proposals.habits.find((h) => h.source === "deep_talk" && h.status === "pending") : undefined;
    const tomorrow = later && !proto && st.can_set_tomorrow ? st.proposals.tomorrow : null;
    const invest = later && !proto && !tomorrow ? st.proposals.habits.filter((h) => h.source === "invest" && h.status === "pending") : [];
    const open = !!(p || proto || tomorrow || invest.length);
    // 落地进度：开始时待确认几张，现在还剩几张
    const left = pendingCount(st, step);
    const n = Math.max(landN[step] ?? left, left);
    const progress = open ? ` · ${n - left + 1} / ${n}` : "";
    let title: string;
    let body: React.ReactNode;
    let head: React.ReactNode = null;
    if (p) {
      title = "我听到的，你看看对不对";
      // 他自己的原话：第 4 次是选中的那个版本，第 1–3 次是这一步第一个开放题的回答
      const firstOpen = st.screens[step].screens.find((x) => x.kind === "open");
      const from = step === 4
        ? (typeof a.choose === "number" ? a[st.screens[4].screens[a.choose]?.id ?? ""] : undefined)
        : firstOpen && a[firstOpen.id];
      body = <ProfileCard p={p} label={step === 3 ? "能量公式" : LEVEL_NAME[p.level] ?? p.level} from={typeof from === "string" ? from : undefined}
        edits={edits} setEdits={setEdits} busy={busy} decide={decide} />;
    } else if (proto) {
      title = "先试一个月的小习惯";
      body = <HabitCard h={proto} label="先试一个月" goal={goal} yes="加进计划" edits={edits} setEdits={setEdits} busy={busy} decide={decide} />;
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
      // 他今晚说的原话：开放、追问、版本这几屏的字，按屏的顺序，最多两句
      const quotes = st.screens[step].screens.flatMap((x) => {
        const v = a[x.id];
        if (!["open", "follow", "version"].includes(x.kind)) return [];
        return (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v) : []).filter((t): t is string => typeof t === "string" && !!t.trim());
      }).slice(0, 2);
      const sc = step === 1 ? st.screens[1].screens.find((x) => x.kind === "scores") : undefined;
      const sv = sc && a[sc.id] && typeof a[sc.id] === "object" ? Object.entries(a[sc.id] as Record<string, number>) : [];
      const mine = step === 4 ? kept.filter((k) => k.step === 4) : [];
      // 四步的进度：聊过的实心、没聊的描边，和对账完成页那排点同一种语言；是进度，不是奖励
      head = (
        <View style={{ flexDirection: "row", gap: space.lg }}>
          {st.steps.map((x) => (
            <View key={x.step} accessible accessibilityLabel={`${x.name}，${x.status === "done" ? "聊过了" : "还没聊"}`}
              style={{ alignItems: "center", gap: space.xs }}>
              <Glyph name={x.name} color={c.kind.proj} size={28} fill={x.status === "done" ? "full" : "empty"} />
              <Text style={[type.small, { color: c.muted }]}>{x.name}</Text>
            </View>
          ))}
        </View>
      );
      body = (
        <>
          {(quotes.length > 0 || sv.length > 0) && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.eyebrow, { color: c.muted }]}>你今晚说的</Text>
              {quotes.map((t, i) => <Body key={i}>{`「${t}」`}</Body>)}
              {sv.length > 0 && <Body muted>{sv.map(([k, v]) => `${k} ${v}`).join(" · ")}</Body>}
            </View>
          )}
          {mine.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Text style={[type.eyebrow, { color: c.muted }]}>你定下的</Text>
              {mine.map((k, i) => <Body key={i}>{`「${k.text}」`}</Body>)}
            </View>
          )}
          {step < 4 && <Body muted>下次对完账，我们接着聊第 {step + 1} 次。</Body>}
          {step === 4 && st.habits_full && <Body muted>习惯已经满 3 个了。想加新的，先在设置里换掉一个。</Body>}
          {step === 4 && a.choose === null && <Body muted>想好了，可以从「我」页回来选一个版本。</Body>}
          {step === 4 && st.letter_ask && <LetterCard onState={setSt} onCrisis={setCrisis} />}
        </>
      );
    }
    return page(`sum-${step}-${title}-${p?.id}`, 1, (
      <>
        {head}
        {eyebrow(step, progress)}
        <Display>{title}</Display>
        {step === 3 && a.energy_changed === true && <Body>接下来的安排，按你刚才标的累不累来排了</Body>}
        {step === 3 && tomorrowPlans && (
          <Changes changes={planDiff(tomorrowPlans.before, tomorrowPlans.after, "04:00", "明天不排了")} when="明天" max={3} />
        )}
        {body}
      </>
    ), !open && <Button label="好" variant="secondary" onPress={leave} />, true);
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
        {items.map((item, i) => {
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
              {v === "skip" ? (
                <View style={{ minHeight: 44, justifyContent: "center" }}><Small muted>这一项先不打</Small></View>
              ) : (
                <Dots label={item} from={0} to={10} value={v} ends={i === 0} onChange={(n) => setScores({ ...scores, [item]: n })} />
              )}
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
        {said ? (
          // 答完了：他的原话照抄，下面左边一道主色竖线是导师的一句
          <View style={{ gap: space.xl }}>
            <View style={{ gap: space.xs }}>
              <Text style={[type.eyebrow, { color: c.muted }]}>你说的</Text>
              <Body>{`「${text[s.id]?.trim() ?? ""}」`}</Body>
            </View>
            <Animated.View entering={FadeIn.duration(motion.slow)}
              style={{ borderLeftWidth: 2, borderLeftColor: c.primaryEdge, paddingLeft: space.md, gap: space.xs }}>
              <Text style={[type.eyebrow, { color: c.muted }]}>导师</Text>
              <Body>{said.reply}</Body>
            </Animated.View>
          </View>
        ) : (
          <Field placeholder="几句话就行" value={text[s.id] ?? ""} multiline accessibilityLabel={s.question}
            onChangeText={(v) => setText({ ...text, [s.id]: v })} />
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
        <Body muted>可以不标。标了，接下来的安排按这个排。</Body>
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
  } else if (s.kind === "line") {
    body = (
      <>
        {eyebrow(step)}
        <Title>{s.question}</Title>
        <Field placeholder={s.hint} value={text[s.id] ?? ""} multiline accessibilityLabel={s.question}
          onChangeText={(v) => setText({ ...text, [s.id]: v })} />
      </>
    );
    bottom = (
      <>
        <Button label="下一步" disabled={!text[s.id]?.trim()} busyLabel={busy ? "正在存……" : undefined}
          onPress={() => answer(step, s.id, text[s.id].trim())} />
        <Button label="跳过" variant="quiet" disabled={busy} onPress={() => answer(step, s.id, "")} />
      </>
    );
  } else if (s.kind === "council") {
    const status = councilErr ? "error" : st.council?.status ?? "running"; // 还没 POST 完时是 null，先当在看
    body = (
      <>
        {eyebrow(step)}
        {status === "error" ? (
          <>
            <Display>几位顾问在看你写的三个版本</Display>
            <Notice tone="error">{councilErr}</Notice>
          </>
        ) : status === "running" ? (
          <>
            <Display>几位顾问在看你写的三个版本</Display>
            <Body muted>大概一两分钟。也可以先关掉，下次打开接着看。</Body>
            {[0, 1].map((i) => <Skeleton key={i} height={140} r={radius.lg} />)}
          </>
        ) : status === "crisis" ? (
          <CrisisCard message={st.council?.message ?? ""} />
        ) : status === "failed" || !st.council?.result ? (
          <Display>这次顾问们没能看完，你可以先自己打分</Display>
        ) : (
          <>
            <Display>顾问们看完了</Display>
            <CouncilView result={st.council.result} titles={titles} versions={versions} />
          </>
        )}
      </>
    );
    // 第 4 次可以分两晚：写完三个版本、看完点评就可以先关掉
    bottom = (
      <>
        {status === "error" && <Button label="再试一次" icon="refresh" onPress={() => { setCouncilErr(null); setKick(kick + 1); }} />}
        {(status === "done" || status === "failed") && <Button label="接着打分" busyLabel={busy ? "正在存……" : undefined} onPress={() => answer(step, s.id, true)} />}
        {/* 看完了：左上角有关闭、内容也都存了，这个不用抢眼 */}
        <Button label="今晚先到这" variant={status === "done" ? "quiet" : "secondary"} onPress={leave} />
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
                <View style={{ width: 132 }}>
                  <Text style={[type.label, { color: c.text }]}>{item}</Text>
                  <Text style={[type.small, { color: c.muted }]}>{RATE_HINT[item]}</Text>
                </View>
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
    const missing = VERSION.reduce((n, _, j) => n + items.filter((i) => rates[j]?.[i] === undefined).length, 0);
    bottom = (
      <>
        {missing > 0 && <Small muted center>{`还差 ${missing} 项`}</Small>}
        <Button label="打好了" disabled={missing > 0} busyLabel={busy ? "正在存……" : undefined}
          onPress={() => answer(step, s.id, { 0: rates[0], 1: rates[1], 2: rates[2] })} />
      </>
    );
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
                backgroundColor: pick === j ? c.soft : c.surface, borderColor: pick === j ? c.primaryEdge : "transparent",
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

/** 一条待确认的档案提议：可以改字，「对」才记进档案，「不要」就不再显示。 */
function ProfileCard({ p, label, from, edits, setEdits, busy, decide }: {
  p: Profile; label: string; from?: string; edits: Record<string, string>; setEdits: (e: Record<string, string>) => void; busy: boolean;
  decide: (what: TalkConfirm, accept: boolean, content?: string) => void;
}) {
  const c = useColors();
  const k = `p:${p.id}`;
  const v = edits[k] ?? p.content;
  return (
    <Card>
      <Text style={[type.eyebrow, { color: c.muted }]}>{label}</Text>
      {/* 他自己的原话照抄，好对得上下面导师的说法 */}
      {!!from?.trim() && <Small muted>{`你写的：「${from.trim()}」`}</Small>}
      <Small muted>这是我的说法，不对就直接改</Small>
      <Field value={v} multiline accessibilityLabel={label} onChangeText={(t) => setEdits({ ...edits, [k]: t })} />
      <Pair yes="对" no="不要" yesOff={!v.trim()} busy={busy}
        onYes={() => decide({ kind: "profile", id: p.id }, true, v.trim())} onNo={() => decide({ kind: "profile", id: p.id }, false)} />
    </Card>
  );
}

/** 一条习惯提议：原型（名字可以改）或「投资自己」（写为什么、适合在什么时候）。 */
function HabitCard({ h, label, goal, yes, edits, setEdits, busy, decide }: {
  h: HabitProposal; label?: string; goal?: string | null; yes: string; edits: Record<string, string>; setEdits: (e: Record<string, string>) => void;
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
      {goal && <Small muted>{`为了：${goal}`}</Small>}
      {h.why && <Body>{h.why}</Body>}
      {h.when && <Small muted>{`适合在${h.when}`}</Small>}
      <Pair yes={yes} no="先不要" yesOff={!v.trim()} busy={busy}
        onYes={() => decide({ kind: "habit", key: h.key }, true, proto ? v.trim() : undefined)}
        onNo={() => decide({ kind: "habit", key: h.key }, false)} />
    </Card>
  );
}

/** 第 4 次小结里的回信卡：要不要给 30 天后的自己留几句话。封好以后留在原地显示日期（后端那边已经不再问了）。 */
function LetterCard({ onState, onCrisis }: { onState: (s: DeepTalkState) => void; onCrisis: (m: string) => void }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [days, setDays] = useState<30 | 90>(30);
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(req: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try { await req(); } catch (e) { setMessage(say(e)); } finally { setBusy(false); }
  }
  const seal = () => run(async () => {
    const res = await postLetter(days, text.trim());
    if (isCrisis(res)) return onCrisis(res.message);
    setDue(res.letters.reduce((a, b) => (b.id > a.id ? b : a)).due);
  });
  const decline = () => run(async () => onState(await declineLetter()));

  if (due) return <Card><Body>{`到 ${dayText(due)} 再打开`}</Body></Card>;
  return (
    <Card>
      <Title>{`要不要给 ${days} 天后的自己留几句话？`}</Title>
      {writing ? (
        <>
          <Field value={text} multiline accessibilityLabel="给自己的信" onChangeText={setText} />
          <Row>
            <Chip label="30 天" on={days === 30} onPress={() => setDays(30)} />
            <Chip label="90 天" on={days === 90} onPress={() => setDays(90)} />
          </Row>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label="封好" disabled={busy || !text.trim()} onPress={seal} /></View>
            <View style={{ flex: 1 }}><Button label="不用了" variant="neutral" disabled={busy} onPress={decline} /></View>
          </View>
        </>
      ) : (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}><Button label="要" disabled={busy} onPress={() => setWriting(true)} /></View>
          <View style={{ flex: 1 }}><Button label="不用了" variant="neutral" disabled={busy} onPress={decline} /></View>
        </View>
      )}
      {message && <Notice tone="error">{message}</Notice>}
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
