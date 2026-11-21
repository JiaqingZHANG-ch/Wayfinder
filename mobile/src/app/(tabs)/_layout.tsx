import { Tabs, type BottomTabBarProps } from "expo-router/tabs";
import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic, Pressy } from "@/components/motion";
import { Glass, Icon, IconName } from "@/components/ui";
import { radius, space, type, useColors } from "@/theme";

/** 每个标签：未选中用线条图标，选中用实心图标。 */
const TABS: Record<string, { title: string; icon: IconName; on: IconName }> = {
  index: { title: "今天", icon: "sunny-outline", on: "sunny" },
  week: { title: "本周", icon: "leaf-outline", on: "leaf" },
  me: { title: "我", icon: "person-circle-outline", on: "person-circle" },
};
const PAD = space.xs + 2; // 标签栏内边距
const SLIDE = { damping: 26, stiffness: 320, overshootClamping: true }; // 选中底滑过去，不回弹

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: "fade" }}>
      {Object.entries(TABS).map(([name, t]) => <Tabs.Screen key={name} name={name} options={{ title: t.title }} />)}
    </Tabs>
  );
}

/** 浮在底部的玻璃标签栏：后面垫一层渐隐（内容滑到下面不会透出半截字），选中的那块底在标签之间滑动。 */
function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const c = useColors();
  const bottom = Math.max(useSafeAreaInsets().bottom, space.md);
  const [width, setWidth] = useState(0);
  const routes = state.routes.filter((r) => TABS[r.name]);
  const step = routes.length ? (width - PAD * 2) / routes.length : 0;
  const at = routes.findIndex((r) => r.key === state.routes[state.index].key);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring(Math.max(at, 0) * step, SLIDE) }] }), [at, step]);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
      {/* 渐隐：上面 45% 由透明到不透明分几层叠出来（不加渐变依赖），下面 55% 全不透明 */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 64 + PAD * 2 + bottom + space.md }}>
        {[0.15, 0.35, 0.6, 0.85].map((o) => <View key={o} style={{ flex: 1, backgroundColor: c.bg, opacity: o }} />)}
        <View style={{ flex: 5, backgroundColor: c.bg }} />
      </View>
      <View pointerEvents="box-none" style={{ paddingBottom: bottom, paddingHorizontal: space.lg, alignItems: "center" }}>
        <Glass style={{ width: "100%", maxWidth: 420, borderRadius: radius.pill }}>
          <View accessibilityRole="tablist" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            style={{ flexDirection: "row", padding: PAD }}>
            {step > 0 && (
              <Animated.View pointerEvents="none" style={[{ position: "absolute", top: PAD, bottom: PAD, left: PAD, width: step,
                borderRadius: radius.pill, backgroundColor: c.hair }, pill]} />
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
      <Text style={[type.small, { fontSize: 12, lineHeight: 16, fontWeight: on ? "600" : "400", color: on ? c.text : c.muted }]}>
        {title}
      </Text>
    </Pressy>
  );
}
