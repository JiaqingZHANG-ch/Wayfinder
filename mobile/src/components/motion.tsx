/** 动效和触感：按下缩放、错峰入场、骨架屏、进度条、触感反馈。数值都在 theme.ts 的 motion 里。 */
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { DimensionValue, Platform, Pressable, PressableProps, StyleProp, View, ViewStyle } from "react-native";
import Animated, {
  Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming,
} from "react-native-reanimated";

import { motion, radius, useColors } from "@/theme";

const native = Platform.OS !== "web"; // 网页没有触感，直接跳过
/** 全 App 的减速曲线：快出慢停，不回弹。 */
export const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

/** 触感只用在三处：选了一个选项、完成一件事、整个流程做完。 */
export const haptic = {
  select: () => { if (native) Haptics.selectionAsync().catch(() => {}); },
  tap: () => { if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  success: () => { if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressyProps = Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle>; scaleTo?: number };

/** 按下轻轻缩一点、松开弹回。所有能点的块都用它，手感才一致。 */
export function Pressy({ style, scaleTo = 0.97, onPressIn, onPressOut, ...rest }: PressyProps) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable {...rest} style={[style, a]}
      onPressIn={(e) => { s.set(withSpring(scaleTo, motion.press)); onPressIn?.(e); }}
      onPressOut={(e) => { s.set(withSpring(1, motion.press)); onPressOut?.(e); }} />
  );
}

/**
 * 改入场动画的起始值（位移小一点、从 0.9 放大）。
 * shortcut: 网页版 Reanimated 4 的自定义入场动画结束后会把元素钉成 position:absolute（animationsManager 的 ENTERING 分支），
 * 整页叠在一起；所以网页上用默认起始值。Reanimated 修了再去掉这个判断。
 */
export function from<T extends { withInitialValues: (v: never) => T }>(b: T, values: object): T {
  return native ? b.withInitialValues(values as never) : b;
}

/** 列表里第 i 个东西的入场：从下面 12 淡入，一个接一个（每个晚 30ms，最多错开 5 个），整屏 450ms 内落定。 */
export const enter = (i = 0) =>
  from(FadeInDown.delay(Math.min(i, 5) * 30).duration(320).easing(EASE), { opacity: 0, transform: [{ translateY: 12 }] });

/** 读数据时的灰块，轻轻呼吸。 */
export function Skeleton({ height, width = "100%", r = radius.md }: { height: number; width?: DimensionValue; r?: number }) {
  const c = useColors();
  const o = useSharedValue(1);
  useEffect(() => {
    o.set(withRepeat(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height, width, borderRadius: r, backgroundColor: c.sunken }, a]} />;
}

/** 横向进度条：出现时从 0 长到 value（0–1）。用 flex 比例做，不用算像素宽度。 */
export function Bar({ value, color, height = 8, duration = 600 }: { value: number; color: string; height?: number; duration?: number }) {
  const c = useColors();
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withTiming(Math.max(0, Math.min(1, value)), { duration, easing: EASE }));
  }, [p, value, duration]);
  const fill = useAnimatedStyle(() => ({ flexGrow: p.value }));
  const rest = useAnimatedStyle(() => ({ flexGrow: 1 - p.value }));
  return (
    <View style={{ flexDirection: "row", height, borderRadius: radius.pill, backgroundColor: c.sunken, overflow: "hidden" }}>
      <Animated.View style={[{ flexBasis: 0, backgroundColor: color, borderRadius: radius.pill }, fill]} />
      <Animated.View style={[{ flexBasis: 0 }, rest]} />
    </View>
  );
}
