import { Href, Link, Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ApiError, getMe, getToday, getWeek, Me, Plan, Week } from "@/api";
import { Consent } from "@/components/consent";
import { dayLabel, PlanView } from "@/components/plan-view";
import { Body, Button, Card, Display, Loading, Screen, Small, Title } from "@/components/ui";
import { scheduleToday } from "@/notifications";
import { radius, space, type, useColors } from "@/theme";

function greeting(h: number): string {
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export default function Today() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [review, setReview] = useState<Week["review"]>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    getToday().then((p) => {
      setPlan(p);
      scheduleToday(p.day, p.reminders ?? []).catch(() => {}); // 定不上提醒也不挡着看计划
    }, setError);
    getWeek().then((w) => setReview(w.review), () => {}); // 复盘入口拿不到就不显示
    getMe().then(setMe, () => {});
  }, []);

  if (error instanceof ApiError && error.status === 409) return <Redirect href="/onboarding" />; // 还没建档
  if (error) {
    return (
      <Screen scroll={false} safeTop>
        <Title>没连上</Title>
        <Body muted>没拿到今天的计划：{error.message}。后端开着吗？</Body>
        <Button label="再试一次" variant="secondary" onPress={() => router.replace("/")} />
      </Screen>
    );
  }
  if (!plan) return <Loading text="正在排今天的计划……" safeTop />;
  if (me && !me.consented) {
    // 隐私说明换了新版本：老用户先看完再用
    return <Screen safeTop><Consent me={me} onDone={setMe} /></Screen>;
  }

  return (
    <Screen safeTop>
      <View style={{ gap: space.xs }}>
        <Small muted>{dayLabel(plan.day)}</Small>
        <Display>{greeting(new Date().getHours())}</Display>
      </View>

      {review && (
        <Pressable accessibilityRole="link" onPress={() => router.push("/review")}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <Card>
            <Title>{review === "due" ? "满 7 天了，来看看这一周" : "这周的复盘"}</Title>
            <Small muted>大约 5 分钟。只看事实，不打分。 →</Small>
          </Card>
        </Pressable>
      )}

      <View style={{ flexDirection: "row", gap: space.md }}>
        <Tile href="/energy" title="下课了" sub="报一下电量" />
        <Tile href="/checkin" title="晚间对账" sub="一两分钟" />
      </View>

      <PlanView plan={plan} />

      <View style={{ flexDirection: "row", justifyContent: "center", gap: space.xl }}>
        <FootLink href="/settings" label="设置" />
        <FootLink href="/data" label="我的数据" />
      </View>
    </Screen>
  );
}

function Tile({ href, title, sub }: { href: Href; title: string; sub: string }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${title}，${sub}`} onPress={() => router.push(href)}
      style={({ pressed }) => ({ flex: 1, minHeight: 96, borderRadius: radius.lg, backgroundColor: c.soft,
        padding: space.lg, justifyContent: "space-between", opacity: pressed ? 0.85 : 1 })}>
      <Text style={[type.title, { color: c.onSoft }]}>{title}</Text>
      <Text style={[type.small, { color: c.onSoft }]}>{sub} →</Text>
    </Pressable>
  );
}

function FootLink({ href, label }: { href: Href; label: string }) {
  const c = useColors();
  return (
    <Link href={href} style={[type.label, { color: c.primary, paddingVertical: space.md }]}>{label}</Link>
  );
}
