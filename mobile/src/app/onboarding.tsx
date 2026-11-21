import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { confirmProfile, Energy, getMe, isCrisis, Me, postOnboarding, Profile, putSettings } from "@/api";
import { EnergyPick } from "@/components/chips";
import { Consent } from "@/components/consent";
import { Bar, Skeleton } from "@/components/motion";
import { Body, Button, Card, CrisisCard, Display, ErrorState, Field, Icon, Notice, Row, Small, Title } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

type Step = "welcome" | "consent" | "chat" | "confirm" | "form";

/** 轻量建档：欢迎 → 看隐私说明并同意 → 聊方向（一次一问）→ 确认导师写的那句方向（可以改）→ 填作息和第一个习惯。外壳和晚间对账一样：全屏、顶部进度条。 */
export default function Onboarding() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("welcome");
  const [question, setQuestion] = useState<string | null>(null);
  const [asked, setAsked] = useState(0); // 已经问到第几个问题，进度条用
  const [reply, setReply] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [proposals, setProposals] = useState<Profile[]>([]);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  function afterChat(pending: Profile[] = []) {
    setProposals(pending);
    setStep(pending.length ? "confirm" : "form");
  }

  function ask(q: string | null) {
    setQuestion(q);
    setAsked((n) => n + 1);
  }

  function startChat() {
    setStep("chat");
    postOnboarding().then((t) => {
      if (isCrisis(t)) return setCrisis(t.message);
      if (t.done) afterChat(t.proposals);
      else ask(t.question);
    }, () => setFailed(true));
  }

  function loadMe() {
    getMe().then(setMe, () => setFailed(true));
  }
  useEffect(loadMe, []);

  /** 欢迎页的「开始」：同意过就直接聊，没有就先过隐私这一关。 */
  const start = () => (me?.consented ? startChat() : setStep("consent"));

  async function sendAnswer() {
    if (!answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const t = await postOnboarding(answer);
      if (isCrisis(t)) return setCrisis(t.message);
      setReply(t.reply);
      setAnswer("");
      if (t.done) afterChat(t.proposals);
      else ask(t.question);
    } catch {
      setError("没连上，网络好了再点一次「说完了」。");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(p: Profile) {
    try {
      const res = await confirmProfile(p.id, p.content);
      if (isCrisis(res)) return setCrisis(res.message);
      afterChat(res.pending);
    } catch {
      setError("没连上，网络好了再点一次。");
    }
  }

  const shell = (children: React.ReactNode, bottomBar?: React.ReactNode, progress?: number) => (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space.sm }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 560, alignSelf: "center" }}>
        {progress !== undefined && (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.xs }}>
            <Bar value={progress} color={c.primary} height={6} />
            {step === "chat" && <Small muted>大概 3–4 个问题</Small>}
          </View>
        )}
        {children}
        {bottomBar && <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>{bottomBar}</View>}
      </View>
    </KeyboardAvoidingView>
  );
  const scroll = (children: React.ReactNode) => (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  );
  const chatProgress = 0.2 + 0.15 * Math.min(asked, 4);

  if (crisis) {
    return shell(scroll(<CrisisCard message={crisis} />), <Button label="继续" variant="secondary" onPress={() => setCrisis(null)} />);
  }

  if (failed) {
    return shell(<ErrorState onRetry={() => { setFailed(false); if (step === "chat") startChat(); else loadMe(); }} />);
  }

  if (step === "welcome") {
    return shell(
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md }}>
        <Icon name="compass-outline" size={48} color={c.primary} />
        <Text style={{ fontFamily: type.big.fontFamily, fontSize: 28, lineHeight: 36, fontWeight: "300", color: c.text }}>Wayfinder</Text>
        <Body muted center>每天帮你排一张做得完的计划。累了就说，它只改今晚。</Body>
      </View>,
      <Button label="开始" busyLabel={me ? undefined : "……"} onPress={start} />,
    );
  }

  if (step === "consent") {
    return shell(me && scroll(<Consent me={me} onDone={startChat} />), undefined, 0.1);
  }

  if (step === "chat") {
    if (!question) {
      return shell(
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={28} width="80%" />
          <Skeleton height={28} width="60%" />
          <Skeleton height={96} />
        </View>, undefined, chatProgress);
    }
    return shell(
      scroll(
        <>
          {reply && (
            <View style={{ alignSelf: "flex-start", maxWidth: "90%", backgroundColor: c.soft, borderRadius: radius.lg,
              borderTopLeftRadius: radius.sm, padding: space.lg }}>
              <Text style={[type.body, { color: c.onSoft }]}>{reply}</Text>
            </View>
          )}
          <Display>{question}</Display>
          <Field value={answer} onChangeText={setAnswer} multiline placeholder="想到什么写什么，一两句就够" />
          {error && <Notice tone="error">{error}</Notice>}
        </>,
      ),
      <Button label="说完了" busyLabel={busy ? "正在听……" : undefined} disabled={!answer.trim()} onPress={sendAnswer} />,
      chatProgress,
    );
  }

  if (step === "confirm") {
    return shell(
      scroll(
        <>
          {reply && <Body muted>{reply}</Body>}
          {proposals.map((p) => (
            <Card key={p.id}>
              <Small muted>我听到的{p.level}（不对就直接改）</Small>
              <Field value={p.content} multiline accessibilityLabel={`我听到的${p.level}`}
                onChangeText={(content) => setProposals(proposals.map((x) => x.id === p.id ? { ...x, content } : x))} />
              <Button label="对，记下" onPress={() => confirm(p)} />
            </Card>
          ))}
          {error && <Notice tone="error">{error}</Notice>}
        </>,
      ), undefined, 0.8);
  }

  return shell(
    scroll(
      <>
        <SettingsForm onError={setError} onCrisis={setCrisis} />
        {error && <Notice tone="error">{error}</Notice>}
      </>,
    ), undefined, 0.9);
}

