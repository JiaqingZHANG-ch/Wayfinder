import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { ApiError, Block, getMe, getToday, getWeek, Me, Plan, Week } from "@/api";
import { Consent } from "@/components/consent";
import { enter, Pressy, Ring, Skeleton } from "@/components/motion";
import { dayLabel, kindIcon, kindName, PlanView, toMin, useNow } from "@/components/plan-view";
import { Body, Button, Card, Display, Eyebrow, Icon, IconName, Screen, Small, Title } from "@/components/ui";
import { scheduleToday } from "@/notifications";
import { radius, space, TAB_SPACE, type, useColors } from "@/theme";

function greeting(h: number): string {
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 90 → 「1 小时 30 分」，25 → 「25 分钟」 */
function span(min: number): string {
  if (min < 60) return `${min} 分钟`;
  return min % 60 ? `${Math.floor(min / 60)} 小时 ${min % 60} 分` : `${min / 60} 小时`;
}

const EVENING = 19 * 60; // 这之后首页把「晚间对账」放到最显眼

export default function Today() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const c = useColors();

  const load = useCallback(() => {
    getWeek().then(setWeek, () => {}); // 复盘入口和本周记录拿不到就不显示
    getMe().then(setMe, () => {});
    return getToday().then((p) => {
      setPlan(p);
      setError(null);
      scheduleToday(p.day, p.reminders ?? []).catch(() => {}); // 定不上提醒也不挡着看计划
    }, setError);
  }, []);

  // 一打开就拿（从提醒直接进报电量面板时，这页在下面但没有焦点，也要有内容）；
  // 之后每次回到这一页再拿一次：报完电量、对完账回来，看到的就是新计划
  const seen = useRef(false);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => {
    if (seen.current) load();
    seen.current = true;
  }, [load]));

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (error instanceof ApiError && error.status === 409) return <Redirect href="/onboarding" />; // 还没建档
  if (error) {
    return (
      <Screen scroll={false} safeTop>
        <View style={{ alignItems: "center", gap: space.md, paddingTop: space.xxl }}>
          <Icon name="cloud-offline-outline" size={48} color={c.muted} />
          <Title>没连上</Title>
          <Body muted center>没拿到今天的计划：{error.message}。后端开着吗？</Body>
          <Button label="再试一次" icon="refresh" variant="secondary" onPress={load} />
        </View>
      </Screen>
    );
  }
  if (!plan) return <TodaySkeleton />;
  if (me && !me.consented) {
    // 隐私说明换了新版本：老用户先看完再用
    return <Screen safeTop><Consent me={me} onDone={setMe} /></Screen>;
  }

  const evening = now >= EVENING;
  return (
    <Screen safeTop bottom={TAB_SPACE}
      refresh={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}>
      <Animated.View entering={enter(0)} style={{ gap: space.xs }}>
        <Small muted>{dayLabel(plan.day)}</Small>
        <Display>{greeting(new Date().getHours())}</Display>
      </Animated.View>

      <Animated.View entering={enter(1)}><NowCard blocks={plan.blocks} now={now} /></Animated.View>

      <Animated.View entering={enter(2)} style={{ flexDirection: "row", gap: space.md }}>
        <Action icon="battery-half-outline" title="下课了" sub="报一下电量" strong={!evening}
          onPress={() => router.push("/energy")} />
        <Action icon="moon-outline" title="晚间对账" sub="一两分钟" strong={evening}
          onPress={() => router.push("/checkin")} />
      </Animated.View>

      <Card i={3} style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
        <EnergyRing plan={plan} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Title>今天的精力</Title>
          <Small muted>
            {plan.energy_level ? `电量 ${plan.energy_level} 格` : "还没报电量"}{plan.confirmed ? " · 计划已确认" : ""}
          </Small>
          {week && <WeekDots logged={week.logged_days} />}
        </View>
      </Card>

      {week?.review && (
        <Card i={4} onPress={() => router.push("/review")} label="打开这周的复盘"
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.soft,
            alignItems: "center", justifyContent: "center" }}>
            <Icon name="leaf" size={22} color={c.onSoft} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: c.text, fontWeight: "600" }]}>
              {week.review === "due" ? "满 7 天了，来看看这一周" : "这周的复盘"}
            </Text>
            <Small muted>大约 5 分钟。只看事实，不打分。</Small>
          </View>
          <Icon name="chevron-forward" size={18} color={c.muted} />
        </Card>
      )}

      <Eyebrow>今天的安排</Eyebrow>
      <PlanView plan={plan} now={now} showEnergy={false} />
    </Screen>
  );
}

