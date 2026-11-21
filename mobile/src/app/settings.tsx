import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, SlideInDown, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClassItem, getSettings, Habit, isCrisis, Project, putSettings, say, Settings } from "@/api";
import { EnergyPick } from "@/components/chips";
import { EASE, haptic, Pressy, Skeleton } from "@/components/motion";
import { HALF, Num } from "@/components/fields";
import { PickField } from "@/components/time-field";
import {
  Body, Button, Card, Chip, CrisisCard, ErrorState, Field, Glass, Header, IconButton, Label, Notice, Row, Screen, Small, Title,
} from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MAX_HABITS = 3; // 和后端 mentor/review.py 的 MAX_HABITS 一致
// 还没保存的新项先用临时 id 当 key（删掉中间一项时输入框不串）；后端不认识它，会发正式 id
const tempId = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BAR_SPACE = 140; // 页面底部给保存栏留的空
const UNDO_MS = 5000;
const SAVED_MS = 1200; // 「存好了」停多久再滑下去

type Message = { text: string; tone: "info" | "error" | "crisis" };
type ListKey = "habits" | "timetable" | "projects";
type Removed = { key: ListKey; index: number; item: unknown; name: string };
type Part = "routine" | "classes" | "reminders";

const TITLES: Record<Part | "all", string> = {
  routine: "作息和习惯", classes: "课表和项目", reminders: "提醒", all: "设置",
};

const norm = (x: Settings): Settings => ({ ...x, timetable: x.timetable ?? [], projects: x.projects ?? [] });