type FormValues = { wake: string; sleep: string; title: string; minutes: string; floor_min: string; energy: Energy | null };

function SettingsForm({ onError, onCrisis }: { onError: (m: string) => void; onCrisis: (m: string) => void }) {
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    defaultValues: { wake: "07:30", sleep: "23:00", title: "", minutes: "30", floor_min: "10", energy: null },
  });

  async function onSubmit(v: FormValues) {
    try {
      const res = await putSettings({
        wake: v.wake, sleep: v.sleep,
        habits: [{ title: v.title, minutes: Number(v.minutes), floor_min: Number(v.floor_min), energy: v.energy }],
      });
      if (isCrisis(res)) return onCrisis(res.message);
      router.replace("/");
    } catch (e) {
      onError((e as Error).message);
    }
  }

  const time = { required: "要填", pattern: { value: /^([01]\d|2[0-3]):[0-5]\d$/, message: "写成 07:30 这样" } };
  const minutes = { required: "要填", pattern: { value: /^\d+$/, message: "写分钟数" } };

  return (
    <>
      <Title>最后几样，排计划要用</Title>
      <Card>
        <Row>
          <Item control={control} name="wake" label="几点起床" rules={time} error={errors.wake?.message} short />
          <Item control={control} name="sleep" label="几点上床" rules={time} error={errors.sleep?.message} short />
        </Row>
      </Card>
      <Card>
        <Item control={control} name="title" label="先养一个习惯，叫什么" rules={{ required: "要填" }}
          error={errors.title?.message} />
        <Row>
          <Item control={control} name="minutes" label="精神好时做几分钟" rules={minutes} error={errors.minutes?.message} short />
          <Item control={control} name="floor_min" label="没电时至少几分钟" rules={minutes} error={errors.floor_min?.message} short />
        </Row>
        <Small muted>做这件事对你来说是（可不选）</Small>
        <Controller control={control} name="energy"
          render={({ field }) => <EnergyPick value={field.value} onChange={field.onChange} />} />
      </Card>
      <Button label="排第一张计划" busyLabel={isSubmitting ? "正在排……" : undefined} onPress={handleSubmit(onSubmit)} />
    </>
  );
}

function Item({ control, name, label, rules, error, short }: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  name: Exclude<keyof FormValues, "energy">;
  label: string;
  rules: object;
  error?: string;
  short?: boolean;
}) {
  return (
    <Controller control={control} name={name} rules={rules}
      render={({ field }) => (
        <Field label={label} error={error} value={field.value ?? ""} onChangeText={field.onChange} onBlur={field.onBlur}
          style={short ? { flex: 1, minWidth: 130 } : undefined} />
      )} />
  );
}