/** 「此刻」卡片：正在做的事和还剩多久；空档里就显示下一件；都过完了就提醒对账。 */
function NowCard({ blocks, now }: { blocks: Block[]; now: number }) {
  const c = useColors();
  const cur = blocks.find((b) => toMin(b.start) <= now && now < toMin(b.end));
  const next = blocks.find((b) => toMin(b.start) > now && b.kind !== "life");
  const fg = c.onPrimary;

  let eyebrow: string, title: string, sub: string, icon: IconName, progress: number | null = null;
  if (cur) {
    eyebrow = `现在 · 还剩 ${span(toMin(cur.end) - now)}`;
    title = cur.title;
    icon = kindIcon(cur);
    sub = `${kindName(cur) ? `${kindName(cur)} · ` : ""}${cur.start}–${cur.end}`;
    progress = (now - toMin(cur.start)) / (toMin(cur.end) - toMin(cur.start));
  } else if (next) {
    eyebrow = `接下来 · ${span(toMin(next.start) - now)}后`;
    title = next.title;
    icon = kindIcon(next);
    sub = `${kindName(next) ? `${kindName(next)} · ` : ""}${next.start}–${next.end}`;
  } else {
    eyebrow = "今天";
    title = "今天的安排都走完了";
    icon = "moon";
    sub = "花一两分钟对个账，就可以休息了。";
  }
  const after = cur && next ? next : null;

  return (
    <View accessible accessibilityLabel={`${eyebrow}，${title}，${sub}`}
      style={{ backgroundColor: c.primary, borderRadius: radius.xl, padding: space.xl, gap: space.md, boxShadow: c.shadow }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name={icon} size={16} color={fg} />
        <Text style={[type.small, { color: fg, fontWeight: "600" }]}>{eyebrow}</Text>
      </View>
      <Text style={[type.display, { color: fg, fontSize: 26, lineHeight: 34 }]} numberOfLines={2}>{title}</Text>
      <Text style={[type.small, { color: fg }]}>{sub}</Text>
      {progress !== null && (
        <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.28)", overflow: "hidden" }}>
          <View style={{ width: `${Math.round(progress * 100)}%`, height: "100%", borderRadius: radius.pill, backgroundColor: fg }} />
        </View>
      )}
      {after && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingTop: space.xs }}>
          <Icon name="arrow-forward" size={14} color={fg} />
          <Text style={[type.small, { color: fg }]} numberOfLines={1}>{after.start} {after.title}</Text>
        </View>
      )}
    </View>
  );
}

/** 两个入口块：当下更该做的那个用实心陶土色。 */
function Action({ icon, title, sub, strong, onPress }: {
  icon: IconName; title: string; sub: string; strong: boolean; onPress: () => void;
}) {
  const c = useColors();
  const fg = strong ? c.onPrimary : c.onSoft;
  return (
    <Pressy onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}，${sub}`}
      style={{ flex: 1, minHeight: 112, borderRadius: radius.lg, padding: space.lg, justifyContent: "space-between",
        backgroundColor: strong ? c.primary : c.soft }}>
      <View style={{ width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
        backgroundColor: strong ? "rgba(255,255,255,0.2)" : c.card }}>
        <Icon name={icon} size={20} color={fg} />
      </View>
      <View>
        <Text style={[type.label, { color: fg, fontWeight: "600" }]}>{title}</Text>
        <Text style={[type.small, { color: fg }]}>{sub}</Text>
      </View>
    </Pressy>
  );
}

function EnergyRing({ plan }: { plan: Plan }) {
  const c = useColors();
  const used = plan.energy_cap ? Math.min(1, plan.energy_used / plan.energy_cap) : 0;
  const pct = Math.round(used * 100);
  return (
    <Ring value={used} color={c.kind.must} label={`今天的精力安排了 ${pct}%`}>
      <Text style={[type.title, { color: c.text, fontVariant: ["tabular-nums"] }]}>{pct}%</Text>
    </Ring>
  );
}

/** 这 7 天哪几天记了：实心点是记了的天数（不分哪天，后端只给总数）。 */
function WeekDots({ logged }: { logged: number }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={`这 7 天记录了 ${logged} 天`} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {Array.from({ length: 7 }, (_, i) => (
        <View key={i} style={{ width: 10, height: 10, borderRadius: radius.pill,
          backgroundColor: i < logged ? c.primary : c.sunken }} />
      ))}
      <Small muted>  记了 {logged}/7 天</Small>
    </View>
  );
}

function TodaySkeleton() {
  return (
    <Screen safeTop bottom={TAB_SPACE}>
      <Skeleton height={16} width={140} />
      <Skeleton height={36} width={180} />
      <Skeleton height={176} r={radius.xl} />
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ flex: 1 }}><Skeleton height={112} r={radius.lg} /></View>
        <View style={{ flex: 1 }}><Skeleton height={112} r={radius.lg} /></View>
      </View>
      <Skeleton height={120} r={radius.lg} />
    </Screen>
  );
}
