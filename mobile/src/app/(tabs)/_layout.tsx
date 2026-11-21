import { Tabs, type BottomTabBarProps } from "expo-router/tabs";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic, Pressy } from "@/components/motion";
import { Glass, Icon, IconName } from "@/components/ui";
import { motion, radius, space, type, useColors } from "@/theme";

/** 每个标签：未选中用线条图标，选中用实心图标。 */
const TABS: Record<string, { title: string; icon: IconName; on: IconName }> = {
  index: { title: "今天", icon: "sunny-outline", on: "sunny" },
  week: { title: "本周", icon: "leaf-outline", on: "leaf" },
  me: { title: "我", icon: "person-circle-outline", on: "person-circle" },
};

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}>
      {Object.entries(TABS).map(([name, t]) => <Tabs.Screen key={name} name={name} options={{ title: t.title }} />)}
    </Tabs>
  );
}

/** 浮在底部的玻璃标签栏：选中的那个有一块很淡的底，图标变实心。 */
function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const bottom = useSafeAreaInsets().bottom;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0,
      paddingBottom: Math.max(bottom, space.md), paddingHorizontal: space.lg, alignItems: "center" }}>
      <Glass style={{ width: "100%", maxWidth: 420, borderRadius: radius.pill }}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", padding: space.xs + 2 }}>
        {state.routes.map((route, i) => {
          const t = TABS[route.name];
          if (!t) return null;
          const on = state.index === i;
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
  );
}

function TabItem({ title, icon, on, onPress }: { title: string; icon: IconName; on: boolean; onPress: () => void }) {
  const c = useColors();
  const pill = useAnimatedStyle(() => ({ opacity: withTiming(on ? 1 : 0, { duration: motion.base }),
    transform: [{ scale: withTiming(on ? 1 : 0.8, { duration: motion.base }) }] }));
  return (
    <Pressy onPress={onPress} accessibilityRole="tab" accessibilityLabel={title} accessibilityState={{ selected: on }}
      scaleTo={0.92} style={{ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 2 }}>
      <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        borderRadius: radius.pill, backgroundColor: c.hair }, pill]} />
      <Icon name={icon} size={22} color={on ? c.text : c.muted} />
      <Text style={[type.small, { lineHeight: 16, fontWeight: on ? "600" : "400", color: on ? c.text : c.muted }]}>
        {title}
      </Text>
    </Pressy>
  );
}
