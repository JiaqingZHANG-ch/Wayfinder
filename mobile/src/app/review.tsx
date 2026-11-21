import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Adjustment, answerAdjustment, confirmProfile, getReview, getWeek, isCrisis, Review, Week } from "@/api";
import { ahead, Bar, haptic, Skeleton } from "@/components/motion";
import { Body, Button, Card, CrisisCard, Display, ErrorState, Field, IconButton, Notice, Small, Stat, Title } from "@/components/ui";
import { radius, space, useColors } from "@/theme";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

/** 调整写成人话：数字是后端给的，这里只拼字。 */
function describe(a: Adjustment): string {
  if (a.kind === "add_habit") return `加一个新习惯「${a.title}」，每次 ${a.value} 分钟`;
  return `「${a.title}」的${a.kind === "minutes" ? "标准版" : "保底版"}改成 ${a.value} 分钟`;
}

type Step = { t: "stats" } | { t: "adj"; i: number } | { t: "last" } | { t: "next" };

/**
 * 每周复盘：全屏，一屏一问，外壳和晚间对账一样。① 这一周的数 ② 每条调整一屏 ③ 上周带进来的问题（有才显示）
 * ④ 带进下周的问题 + 「复盘好了」。数字由后端程序算好，这里只显示；调整点「好」才写进设置。
 */
