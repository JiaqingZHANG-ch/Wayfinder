import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { CheckinItem, checkinItems, CheckinResult, getToday, getWeek, isCrisis, postCheckin } from "@/api";
import { Body, Button, Card, Chip, CrisisCard, Field, Label, Loading, Notice, Row, Screen, Small, Title } from "@/components/ui";
import { Status, STATUS_LABELS, VS_PLAN_LABELS, VsPlan } from "@/labels";
import { space, type, useColors } from "@/theme";

type Choice = { status?: Status; vs_plan?: VsPlan };

/** 晚间对账：每件事点一下（做了／做了保底／今天没做），想说就写一句。也可以只说一句话，让模型整理。 */
export default function Checkin() {
  const c = useColors();
  const [items, setItems] = useState<CheckinItem[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState("");
  const [blocker, setBlocker] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [sentence, setSentence] = useState("");
  const [logged, setLogged] = useState<number | null>(null);
  const [done, setDone] = useState<CheckinResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string | null>(null);
  const [busy, setBusy] = useState<"buttons" | "sentence" | null>(null);

  useEffect(() => {
    getToday().then((plan) => setItems(checkinItems(plan)), (e: Error) => setMessage(e.message));
    getWeek().then((w) => setLogged(w.logged_days), () => {});
  }, []);

  const pick = (id: string, ch: Choice) => setChoices({ ...choices, [id]: { ...choices[id], ...ch } });

  async function send(body: Parameters<typeof postCheckin>[0], kind: "buttons" | "sentence") {
    setBusy(kind);
    setMessage(null);
    try {
      const res = await postCheckin(body);
      if (isCrisis(res)) setCrisis(res.message);
      else {
        setDone(res);
        getWeek().then((w) => setLogged(w.logged_days), () => {});
      }
    } catch (e) {
      setMessage((e as Error).message); // 一句话没整理出来时，后端会说「请点按钮补上」
    } finally {
      setBusy(null);
    }
  }

  function saveButtons() {
    const picked: Record<string, { status: Status; vs_plan?: VsPlan }> = {};
    for (const [id, ch] of Object.entries(choices)) {
      if (ch.status) picked[id] = { status: ch.status, vs_plan: ch.status === "skip" ? undefined : ch.vs_plan };
    }
    send({ result: { items: picked, note, blocker, tomorrow_task: tomorrow } }, "buttons");
  }

  if (crisis) return <Screen><CrisisCard message={crisis} /><Button label="继续" variant="secondary" onPress={() => setCrisis(null)} /></Screen>;
  if (!items) return message ? <Screen><Notice tone="error">{message}</Notice></Screen> : <Loading text="正在读今天的计划……" />;

  if (done) {
    return (
      <Screen>
        <Card style={{ paddingVertical: space.xxl, alignItems: "center", gap: space.lg }}>
          <Text style={[type.title, { color: c.text, textAlign: "center" }]}>{done.closing}</Text>
          {logged !== null && <Small muted>这 7 天记录了 {logged} 天</Small>}
        </Card>
        <Button label="回到今天" variant="secondary" onPress={() => router.replace("/")} />
        <Button label="再改一下" variant="quiet" onPress={() => setDone(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <Title>今天过得怎么样</Title>
        <Body muted>每件事点一下就好。{logged !== null ? `这 7 天记录了 ${logged} 天。` : ""}</Body>
      </View>

      {items.length === 0 && <Body muted>今天的计划里没有要对账的事。</Body>}
      {items.map((item) => (
        <Card key={item.id}>
          <Label>{item.title}</Label>
          <Options options={STATUS_LABELS} value={choices[item.id]?.status} onPick={(status) => pick(item.id, { status })} />
          {item.project && choices[item.id]?.status && choices[item.id]?.status !== "skip" && (
            <Options options={VS_PLAN_LABELS} value={choices[item.id]?.vs_plan} onPick={(vs_plan) => pick(item.id, { vs_plan })} />
          )}
        </Card>
      ))}

      <Field label="想说一句也可以" placeholder="不写也行" value={note} onChangeText={setNote} multiline />
      <Field label="今天卡在哪" placeholder="可不填" value={blocker} onChangeText={setBlocker} />
      <Field label="明天最想先做的一件事" placeholder="可不填，填了明天会先排它" value={tomorrow} onChangeText={setTomorrow} />
      <Button label="记好了" busyLabel={busy === "buttons" ? "正在记……" : undefined} disabled={!!busy} onPress={saveButtons} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.lg }}>
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
        <Small muted>或者一句话说完</Small>
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      </View>
      <Field placeholder="比如：英语背了，看书只看了十分钟，复习比预想花得多" value={sentence} onChangeText={setSentence}
        multiline />
      <Button label="帮我记" variant="secondary" busyLabel={busy === "sentence" ? "正在整理……" : undefined}
        disabled={!!busy || !sentence.trim()} onPress={() => send({ sentence }, "sentence")} />
      {message && <Notice tone="error">{message}</Notice>}
    </Screen>
  );
}

function Options<K extends string>({ options, value, onPick }: {
  options: Record<K, string>;
  value?: K;
  onPick: (k: K) => void;
}) {
  return (
    <Row>
      {(Object.keys(options) as K[]).map((k) => (
        <Chip key={k} label={options[k]} on={value === k} onPress={() => onPick(k)} />
      ))}
    </Row>
  );
}
