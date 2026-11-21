import { Redirect, router, useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { ApiError, Block, getMe, getToday, getWeek, Me, Plan, Week } from "@/api";
import { enter, Skeleton } from "@/components/motion";
import { dayLabel, kindName, PlanView, toMin, useNow } from "@/components/plan-view";
import { Body, Button, Card, Display, Eyebrow, Icon, Screen, Small, Stat, Title } from "@/components/ui";
import { BATTERY_HINT } from "@/labels";
import { scheduleToday } from "@/notifications";
import { radius, space, TAB_SPACE, type, useColors } from "@/theme";

function greeting(h: number): string {
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** 还剩多少分钟 → 大号数字和单位：50 →「50 分钟后结束」，90 →「1 小时 30 分后结束」 */
function spanParts(min: number, tail: string): [number, string][] {
  if (min < 60) return [[min, `分钟${tail}`]];
  const h = Math.floor(min / 60), m = min % 60;
  return m ? [[h, "小时"], [m, `分${tail}`]] : [[h, `小时${tail}`]];
}

const EVENING = 19 * 60; // 这之后唯一的主按钮从「报电量」换成「对账」

export default function Today() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow();
  const c = useColors();
  const navigation = useNavigation();

  const load = useCallback(() => {
    getWeek().then(setWeek, () => {}); // 复盘入口和本周记录拿不到就不显示
    getMe().then(setMe, () => {});
    return getToday().then((p) => {
      setPlan(p);
      setError(null);
      scheduleToday(p.day, p.reminders ?? []).catch(() => {}); // 定不上提醒也不挡着看计划
    }, setError);
  }, []);

  // 每次回到这一页都重新拿：报完电量、对完账回来，看到的就是新计划。
  // 从提醒直接进报电量面板时，这页垫在下面、没有焦点，就在打开时先拿一次。
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (!navigation.isFocused()) load(); }, [load, navigation]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (error instanceof ApiError && error.status === 409) return <Redirect href="/onboarding" />; // 还没建档
  if (error && !plan) { // 已经有计划时，刷新失败就保留原来的，不整页换成「没连上」
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
  if (me && !me.consented) return <Redirect href="/consent" />; // 隐私说明换了新版本：老用户先看完再用

  // 一屏只有一个实心按钮：白天是报电量，19 点后或者今天的事都过完了是对账。
  // 今天的事都过完了就不再给报电量（后端会说「今天已经过完了」）。
  const canReport = plan.blocks.some((b) => toMin(b.end) > now);
  const checkinFirst = now >= EVENING || !canReport;
  const energy = () => router.push("/energy");
  const checkin = () => router.push("/checkin");
  const level = plan.energy_level;
  return (
    <Screen safeTop bottom={TAB_SPACE}
      refresh={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />}>
      <Animated.View entering={enter(0)} style={{ gap: 2 }}>
        <Small muted>{dayLabel(plan.day)}</Small>
        <Display>{greeting(Math.floor(now / 60) % 24)}</Display>
      </Animated.View>

      <Animated.View entering={enter(1)}><NowCard blocks={plan.blocks} now={now} /></Animated.View>

      <Animated.View entering={enter(2)} style={{ gap: space.xs }}>
        {checkinFirst
          ? <Button label="对个账" icon="moon-outline" onPress={checkin} />
          : <Button label="下课了，报个电量" icon="battery-half-outline" onPress={energy} />}
        {checkinFirst
          ? canReport && <Button label="还想报一下电量" variant="quiet" onPress={energy} />
          : <Button label="提前对账" variant="quiet" onPress={checkin} />}
      </Animated.View>

      <Animated.View entering={enter(3)} style={{ flexDirection: "row", gap: space.md }}>
        <Stat label="电量" value={level ?? "—"} unit={level ? "/ 5 格" : undefined}
          sub={level ? BATTERY_HINT[level] : "下课后报一下"} />
        {week && <Stat label="这 7 天" value={week.logged_days} unit="天" sub="留了晚间记录" />}
      </Animated.View>

      {week?.review && (
        <Card i={4} onPress={() => router.push("/review")} label="打开这周的复盘"
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Icon name="leaf-outline" size={22} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: c.text }]}>{week.review === "due" ? "可以复盘这一周了" : "这周的复盘"}</Text>
            <Small muted>大约 5 分钟。只看事实，不打分。</Small>
          </View>
          <Icon name="chevron-forward" size={18} color={c.muted} />
        </Card>
      )}

      <Eyebrow>{canReport ? "接下来" : "今天"}</Eyebrow>
      <PlanView plan={plan} now={now} showEnergy={false} fold />
    </Screen>
  );
}

