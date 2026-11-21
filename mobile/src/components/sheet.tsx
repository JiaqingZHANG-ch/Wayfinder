/**
 * 底部面板：从下面滑上来，后面一层遮罩。点遮罩、点关闭、按住顶部往下拖都能关；拖的时候遮罩跟着变淡。
 * 用法：一个路由（presentation: "transparentModal"）整页就是一个 <Sheet>，关掉时回到上一页。
 * 面板里是大段文字，用实色卡片底（不用玻璃，免得透出后面的字）。
 * 不用 @gorhom/bottom-sheet：它和 reanimated 4 的兼容没确认，这里几十行就够。
 */
import { router } from "expo-router";
import { ReactNode, useCallback, useEffect } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, interpolate, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { haptic } from "@/components/motion";
import { radius, space, useColors } from "@/theme";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
const OPEN = { duration: 380, easing: Easing.bezier(0.32, 0.72, 0, 1) }; // iOS 系统面板的曲线，不冲过头
const SHUT = { duration: 220, easing: Easing.in(Easing.cubic) };

/** header：标题那一行，和把手一起都能按住往下拖（系统面板就是按住顶部任何地方都能拖）。 */
export function Sheet({ header, children, onClose }: {
  header?: (close: () => void) => ReactNode; children: (close: () => void) => ReactNode;
  onClose?: () => void; // 不是路由、而是页面里的 Modal 时：关完调它，不返回上一页
}) {
  const c = useColors();
  const bottom = useSafeAreaInsets().bottom;
  const { height } = useWindowDimensions();
  const y = useSharedValue(height);
  const fade = useSharedValue(0);
  const closing = useSharedValue(false); // 关的动画开始后，再点再拖都不管

  useEffect(() => {
    y.set(withTiming(0, OPEN));
    fade.set(withTiming(1, { duration: 260 }));
    haptic.tap();
  }, [y, fade]);

  const close = useCallback(() => {
    if (closing.get()) return;
    closing.set(true);
    fade.set(withTiming(0, SHUT));
    y.set(withTiming(height, SHUT, () => scheduleOnRN(onClose ?? leave)));
  }, [fade, y, height, closing, onClose]);

  const drag = usePanGesture({
    // 往下跟手；往上只给 0.2 倍的橡皮筋
    onUpdate: (e) => { if (!closing.get()) y.set(e.translationY > 0 ? e.translationY : e.translationY * 0.2); },
    onDeactivate: (e) => {
      if (closing.get()) return;
      if (e.translationY > 120 || e.velocityY > 900) scheduleOnRN(close);
      else y.set(withTiming(0, OPEN));
    },
  });

  const backdrop = useAnimatedStyle(() => ({
    opacity: fade.value * interpolate(y.value, [0, height * 0.6], [1, 0], "clamp"),
  }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay }, backdrop]}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel="关闭" />
      </Animated.View>
      <Animated.View accessibilityViewIsModal style={[{ width: "100%", maxWidth: 560, alignSelf: "center", maxHeight: "92%" }, panel]}>
        {/* 里面这层管「内容变多时平滑长高」，外面那层管滑入滑出：两种动画不放在同一个 View 上 */}
        <Animated.View layout={LinearTransition.duration(320).easing(Easing.bezier(0.2, 0.8, 0.2, 1))}
          style={{ flexShrink: 1, backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
            borderWidth: 1, borderBottomWidth: 0, borderColor: c.glassEdge, boxShadow: c.glassShadow,
            paddingHorizontal: space.lg, paddingBottom: bottom + space.lg }}>
        <GestureDetector gesture={drag}>
          <View style={{ paddingBottom: header ? space.lg : 0 }}>
            <View style={{ alignItems: "center", paddingTop: space.sm, paddingBottom: space.lg, marginHorizontal: -space.lg }}>
              <View style={{ width: 40, height: 5, borderRadius: radius.pill, backgroundColor: c.line }} />
            </View>
            {header?.(close)}
          </View>
        </GestureDetector>
        {children(close)}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
