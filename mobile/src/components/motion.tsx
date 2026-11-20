/** 动效和触感：按下缩放、错峰入场、骨架屏、进度环、触感反馈。数值都在 theme.ts 的 motion 里。 */
import * as Haptics from "expo-haptics";
import { ReactNode, useEffect } from "react";
import { DimensionValue, Platform, Pressable, PressableProps, StyleProp, View, ViewStyle } from "react-native";
import Animated, {
  Easing, FadeInDown, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { motion, radius, useColors } from "@/theme";

const native = Platform.OS !== "web"; // 网页没有触感，直接跳过

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

/** 列表里第 i 个东西的入场：从下面淡入，一个接一个（最多错开 8 个，后面的不再等）。 */
export const enter = (i = 0) => FadeInDown.delay(Math.min(i, 8) * 45).duration(motion.slow).easing(Easing.out(Easing.cubic));

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

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** 进度环：value 0–1，出现时从 0 长到 value。中间放 children。 */
export function Ring({ value, size = 88, stroke = 9, color, children, label }: {
  value: number; size?: number; stroke?: number; color: string; children?: ReactNode; label: string;
}) {
  const c = useColors();
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withTiming(Math.max(0, Math.min(1, value)), { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [p, value]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - p.value) }));
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.sunken} strokeWidth={stroke} fill="none" />
        <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${len} ${len}`} animatedProps={props} />
      </Svg>
      {children}
    </View>
  );
}

/** 横向进度条：出现时从 0 长到 value（0–1）。用 flex 比例做，不用算像素宽度。 */
export function Bar({ value, color, height = 8 }: { value: number; color: string; height?: number }) {
  const c = useColors();
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withTiming(Math.max(0, Math.min(1, value)), { duration: 800, easing: Easing.out(Easing.cubic) }));
  }, [p, value]);
  const fill = useAnimatedStyle(() => ({ flexGrow: p.value }));
  const rest = useAnimatedStyle(() => ({ flexGrow: 1 - p.value }));
  return (
    <View style={{ flexDirection: "row", height, borderRadius: radius.pill, backgroundColor: c.sunken, overflow: "hidden" }}>
      <Animated.View style={[{ flexBasis: 0, backgroundColor: color, borderRadius: radius.pill }, fill]} />
      <Animated.View style={[{ flexBasis: 0 }, rest]} />
    </View>
  );
}
