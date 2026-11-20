import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ClassItem, getSettings, Habit, isCrisis, Project, putSettings, Settings } from "@/api";
import { Chip, EnergyPick } from "@/components/chips";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MAX_HABITS = 3; // 和后端 mentor/review.py 的 MAX_HABITS 一致

/** 设置：作息、习惯和保底版、每周课表、项目、提醒。保存时后端先试排今天，排得出来才存。 */
export default function SettingsScreen() {
  const [s, setS] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings().then(
      (x) => setS({ ...x, timetable: x.timetable ?? [], projects: x.projects ?? [] }),
      (e: Error) => setMessage(e.message),
    );
  }, []);

  if (!s) return <Text style={styles.page}>{message ?? "……"}</Text>;
  const timetable = s.timetable ?? [];
  const projects = s.projects ?? [];

  const setHabit = (i: number, h: Partial<Habit>) => setS({ ...s, habits: s.habits.map((x, j) => (j === i ? { ...x, ...h } : x)) });
  const setClass = (i: number, c: Partial<ClassItem>) =>
    setS({ ...s, timetable: timetable.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const setProject = (i: number, p: Partial<Project>) =>
    setS({ ...s, projects: projects.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await putSettings(s!);
      if (isCrisis(res)) return setMessage(res.message);
      setS({ ...res, timetable: res.timetable ?? [], projects: res.projects ?? [] });
      setMessage("存好了，今天的计划已经按新设置重排。");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>作息</Text>
      <View style={styles.row}>
        <Labeled label="起床"><Time value={s.wake} onChange={(wake) => setS({ ...s, wake })} /></Labeled>
        <Labeled label="上床"><Time value={s.sleep} onChange={(sleep) => setS({ ...s, sleep })} /></Labeled>
      </View>

      <Text style={styles.heading}>习惯（最多 {MAX_HABITS} 个）</Text>
      {s.habits.map((h, i) => (
        <View key={h.id ?? `new-${i}`} style={styles.card}>
          <TextInput style={styles.input} value={h.title} placeholder="叫什么" onChangeText={(title) => setHabit(i, { title })} />
          <View style={styles.row}>
            <Labeled label="标准版分钟"><Num value={h.minutes} onChange={(minutes) => setHabit(i, { minutes })} /></Labeled>
            <Labeled label="保底版分钟"><Num value={h.floor_min} onChange={(floor_min) => setHabit(i, { floor_min })} /></Labeled>
          </View>
          <EnergyPick value={h.energy} onChange={(energy) => setHabit(i, { energy })} />
          {s.habits.length > 1 && <Remove onPress={() => setS({ ...s, habits: s.habits.filter((_, j) => j !== i) })} />}
        </View>
      ))}
      {s.habits.length < MAX_HABITS && (
        <Add label="加一个习惯" onPress={() =>
          setS({ ...s, habits: [...s.habits, { title: "", minutes: 20, floor_min: 10, energy: null }] })} />
      )}

      <Text style={styles.heading}>每周课表</Text>
      {timetable.map((c, i) => (
        <View key={i} style={styles.card}>
          <TextInput style={styles.input} value={c.title} placeholder="课名" onChangeText={(title) => setClass(i, { title })} />
          <View style={styles.row}>
            {WEEKDAYS.map((d, wd) => (
              <Chip key={d} label={d} on={c.weekday === wd} onPress={() => setClass(i, { weekday: wd })} />
            ))}
          </View>
          <View style={styles.row}>
            <Labeled label="上课"><Time value={c.start} onChange={(start) => setClass(i, { start })} /></Labeled>
            <Labeled label="下课"><Time value={c.end} onChange={(end) => setClass(i, { end })} /></Labeled>
          </View>
          <View style={styles.row}>
            <Chip label="在学校" on={c.where === "campus"} onPress={() => setClass(i, { where: "campus" })} />
            <Chip label="别处" on={c.where === "other"} onPress={() => setClass(i, { where: "other" })} />
          </View>
          <EnergyPick value={c.energy} onChange={(energy) => setClass(i, { energy })} />
          <Remove onPress={() => setS({ ...s, timetable: timetable.filter((_, j) => j !== i) })} />
        </View>
      ))}
      <Add label="加一节课" onPress={() => setS({
        ...s, timetable: [...timetable, { title: "", weekday: 0, start: "09:00", end: "11:00", where: "campus", energy: null }],
      })} />

      <Text style={styles.heading}>项目</Text>
      <Text style={styles.muted}>要往前推的事（复习、作业、作品）。晚上有电的时候排番茄；剩余小时数做完一段自己改小。</Text>
      {projects.map((p, i) => (
        <View key={p.id ?? `new-${i}`} style={styles.card}>
          <TextInput style={styles.input} value={p.title} placeholder="项目名" onChangeText={(title) => setProject(i, { title })} />
          <View style={styles.row}>
            <Labeled label="还要几小时"><Num value={p.hours_left} decimal onChange={(hours_left) => setProject(i, { hours_left })} /></Labeled>
            <Labeled label="截止（2026-12-31）">
              <TextInput style={[styles.input, styles.short]} value={p.deadline ?? ""} placeholder="不填 = 没有"
                onChangeText={(d) => setProject(i, { deadline: d.trim() || null })} />
            </Labeled>
          </View>
          <Chip label="费脑子（一次排一大块）" on={p.heavy} onPress={() => setProject(i, { heavy: !p.heavy })} />
          <EnergyPick value={p.energy} onChange={(energy) => setProject(i, { energy })} />
          <Remove onPress={() => setS({ ...s, projects: projects.filter((_, j) => j !== i) })} />
        </View>
      ))}
      <Add label="加一个项目" onPress={() => setS({
        ...s, projects: [...projects, { title: "", hours_left: 10, deadline: null, heavy: false, energy: null }],
      })} />

      <Text style={styles.heading}>提醒（手机上）</Text>
      <Chip label="下课时问电量" on={s.reminders?.after_class ?? true}
        onPress={() => setS({ ...s, reminders: { after_class: !(s.reminders?.after_class ?? true), evening: s.reminders?.evening ?? "21:00" } })} />
      <Labeled label="晚上对账提醒（不填 = 不提醒）">
        <TextInput style={[styles.input, styles.short]} value={s.reminders?.evening ?? ""} placeholder="21:00"
          onChangeText={(t) => setS({ ...s, reminders: { after_class: s.reminders?.after_class ?? true, evening: t.trim() || null } })} />
      </Labeled>

      <Pressable style={[styles.primary, busy && styles.dim]} onPress={save} disabled={busy} accessibilityRole="button">
        <Text style={styles.primaryText}>{busy ? "正在试排……" : "保存"}</Text>
      </Pressable>
      {message && <Text style={styles.muted}>{message}</Text>}
    </ScrollView>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.labeled}><Text style={styles.muted}>{label}</Text>{children}</View>;
}

function Time({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <TextInput style={[styles.input, styles.short]} value={value} placeholder="07:30" onChangeText={onChange} />;
}

function Num({ value, onChange, decimal }: { value: number; onChange: (v: number) => void; decimal?: boolean }) {
  const [text, setText] = useState(String(value));
  return (
    <TextInput style={[styles.input, styles.short]} value={text} keyboardType={decimal ? "decimal-pad" : "number-pad"}
      onChangeText={(t) => {
        setText(t);
        const n = Number(t);
        if (t.trim() && !Number.isNaN(n)) onChange(n);
      }} />
  );
}

function Add({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button"><Text style={styles.link}>＋ {label}</Text></Pressable>;
}

function Remove({ onPress }: { onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button"><Text style={styles.remove}>删掉</Text></Pressable>;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, maxWidth: 560, width: "100%", alignSelf: "center" },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 14 },
  card: { borderWidth: 1, borderColor: "#e8eaed", borderRadius: 8, padding: 10, gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-end" },
  labeled: { gap: 4 },
  input: { borderWidth: 1, borderColor: "#dadce0", borderRadius: 8, padding: 8 },
  short: { minWidth: 90 },
  muted: { color: "#5f6368" },
  link: { color: "#1a73e8" },
  remove: { color: "#b3261e" },
  primary: { backgroundColor: "#1a73e8", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  primaryText: { color: "#fff", fontSize: 16 },
  dim: { opacity: 0.5 },
});
