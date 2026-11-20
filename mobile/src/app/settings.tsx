import { useEffect, useState } from "react";
import { View } from "react-native";

import { ClassItem, getSettings, Habit, isCrisis, Project, putSettings, Settings } from "@/api";
import { EnergyPick } from "@/components/chips";
import { Body, Button, Card, Chip, CrisisCard, Field, Loading, Notice, Row, Screen, Small, Title } from "@/components/ui";
import { space } from "@/theme";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MAX_HABITS = 3; // 和后端 mentor/review.py 的 MAX_HABITS 一致
// 还没保存的新项先用临时 id 当 key（删掉中间一项时输入框不串）；后端不认识它，会发正式 id
const tempId = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const HALF = { flex: 1, minWidth: 130 };

type Message = { text: string; tone: "info" | "error" | "crisis" };

/** 设置：作息、习惯和保底版、每周课表、项目、提醒。保存时后端先试排今天，排得出来才存。 */
export default function SettingsScreen() {
  const [s, setS] = useState<Settings | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings().then(
      (x) => setS({ ...x, timetable: x.timetable ?? [], projects: x.projects ?? [] }),
      (e: Error) => setMessage({ text: e.message, tone: "error" }),
    );
  }, []);

  if (!s) return message ? <Screen><Notice tone="error">{message.text}</Notice></Screen> : <Loading text="……" />;
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
      if (isCrisis(res)) return setMessage({ text: res.message, tone: "crisis" });
      setS({ ...res, timetable: res.timetable ?? [], projects: res.projects ?? [] });
      setMessage({ text: "存好了，今天的计划已经按新设置重排。", tone: "info" });
    } catch (e) {
      setMessage({ text: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Section title="作息">
        <Card>
          <Row>
            <Field label="起床" value={s.wake} placeholder="07:30" onChangeText={(wake) => setS({ ...s, wake })} style={HALF} />
            <Field label="上床" value={s.sleep} placeholder="23:00" onChangeText={(sleep) => setS({ ...s, sleep })} style={HALF} />
          </Row>
        </Card>
      </Section>

      <Section title="习惯" hint={`最多 ${MAX_HABITS} 个。没电的日子只排保底版。`}>
        {s.habits.map((h, i) => (
          <Card key={h.id ?? `new-${i}`}>
            <Field label="叫什么" value={h.title} onChangeText={(title) => setHabit(i, { title })} />
            <Row>
              <Num label="标准版（分钟）" value={h.minutes} onChange={(minutes) => setHabit(i, { minutes })} />
              <Num label="保底版（分钟）" value={h.floor_min} onChange={(floor_min) => setHabit(i, { floor_min })} />
            </Row>
            <Small muted>做这件事对你来说是</Small>
            <EnergyPick value={h.energy} onChange={(energy) => setHabit(i, { energy })} />
            {s.habits.length > 1 && (
              <Remove onPress={() => setS({ ...s, habits: s.habits.filter((_, j) => j !== i) })} />
            )}
          </Card>
        ))}
        {s.habits.length < MAX_HABITS && (
          <Button label="＋ 加一个习惯" variant="quiet" onPress={() =>
            setS({ ...s, habits: [...s.habits, { id: tempId(), title: "", minutes: 20, floor_min: 10, energy: null }] })} />
        )}
      </Section>

      <Section title="每周课表" hint="按星期几排，每周一样。">
        {timetable.map((c, i) => (
          <Card key={i}>
            <Field label="课名" value={c.title} onChangeText={(title) => setClass(i, { title })} />
            <Row>
              {WEEKDAYS.map((d, wd) => (
                <Chip key={d} label={d} on={c.weekday === wd} onPress={() => setClass(i, { weekday: wd })} />
              ))}
            </Row>
            <Row>
              <Field label="上课" value={c.start} placeholder="09:00" onChangeText={(start) => setClass(i, { start })} style={HALF} />
              <Field label="下课" value={c.end} placeholder="11:00" onChangeText={(end) => setClass(i, { end })} style={HALF} />
            </Row>
            <Row>
              <Chip label="在学校" on={c.where === "campus"} onPress={() => setClass(i, { where: "campus" })} />
              <Chip label="别处" on={c.where === "other"} onPress={() => setClass(i, { where: "other" })} />
            </Row>
            <Small muted>这节课对你来说是</Small>
            <EnergyPick value={c.energy} onChange={(energy) => setClass(i, { energy })} />
            <Remove onPress={() => setS({ ...s, timetable: timetable.filter((_, j) => j !== i) })} />
          </Card>
        ))}
        <Button label="＋ 加一节课" variant="quiet" onPress={() => setS({
          ...s, timetable: [...timetable, { title: "", weekday: 0, start: "09:00", end: "11:00", where: "campus", energy: null }],
        })} />
      </Section>

      <Section title="项目" hint="要往前推的事（复习、作业、作品）。有电的时候排番茄；做完一段，把剩下的小时数改小。">
        {projects.map((p, i) => (
          <Card key={p.id ?? `new-${i}`}>
            <Field label="项目名" value={p.title} onChangeText={(title) => setProject(i, { title })} />
            <Row>
              <Num label="还要几小时" value={p.hours_left} decimal onChange={(hours_left) => setProject(i, { hours_left })} />
              <Field label="截止日（2026-12-31）" value={p.deadline ?? ""} placeholder="不填 = 没有" style={HALF}
                onChangeText={(d) => setProject(i, { deadline: d.trim() || null })} />
            </Row>
            <Row>
              <Chip role="checkbox" label="费脑子，一次排一大块" on={p.heavy} onPress={() => setProject(i, { heavy: !p.heavy })} />
            </Row>
            <Small muted>做这件事对你来说是</Small>
            <EnergyPick value={p.energy} onChange={(energy) => setProject(i, { energy })} />
            <Remove onPress={() => setS({ ...s, projects: projects.filter((_, j) => j !== i) })} />
          </Card>
        ))}
        <Button label="＋ 加一个项目" variant="quiet" onPress={() => setS({
          ...s, projects: [...projects, { id: tempId(), title: "", hours_left: 10, deadline: null, heavy: false, energy: null }],
        })} />
      </Section>

      <Section title="提醒" hint="在手机上弹出；网页版不提醒。">
        <Card>
          <Row>
            <Chip role="checkbox" label="下课时问电量" on={s.reminders?.after_class ?? true}
              onPress={() => setS({ ...s, reminders: { after_class: !(s.reminders?.after_class ?? true), evening: s.reminders?.evening ?? "21:00" } })} />
          </Row>
          <Field label="晚上对账提醒（不填 = 不提醒）" value={s.reminders?.evening ?? ""} placeholder="21:00"
            onChangeText={(t) => setS({ ...s, reminders: { after_class: s.reminders?.after_class ?? true, evening: t.trim() || null } })} />
        </Card>
      </Section>

      {message?.tone === "crisis" ? <CrisisCard message={message.text} />
        : message && <Notice tone={message.tone === "error" ? "error" : "info"}>{message.text}</Notice>}
      <Button label="保存" busyLabel={busy ? "正在试排今天……" : undefined} onPress={save} />
    </Screen>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md, marginTop: space.sm }}>
      <View style={{ gap: 2 }}>
        <Title>{title}</Title>
        {hint && <Body muted>{hint}</Body>}
      </View>
      {children}
    </View>
  );
}

function Num({ label, value, onChange, decimal }: { label: string; value: number; onChange: (v: number) => void; decimal?: boolean }) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {  // 保存后服务器返回的值不一样（比如取整）时，框里跟着变；打字时不打断
    setPrev(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <Field label={label} value={text} keyboardType={decimal ? "decimal-pad" : "number-pad"} style={HALF}
      onChangeText={(t) => {
        setText(t);
        const n = Number(t);
        if (t.trim() && !Number.isNaN(n)) onChange(n);
      }} />
  );
}

function Remove({ onPress }: { onPress: () => void }) {
  return (
    <View style={{ alignItems: "flex-start" }}>
      <Button label="删掉" variant="quiet" onPress={onPress} />
    </View>
  );
}