export default function ReviewScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [review, setReview] = useState<Review | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [stillRight, setStillRight] = useState<"asking" | "editing" | "done">("asking");
  const [edited, setEdited] = useState("");
  const [busy, setBusy] = useState(false); // 一次只答一条：连点也只发一个请求
  const [idx, setIdx] = useState(0);
  const [back, setBack] = useState(false); // 刚才是往回翻：新的一屏从左边进来

  function load() {
    getWeek().then(setWeek, () => {}); // 瓷砖拿不到就只显示后端写的那段话
    getReview().then(
      (r) => (isCrisis(r) ? setCrisis(r.message) : setReview(r)),
      () => setFailed(true),
    );
  }
  useEffect(load, []);

  const steps: Step[] = [{ t: "stats" }];
  review?.adjustments.forEach((_, i) => steps.push({ t: "adj", i }));
  if (review && (review.last_question || review.still_right)) steps.push({ t: "last" });
  steps.push({ t: "next" });
  const step = steps[Math.min(idx, steps.length - 1)];
  const go = (i: number) => { setMessage(null); setBack(i < idx); setIdx(i); };

  async function answer(index: number, accept: boolean) {
    if (!review || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      haptic.select();
      setReview(await answerAdjustment(review.id, index, accept));
      go(idx + 1);
    } catch {
      setMessage("没记上，再点一次。");
    } finally {
      setBusy(false);
    }
  }

  async function reconfirm(content?: string) {
    if (!review?.still_right || busy) return;
    setBusy(true);
    try {
      const res = await confirmProfile(review.still_right.id, content);
      if (isCrisis(res)) setCrisis(res.message);
      else setStillRight("done");
    } catch {
      setMessage("没记上，再点一次。");
    } finally {
      setBusy(false);
    }
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

  const closeRow = (
    <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, alignItems: "flex-start" }}>
      <IconButton name="close" label="关闭" onPress={leave} />
    </View>
  );

  if (crisis) {
    return shell(
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}><CrisisCard message={crisis} /></ScrollView>,
      review ? <Button label="继续" variant="secondary" onPress={() => setCrisis(null)} /> : <Button label="关闭" variant="secondary" onPress={leave} />,
    );
  }
  if (failed) return shell(<>{closeRow}<ErrorState onRetry={() => { setFailed(false); load(); }} /></>);
  if (!review) {
    return shell(
      <>
        {closeRow}
        <View style={{ padding: space.lg, gap: space.lg }}>
          <Skeleton height={36} width="60%" />
          <Skeleton height={104} r={radius.lg} />
          <Skeleton height={104} r={radius.lg} />
        </View>
      </>,
    );
  }

  let body: React.ReactNode;
  let bottom: React.ReactNode;
  if (step.t === "stats") {
    body = (
      <>
        <Display>这一周</Display>
        {week && (
          <View style={{ gap: space.md }}>
            <Stat size="big" label="记了几晚" value={week.logged_days} unit="/ 7 晚" />
            {week.habits.length > 0 && (
              <>
                <Small muted>做了几天（含保底）</Small>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
                  {week.habits.map((h) => (
                    <Stat key={h.id} label={h.title} value={h.done_days} unit="天" style={{ flexBasis: "40%" }} />
                  ))}
                </View>
              </>
            )}
          </View>
        )}
        {!week && <Body muted>{review.summary}</Body>}
      </>
    );
    bottom = <Button label="下一步" onPress={() => go(idx + 1)} />;
  } else if (step.t === "adj") {
    const a = review.adjustments[step.i];
    body = (
      <>
        <Small muted>第 {step.i + 1} / {review.adjustments.length} 条调整</Small>
        <Display>{describe(a)}</Display>
        <Body muted>{a.why}</Body>
        {a.answer && <Notice>{a.answer === "好" ? "已改，从今天的计划开始。" : "先不改。"}</Notice>}
        {message && <Notice tone="error">{message}</Notice>}
      </>
    );
    bottom = a.answer ? <Button label="下一步" onPress={() => go(idx + 1)} /> : (
      <>
        <Button label="好" disabled={busy} onPress={() => answer(step.i, true)} />
        <Button label="先不改" variant="neutral" disabled={busy} onPress={() => answer(step.i, false)} />
      </>
    );
  } else if (step.t === "last") {
    const sr = review.still_right && stillRight !== "done" ? review.still_right : null;
    body = (
      <>
        {review.last_question && (
          <>
            <Small muted>上周带进来的问题</Small>
            <Display>{review.last_question}</Display>
            <Body muted>回头看一眼就好，不用回答。</Body>
          </>
        )}
        {sr && (
          <Card style={{ gap: space.md }}>
            <Title>{sr.question}</Title>
            {stillRight === "editing" && <Field value={edited} onChangeText={setEdited} multiline accessibilityLabel="改成" />}
            {stillRight === "asking" ? (
              <View style={{ gap: space.sm }}>
                <Button label="还对" variant="secondary" onPress={() => reconfirm()} />
                <Button label="要改" variant="quiet" onPress={() => { setEdited(sr.content); setStillRight("editing"); }} />
              </View>
            ) : (
              <Button label="改好了" variant="secondary" onPress={() => reconfirm(edited)} />
            )}
          </Card>
        )}
        {message && <Notice tone="error">{message}</Notice>}
      </>
    );
    bottom = <Button label="下一步" onPress={() => go(idx + 1)} />;
  } else {
    body = (
      <>
        <Small muted>带进下周的问题</Small>
        <Display>{review.question}</Display>
        <Body muted>想一想就好，不用现在回答。</Body>
      </>
    );
    bottom = <Button label="复盘好了" icon="checkmark" onPress={() => { haptic.success(); leave(); }} />;
  }

  return shell(
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
        {idx > 0
          ? <IconButton name="chevron-back" label="上一步" onPress={() => go(idx - 1)} />
          : <IconButton name="close" label="关闭" onPress={leave} />}
        {/* 只有两屏时，一上来就是一半的进度条没意思，不画 */}
        <View style={{ flex: 1 }}>{steps.length > 2 && <Bar value={(idx + 1) / steps.length} color={c.primary} height={6} duration={300} />}</View>
        {idx > 0 && <IconButton name="close" label="关闭" onPress={leave} />}
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Animated.View key={`${idx}-${step.t}`} entering={ahead(back ? "left" : "right")}
          exiting={Platform.OS === "web" ? undefined : FadeOut.duration(120)} style={{ gap: space.lg }}>
          {body}
        </Animated.View>
      </ScrollView>
    </>,
    bottom,
  );
}
