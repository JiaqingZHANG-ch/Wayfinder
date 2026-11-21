import { Tabs, type BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EASE, haptic, Pressy } from "@/components/motion";
import { Glass, Icon, IconName } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

/** 每个标签：未选中用线条图标，选中用实心图标。 */
const TABS: Record<string, { title: string; icon: IconName; on: IconName }> = {
  index: { title: "今天", icon: "sunny-outline", on: "sunny" },
  week: { title: "本周", icon: "leaf-outline", on: "leaf" },
  me: { title: "我", icon: "person-circle-outline", on: "person-circle" },
};
const PAD = space.xs + 2; // 标签栏内边距
const SLIDE = { duration: 240, easing: EASE }; // 选中底滑过去：定时长，不靠弹簧硬停

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: "fade" }}>
      {Object.entries(TABS).map(([name, t]) => <Tabs.Screen key={name} name={name} options={{ title: t.title }} />)}
    </Tabs>
  );
}

/** 浮在底部的标签栏（平色块 + 卡片底边）：后面垫一层渐隐（内容滑到下面不会透出半截字），选中的那块浅主色底（带主色底边）在标签之间滑动。 */
function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const c = useColors();
  const bottom = Math.max(useSafeAreaInsets().bottom, space.md);
  const [width, setWidth] = useState(0);
  const routes = state.routes.filter((r) => TABS[r.name]);
  const step = routes.length ? (width - PAD * 2) / routes.length : 0;
  const at = routes.findIndex((r) => r.key === state.routes[state.index].key);
  const x = useSharedValue(-1);
  useEffect(() => {
    if (!step) return;
    const to = Math.max(at, 0) * step;
    x.set(x.value < 0 ? to : withTiming(to, SLIDE)); // 第一次量到宽度时直接落位：直接打开 /week 不会先停在「今天」
  }, [at, step, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(x.value, 0) }] }));
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
      {/* 渐隐：上面 45% 由透明到不透明分几层叠出来（不加渐变依赖），下面 55% 全不透明 */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 64 + PAD * 2 + bottom + space.md }}>
        {[0.15, 0.35, 0.6, 0.85].map((o) => <View key={o} style={{ flex: 1, backgroundColor: c.bg, opacity: o }} />)}
        <View style={{ flex: 5, backgroundColor: c.bg }} />
      </View>
      <View pointerEvents="box-none" style={{ paddingBottom: bottom, paddingHorizontal: space.lg, alignItems: "center" }}>
        <Glass style={{ width: "100%", maxWidth: 420, borderRadius: radius.card }}>
          <View accessibilityRole="tablist" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            style={{ flexDirection: "row", padding: PAD }}>
            {step > 0 && (
              <Animated.View pointerEvents="none" style={[{ position: "absolute", top: PAD, bottom: PAD, left: PAD, width: step,
                borderRadius: radius.btn, backgroundColor: c.tint, boxShadow: c.clayBtn }, pill]} />
            )}
            {routes.map((route, i) => {
              const t = TABS[route.name];
              const on = i === at;
              const go = () => {
                const e = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!on && !e.defaultPrevented) {
                  haptic.select();
                  navigateToTab(route.key);
                }
              };
              return <TabItem key={route.key} title={t.title} icon={on ? t.on : t.icon} on={on} onPress={go} />;
            })}
          </View>
        </Glass>
      </View>
    </View>
  );
}

function TabItem({ title, icon, on, onPress }: { title: string; icon: IconName; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressy onPress={onPress} accessibilityRole="tab" accessibilityLabel={title} accessibilityState={{ selected: on }}
      scaleTo={0.92} style={{ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 2 }}>
      <Icon name={icon} size={22} color={on ? c.text : c.muted} />
      <Text style={[type.small, { lineHeight: 16, fontWeight: on ? "700" : "400", color: on ? c.text : c.muted }]}>
        {title}
      </Text>
    </Pressy>
  );
}
