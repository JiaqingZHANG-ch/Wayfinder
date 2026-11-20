import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Text, View } from "react-native";

import { confirmProfile, Energy, getMe, isCrisis, Me, postOnboarding, Profile, putSettings } from "@/api";
import { EnergyPick } from "@/components/chips";
import { Consent } from "@/components/consent";
import { Body, Button, Card, CrisisCard, Field, Notice, Row, Screen, Small, Title } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

type Step = "consent" | "chat" | "confirm" | "form";

/** 轻量建档：先看隐私说明并同意 → 聊方向（一次一问）→ 确认导师写的那句方向（可以改）→ 填作息和第一个习惯。 */
export default function Onboarding() {
  const c = useColors();
  const [step, setStep] = useState<Step>("chat");
  const [question, setQuestion] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [proposals, setProposals] = useState<Profile[]>([]);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function afterChat(pending: Profile[] = []) {
    setProposals(pending);
    setStep(pending.length ? "confirm" : "form");
  }

  const [me, setMe] = useState<Me | null>(null);

  function startChat() {
    setStep("chat");
    postOnboarding().then((t) => {
      if (isCrisis(t)) return setCrisis(t.message);
      if (t.done) afterChat(t.proposals);
      else setQuestion(t.question);
    }, (e: Error) => setError(e.message));
  }

  useEffect(() => {
    getMe().then((m) => {
      if (m.consented) startChat();
      else {
        setMe(m);
        setStep("consent");
      }
    }, (e: Error) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 只在打开页面时问一次

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
      else setQuestion(t.question);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(p: Profile) {
    try {
      const res = await confirmProfile(p.id, p.content);
      if (isCrisis(res)) return setCrisis(res.message);
      afterChat(res.pending);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (crisis) {
    return (
      <Screen>
        <CrisisCard message={crisis} />
        <Button label="继续" variant="secondary" onPress={() => setCrisis(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      {reply && (
        <View style={{ alignSelf: "flex-start", maxWidth: "90%", backgroundColor: c.soft, borderRadius: radius.lg,
          borderTopLeftRadius: radius.sm, padding: space.lg }}>
          <Text style={[type.body, { color: c.onSoft }]}>{reply}</Text>
        </View>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {step === "consent" && me && <Consent me={me} onDone={startChat} />}

      {step === "chat" && !question && !error && <Body muted>……</Body>}
      {step === "chat" && question && (
        <>
          <Title>{question}</Title>
          <Field value={answer} onChangeText={setAnswer} multiline placeholder="想到什么写什么，一两句就够" />
          <Button label="说完了" busyLabel={busy ? "正在听……" : undefined} disabled={!answer.trim()} onPress={sendAnswer} />
        </>
      )}

      {step === "confirm" && proposals.map((p) => (
        <Card key={p.id}>
          <Small muted>我听到的{p.level}（不对就直接改）</Small>
          <Field value={p.content} multiline accessibilityLabel={`我听到的${p.level}`}
            onChangeText={(content) => setProposals(proposals.map((x) => x.id === p.id ? { ...x, content } : x))} />
          <Button label="对，记下" onPress={() => confirm(p)} />
        </Card>
      ))}

      {step === "form" && <SettingsForm onError={setError} onCrisis={setCrisis} />}
    </Screen>
  );
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