/** 「此刻」卡片，一屏唯一的主角：最大的是还剩几分钟。空档里是离下一件还有多久；都过完了是还有几件等对账。 */
function NowCard({ blocks, now }: { blocks: Block[]; now: number }) {
  const c = useColors();
  const cur = blocks.find((b) => toMin(b.start) <= now && now < toMin(b.end));
  const next = blocks.find((b) => toMin(b.start) > now && b.kind !== "life");
  const items = blocks.filter((b) => b.kind !== "life").length;

  let head: string, time = "", big: [number, string][], sub = "", progress: number | null = null;
  if (cur) {
    head = `现在 · ${cur.title}`;
    time = `${cur.start}–${cur.end}`;
    big = spanParts(toMin(cur.end) - now, "后结束");
    sub = [kindName(cur), cur.pomodoros ? `番茄 ${cur.pomodoros} 个` : ""].filter(Boolean).join(" · ");
    progress = (now - toMin(cur.start)) / (toMin(cur.end) - toMin(cur.start));
  } else if (next) {
    head = `接下来 · ${next.title}`;
    time = `${next.start}–${next.end}`;
    big = spanParts(toMin(next.start) - now, "后开始");
    sub = kindName(next);
  } else {
    head = "今天的安排都走完了";
    big = items ? [[items, "件事"]] : [];
    sub = "花一两分钟对个账，就可以休息了。";
  }
  const after = cur && next ? next : null;
  const said = big.map(([n, u]) => `${n} ${u}`).join(" ");

  return (
    <View accessible accessibilityLabel={[head, time, said, sub, after && `接下来 ${after.start} ${after.title}`].filter(Boolean).join("，")}
      style={{ backgroundColor: c.card, borderRadius: radius.xl, borderWidth: 1, borderColor: c.edge, boxShadow: c.glow,
        padding: space.xl, gap: space.sm }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Text style={[type.small, { flex: 1, color: c.muted }]} numberOfLines={1}>{head}</Text>
        {time !== "" && <Text style={[type.small, type.num, { color: c.muted }]}>{time}</Text>}
      </View>
      {big.length > 0 && (
        <Text>
          {big.map(([n, u]) => (
            <Text key={u}>
              <Text style={[type.hero, { color: c.text }]}>{n}</Text>
              <Text style={[type.label, { color: c.muted }]}> {u} </Text>
            </Text>
          ))}
        </Text>
      )}
      {sub !== "" && <Text style={[type.small, { color: c.muted }]}>{sub}</Text>}
      {progress !== null && (
        <View style={{ height: 3, borderRadius: radius.pill, backgroundColor: c.hair, overflow: "hidden", marginTop: space.xs }}>
          <View style={{ width: `${Math.round(progress * 100)}%`, height: "100%", borderRadius: radius.pill, backgroundColor: c.primary }} />
        </View>
      )}
      {after && (
        <View style={{ flexDirection: "row", gap: space.sm, paddingTop: space.xs }}>
          <Text style={[type.small, { color: c.muted }]}>接下来</Text>
          <Text style={[type.small, type.num, { color: c.text }]}>{after.start}</Text>
          <Text style={[type.small, { color: c.text, flex: 1 }]} numberOfLines={1}>{after.title}</Text>
        </View>
      )}
    </View>
  );
}

function TodaySkeleton() {
  return (
    <Screen safeTop bottom={TAB_SPACE}>
      <Skeleton height={16} width={140} />
      <Skeleton height={36} width={180} />
      <Skeleton height={188} r={radius.xl} />
      <Skeleton height={52} r={radius.pill} />
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ flex: 1 }}><Skeleton height={104} r={radius.lg} /></View>
        <View style={{ flex: 1 }}><Skeleton height={104} r={radius.lg} /></View>
      </View>
    </Screen>
  );
}
