import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { CheckinItem, checkinItems, CheckinResult, getToday, getWeek, isCrisis, postCheckin } from "@/api";
import { Status, STATUS_LABELS, VS_PLAN_LABELS, VsPlan } from "@/labels";

type Choice = { status?: Status; vs_plan?: VsPlan };

/** 晚间对账：每件事点一下（做了／做了保底／今天没做），想说就写一句。也可以只说一句话，让模型整理。 */
export default function Checkin() {
  const [items, setItems] = useState<CheckinItem[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [note, setNote] = useState("");
  const [blocker, setBlocker] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [sentence, setSentence] = useState("");
  const [logged, setLogged] = useState<number | null>(null);
  const [done, setDone] = useState<CheckinResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getToday().then((plan) => setItems(checkinItems(plan)), (e: Error) => setMessage(e.message));
    getWeek().then((w) => setLogged(w.logged_days), () => {});
  }, []);

  const pick = (id: string, c: Choice) => setChoices({ ...choices, [id]: { ...choices[id], ...c } });

  async function send(body: Parameters<typeof postCheckin>[0]) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await postCheckin(body);
      if (isCrisis(res)) setMessage(res.message);
      else {
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
    for (const [id, c] of Object.entries(choices)) {
      if (c.status) picked[id] = { status: c.status, vs_plan: c.status === "skip" ? undefined : c.vs_plan };
    }
    send({ result: { items: picked, note, blocker, tomorrow_task: tomorrow } });
  }

  if (!items) return <Text style={styles.page}>{message ?? "正在读今天的计划……"}</Text>;

  if (done) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.closing}>{done.closing}</Text>
        {logged !== null && <Text style={styles.muted}>这 7 天记录了 {logged} 天。</Text>}
        <Pressable style={styles.secondary} onPress={() => setDone(null)} accessibilityRole="button">
          <Text>再改一下</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {logged !== null && <Text style={styles.muted}>这 7 天记录了 {logged} 天。</Text>}
      {items.length === 0 && <Text style={styles.muted}>今天的计划里没有要对账的事。</Text>}
      {items.map((item) => (
        <View key={item.id} style={styles.item}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Row options={STATUS_LABELS} value={choices[item.id]?.status} onPick={(status) => pick(item.id, { status })} />
          {item.project && choices[item.id]?.status && choices[item.id]?.status !== "skip" && (
            <Row options={VS_PLAN_LABELS} value={choices[item.id]?.vs_plan} onPick={(vs_plan) => pick(item.id, { vs_plan })} />
          )}
        </View>
      ))}
      <TextInput style={styles.input} placeholder="想说一句也可以，不写也行" value={note} onChangeText={setNote} multiline />
      <TextInput style={styles.input} placeholder="今天卡在哪（可不填）" value={blocker} onChangeText={setBlocker} />
      <TextInput style={styles.input} placeholder="明天最想先做的一件事（可不填）" value={tomorrow} onChangeText={setTomorrow} />
      <Pressable style={[styles.primary, busy && styles.dim]} onPress={saveButtons} disabled={busy} accessibilityRole="button">
        <Text style={styles.primaryText}>记好了</Text>
      </Pressable>

      <Text style={styles.or}>懒得点？一句话说完也行</Text>
      <TextInput style={styles.input} placeholder="比如：英语背了，看书只看了十分钟，复习比预想花得多"
        value={sentence} onChangeText={setSentence} multiline />
      <Pressable style={[styles.secondary, busy && styles.dim]} disabled={busy || !sentence.trim()}
        onPress={() => send({ sentence })} accessibilityRole="button">
        <Text>{busy ? "正在整理……" : "帮我记"}</Text>
      </Pressable>
      {message && <Text style={styles.message}>{message}</Text>}
    </ScrollView>
  );
}

function Row<K extends string>({ options, value, onPick }: {
  options: Record<K, string>;
  value?: K;
  onPick: (k: K) => void;
}) {
  return (
    <View style={styles.row}>
      {(Object.keys(options) as K[]).map((k) => (
        <Pressable key={k} onPress={() => onPick(k)} accessibilityRole="radio" accessibilityState={{ checked: value === k }}
          style={[styles.choice, value === k && styles.chosen]}>
          <Text style={value === k ? styles.chosenText : undefined}>{options[k]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 560, width: "100%", alignSelf: "center" },
  item: { gap: 6 },
  itemTitle: { fontSize: 16, fontWeight: "500" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  chosen: { backgroundColor: "#1a73e8", borderColor: "#1a73e8" },
  chosenText: { color: "#fff" },
  input: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, padding: 10 },
  primary: { backgroundColor: "#1a73e8", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  primaryText: { color: "#fff", fontSize: 16 },
  secondary: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  dim: { opacity: 0.5 },
  or: { marginTop: 16, color: "#5f6368" },
  muted: { color: "#5f6368" },
  closing: { fontSize: 16, lineHeight: 24 },
  message: { color: "#b3261e" },
});
