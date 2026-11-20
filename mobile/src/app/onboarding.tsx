import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { confirmProfile, Energy, getMe, isCrisis, Me, postOnboarding, Profile, putSettings } from "@/api";
import { EnergyPick } from "@/components/chips";
import { Consent } from "@/components/consent";

type Step = "consent" | "chat" | "confirm" | "form";

/** 轻量建档：先看隐私说明并同意 → 聊方向（一次一问）→ 确认导师写的那句方向（可以改）→ 填作息和第一个习惯。 */
export default function Onboarding() {
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
      <View style={styles.page}>
        <Text style={styles.crisis}>{crisis}</Text>
        <Button label="继续" onPress={() => setCrisis(null)} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {reply && <Text style={styles.reply}>{reply}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {step === "consent" && me && <Consent me={me} onDone={startChat} />}

      {step === "chat" && question && (
        <>
          <Text style={styles.question}>{question}</Text>
          <TextInput style={styles.input} value={answer} onChangeText={setAnswer} multiline
            placeholder="想到什么写什么，一两句就够" />
          <Button label={busy ? "……" : "说完了"} onPress={sendAnswer} disabled={busy} />
        </>
      )}

      {step === "confirm" && proposals.map((p) => (
        <View key={p.id} style={styles.card}>
          <Text style={styles.label}>我听到的{p.level}（不对就直接改）：</Text>
          <TextInput style={styles.input} value={p.content} multiline
            onChangeText={(content) => setProposals(proposals.map((x) => x.id === p.id ? { ...x, content } : x))} />
          <Button label="对，记下" onPress={() => confirm(p)} />
        </View>
      ))}

      {step === "form" && <SettingsForm onError={setError} onCrisis={setCrisis} />}
    </ScrollView>
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
    <View style={styles.card}>
      <Text style={styles.question}>最后几样，排计划要用：</Text>
      <Field control={control} name="wake" label="几点起床" rules={time} error={errors.wake?.message} />
      <Field control={control} name="sleep" label="几点上床" rules={time} error={errors.sleep?.message} />
      <Field control={control} name="title" label="先养一个习惯，叫什么" rules={{ required: "要填" }}
        error={errors.title?.message} />
      <Field control={control} name="minutes" label="精神好的时候做几分钟" rules={minutes} error={errors.minutes?.message} />
      <Field control={control} name="floor_min" label="没电的时候至少做几分钟（保底版）" rules={minutes}
        error={errors.floor_min?.message} />
      <View style={styles.field}>
        <Text style={styles.label}>做这件事对你来说是（可不选）</Text>
        <Controller control={control} name="energy"
          render={({ field }) => <EnergyPick value={field.value} onChange={field.onChange} />} />
      </View>
      <Button label={isSubmitting ? "……" : "排第一张计划"} onPress={handleSubmit(onSubmit)} disabled={isSubmitting} />
    </View>
  );
}

function Field({ control, name, label, rules, error }: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  name: Exclude<keyof FormValues, "energy">;
  label: string;
  rules: object;
  error?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Controller control={control} name={name} rules={rules}
        render={({ field }) => (
          <TextInput style={styles.input} value={field.value ?? ""} onChangeText={field.onChange} onBlur={field.onBlur} />
        )} />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={[styles.button, disabled && { opacity: 0.5 }]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 560, width: "100%", alignSelf: "center" },
  reply: { color: "#5f6368" },
  question: { fontSize: 18, fontWeight: "500" },
  card: { gap: 10 },
  field: { gap: 4 },
  label: { color: "#3c4043" },
  input: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, padding: 10 },
  error: { color: "#b3261e" },
  crisis: { padding: 16, lineHeight: 22 },
  button: { backgroundColor: "#1a73e8", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16 },
});