/** 设置：作息、习惯和保底版、每周课表、项目、提醒。?part= 只显示其中一段；保存仍是整份一起存，后端先试排今天，排得出来才存。 */
export default function SettingsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const raw = useLocalSearchParams<{ part?: string }>().part;
  const part = raw === "routine" || raw === "classes" || raw === "reminders" ? raw : undefined; // 认不出的值就显示整页
  const show = (p: Part) => !part || part === p;
  const title = TITLES[part ?? "all"];
  const leaving = useRef(false); // 已经决定离开（存好了或不要了），返回时不再拦

  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(""); // 上次存下的样子，和现在比就知道有没有改动
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [ask, setAsk] = useState<{ action?: Parameters<typeof navigation.dispatch>[0] } | null>(null);

  useEffect(() => {
    getSettings().then(
      (x) => { const n = norm(x); setS(n); setSaved(JSON.stringify(n)); },
      () => setFailed(true),
    );
  }, [attempt]);

  const dirty = !!s && JSON.stringify(s) !== saved;

  // 系统的返回手势 / 返回键也拦一下
  useEffect(() => {
    if (!dirty) return;
    // expo-router 的类型里没列 beforeRemove，这里手动标一下
    type Leaving = { preventDefault: () => void; data: { action: Parameters<typeof navigation.dispatch>[0] } };
    return navigation.addListener("beforeRemove" as never, ((e: Leaving) => {
      if (leaving.current) return;
      e.preventDefault();
      setMessage(null);
      setAsk({ action: e.data.action });
    }) as never);
  }, [dirty, navigation]);

  // 撤销条 5 秒后自己收走
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [removed]);

  // 存好后让「存好了」停一会儿再收栏，同时把成功提示清掉
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => { setJustSaved(false); setMessage((m) => (m?.tone === "info" ? null : m)); }, SAVED_MS);
    return () => clearTimeout(t);
  }, [justSaved]);

  // 保存栏：有改动（或刚存好）才从下面滑上来
  const barShown = dirty || justSaved;
  const barY = useSharedValue(240);
  useEffect(() => {
    barY.set(withTiming(barShown ? 0 : 240, { duration: 240, easing: EASE }));
  }, [barShown, barY]);
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: barY.value }] }));

  if (!s) {
    return (
      <Screen safeTop>
        <Header title={title} />
        {failed ? (
          <ErrorState onRetry={() => { setFailed(false); setAttempt((a) => a + 1); }} />
        ) : (
          <>
            <Skeleton height={120} r={radius.lg} />
            <Skeleton height={220} r={radius.lg} />
            <Skeleton height={160} r={radius.lg} />
          </>
        )}
      </Screen>
    );
  }
  const timetable = s.timetable ?? [];
  const projects = s.projects ?? [];

  const setHabit = (i: number, h: Partial<Habit>) => setS({ ...s, habits: s.habits.map((x, j) => (j === i ? { ...x, ...h } : x)) });
  const setClass = (i: number, x: Partial<ClassItem>) =>
    setS({ ...s, timetable: timetable.map((y, j) => (j === i ? { ...y, ...x } : y)) });
  const setProject = (i: number, p: Partial<Project>) =>
    setS({ ...s, projects: projects.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  /** 先从列表里拿掉，出一条可撤销的提示 */
  function remove(key: ListKey, index: number, name: string) {
    const list = (s![key] ?? []) as unknown[];
    setRemoved({ key, index, item: list[index], name: name.trim() || "这一项" });
    setS({ ...s!, [key]: list.filter((_, j) => j !== index) });
  }
  function undo() {
    if (!removed) return;
    const { key, index, item } = removed;
    const list = [...((s![key] ?? []) as unknown[])];
    if (key === "habits" && list.length >= MAX_HABITS) { // 删了又加满了：放不回去
      setRemoved(null);
      setMessage({ text: `习惯最多 ${MAX_HABITS} 个，先删一个再撤销。`, tone: "info" });
      return;
    }
    list.splice(index, 0, item);
    setS({ ...s!, [key]: list });
    setRemoved(null);
  }

  async function save(): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    setJustSaved(false);
    try {
      const res = await putSettings(s!);
      if (isCrisis(res)) { setMessage({ text: res.message, tone: "crisis" }); return false; }
      const n = norm(res);
      setS(n);
      setSaved(JSON.stringify(n));
      setRemoved(null);
      haptic.success();
      setMessage({ text: "存好了，今天的计划已经按新设置重排。", tone: "info" });
      setJustSaved(true);
      return true;
    } catch (e) {
      setMessage({ text: say(e), tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const leave = (action?: Parameters<typeof navigation.dispatch>[0]) => {
    setAsk(null);
    leaving.current = true;
    if (action) navigation.dispatch(action);
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  // 面板里点「保存」：存成功才离开；失败面板不关，错误显示在面板里
  const saveAndLeave = async () => {
    if (await save()) leave(ask?.action);
  };
  const done = justSaved && !dirty;
  const notice = message?.tone === "crisis" ? <CrisisCard message={message.text} />
    : message && <Notice tone={message.tone === "error" ? "error" : "info"}>{message.text}</Notice>;

  return (
    <View style={{ flex: 1 }}>
      <Screen safeTop bottom={BAR_SPACE}>
        <Header title={title} onBack={dirty ? () => { setMessage(null); setAsk({}); } : undefined} />

        {show("routine") && (
          <>
            <Section title="作息">
              <Card i={1}>
                <Row>
                  <PickField label="起床" mode="time" value={s.wake} style={HALF} onChange={(wake) => setS({ ...s, wake })} />
                  <PickField label="上床" mode="time" value={s.sleep} style={HALF} onChange={(sleep) => setS({ ...s, sleep })} />
                </Row>
              </Card>
            </Section>

            <Section title="习惯" hint={`最多 ${MAX_HABITS} 个。没电的日子只排保底版。`}>
              {s.habits.map((h, i) => (
                <Card key={h.id ?? `new-${i}`} i={i + 2}>
                  <Row>
                    <Field label="叫什么" value={h.title} onChangeText={(title) => setHabit(i, { title })} style={{ flex: 1, minWidth: 130 }} />
                    {s.habits.length > 1 && (
                      <IconButton name="trash-outline" label={`删掉${h.title || "这个习惯"}`} onPress={() => remove("habits", i, h.title)} />
                    )}
                  </Row>
                  <Row>
                    <Num label="标准版（分钟）" value={h.minutes} onChange={(minutes) => setHabit(i, { minutes })} />
                    <Num label="保底版（分钟）" value={h.floor_min} onChange={(floor_min) => setHabit(i, { floor_min })} />
                  </Row>
                  <Small muted>做这件事，对你来说是（可不选）</Small>
                  <EnergyPick value={h.energy} onChange={(energy) => setHabit(i, { energy })} />
                </Card>
              ))}
              {s.habits.length < MAX_HABITS && (
                <Button label="加一个习惯" icon="add" variant="quiet" onPress={() =>
                  setS({ ...s, habits: [...s.habits, { id: tempId(), title: "", minutes: 20, floor_min: 10, energy: null }] })} />
              )}
            </Section>
          </>
        )}

        {show("classes") && (
          <>
            <Section title="每周课表" hint="按星期几排，每周一样。">
              {timetable.map((k, i) => (
                <Card key={i} i={i + 1}>
                  <Row>
                    <Field label="课名" value={k.title} onChangeText={(title) => setClass(i, { title })} style={{ flex: 1, minWidth: 130 }} />
                    <IconButton name="trash-outline" label={`删掉${k.title || "这节课"}`} onPress={() => remove("timetable", i, k.title)} />
                  </Row>
                  <Weekdays value={k.weekday} onChange={(weekday) => setClass(i, { weekday })} />
                  <Row>
                    <PickField label="上课" mode="time" value={k.start} style={HALF} onChange={(start) => setClass(i, { start })} />
                    <PickField label="下课" mode="time" value={k.end} style={HALF} onChange={(end) => setClass(i, { end })} />
                  </Row>
                  <Row>
                    <Chip label="在学校" on={k.where === "campus"} onPress={() => setClass(i, { where: "campus" })} />
                    <Chip label="别处" on={k.where === "other"} onPress={() => setClass(i, { where: "other" })} />
                  </Row>
                  <Small muted>这节课，对你来说是（可不选）</Small>
                  <EnergyPick value={k.energy} onChange={(energy) => setClass(i, { energy })} />
                </Card>
              ))}
              <Button label="加一节课" icon="add" variant="quiet" onPress={() => setS({
                ...s, timetable: [...timetable, { title: "", weekday: 0, start: "09:00", end: "11:00", where: "campus", energy: null }],
              })} />
            </Section>

            <Section title="项目" hint="要往前推的事（复习、作业、作品）。有电的时候排番茄；做完一段，把剩下的小时数改小。">
              {projects.map((p, i) => (
                <Card key={p.id ?? `new-${i}`} i={i + 1}>
                  <Row>
                    <Field label="项目名" value={p.title} onChangeText={(title) => setProject(i, { title })} style={{ flex: 1, minWidth: 130 }} />
                    <IconButton name="trash-outline" label={`删掉${p.title || "这个项目"}`} onPress={() => remove("projects", i, p.title)} />
                  </Row>
                  <Row>
                    <Num label="还要几小时" value={p.hours_left} decimal onChange={(hours_left) => setProject(i, { hours_left })} />
                    <PickField label="截止日（可不填）" mode="date" value={p.deadline ?? ""} style={HALF}
                      onChange={(deadline) => setProject(i, { deadline })} onClear={() => setProject(i, { deadline: null })} />
                  </Row>
                  <Row>
                    <Chip role="checkbox" label="费脑子，一次排一大块" on={p.heavy} onPress={() => setProject(i, { heavy: !p.heavy })} />
                  </Row>
                  <Small muted>做这件事，对你来说是（可不选）</Small>
                  <EnergyPick value={p.energy} onChange={(energy) => setProject(i, { energy })} />
                </Card>
              ))}
              <Button label="加一个项目" icon="add" variant="quiet" onPress={() => setS({
                ...s, projects: [...projects, { id: tempId(), title: "", hours_left: 10, deadline: null, heavy: false, energy: null }],
              })} />
            </Section>
          </>
        )}

        {show("reminders") && (
          <Section title="提醒" hint="在手机上弹出；网页版不提醒。">
            <Card i={1}>
              <Row>
                <Chip role="checkbox" label="下课时问电量" on={s.reminders?.after_class ?? true}
                  onPress={() => setS({ ...s, reminders: { after_class: !(s.reminders?.after_class ?? true), evening: s.reminders?.evening ?? "21:00" } })} />
              </Row>
              <PickField label="晚上对账提醒（可不填）" mode="time" value={s.reminders?.evening ?? ""} initial="21:00"
                onChange={(t) => setS({ ...s, reminders: { after_class: s.reminders?.after_class ?? true, evening: t } })}
                onClear={() => setS({ ...s, reminders: { after_class: s.reminders?.after_class ?? true, evening: null } })} />
            </Card>
          </Section>
        )}

        {message?.tone === "crisis" && notice}
      </Screen>

      {removed && (
        <Animated.View key={`${removed.key}-${removed.index}-${removed.name}`} entering={FadeIn.duration(160)}
          style={{ position: "absolute", left: space.lg, right: space.lg, bottom: BAR_SPACE + insets.bottom, alignItems: "center" }}>
          <Glass style={{ borderRadius: radius.pill, maxWidth: 560, width: "100%" }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md,
              paddingLeft: space.lg, paddingRight: space.sm }}>
              <Text numberOfLines={1} style={[type.label, { color: c.text, flexShrink: 1 }]}>{`删掉了「${removed.name}」`}</Text>
              <Pressy onPress={undo} accessibilityRole="button" accessibilityLabel="撤销" style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space.md }}>
                <Text style={[type.label, { color: c.primary, fontWeight: "600" }]}>撤销</Text>
              </Pressy>
            </View>
          </Glass>
        </Animated.View>
      )}

      <Animated.View pointerEvents={barShown ? "auto" : "none"}
        style={[{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.edge,
          paddingTop: space.md, paddingHorizontal: space.lg, paddingBottom: space.md + insets.bottom }, barStyle]}>
        <View style={{ maxWidth: 560, width: "100%", alignSelf: "center", gap: space.sm }}>
          {message?.tone !== "crisis" && notice}
          <Button label={done ? "存好了" : "保存"} variant={done ? "secondary" : "primary"} icon={done ? "checkmark" : undefined}
            busyLabel={busy ? "正在试排今天……" : undefined} onPress={() => { if (!done) save(); }} />
        </View>
      </Animated.View>

      {ask && (
        <>
          <Animated.View entering={FadeIn.duration(160)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            <Pressable accessibilityLabel="关闭" onPress={() => setAsk(null)} style={{ flex: 1, backgroundColor: c.overlay }} />
          </Animated.View>
          <Animated.View entering={SlideInDown.duration(260).easing(EASE)} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
            <View style={{ backgroundColor: c.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1,
              borderBottomWidth: 0, borderColor: c.glassEdge, boxShadow: c.glassShadow, maxWidth: 560, width: "100%", alignSelf: "center" }}>
              <View accessibilityViewIsModal style={{ padding: space.lg, gap: space.md, paddingBottom: space.lg + insets.bottom }}>
                <Title>改动还没保存</Title>
                <Body muted>现在离开，这些改动就没有了。</Body>
                {message && message.tone !== "info" && notice}
                <Button label="保存" busyLabel={busy ? "正在试排今天……" : undefined} onPress={() => { saveAndLeave(); }} />
                <Button label="不要了" variant="quietDanger" onPress={() => leave(ask.action)} />
              </View>
            </View>
          </Animated.View>
        </>
      )}
    </View>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.md, marginTop: space.sm }}>
      <View style={{ gap: 2 }}>
        <Title>{title}</Title>
        {hint && <Label muted>{hint}</Label>}
      </View>
      {children}
    </View>
  );
}

/** 星期一到日：一行七个等宽圆，选中只换底色和边，宽度不变所以整排不跳。 */
function Weekdays({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: space.xs }}>
      {WEEKDAYS.map((d, wd) => {
        const on = value === wd;
        return (
          <Pressy key={d} onPress={() => { haptic.select(); onChange(wd); }} accessibilityRole="radio" accessibilityLabel={`星期${d}`}
            accessibilityState={{ checked: on }} scaleTo={0.92}
            style={{ flex: 1, maxWidth: 40, aspectRatio: 1, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
              backgroundColor: on ? c.soft : c.sunken, borderWidth: 1.5, borderColor: on ? c.primary : "transparent" }}>
            <Text style={[type.label, { color: on ? c.onSoft : c.text }]}>{d}</Text>
          </Pressy>
        );
      })}
    </View>
  );
}
