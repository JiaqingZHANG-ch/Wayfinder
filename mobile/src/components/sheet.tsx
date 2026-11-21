/**
 * 底部面板：从下面弹上来，后面一层遮罩。点遮罩、点关闭、按住顶部往下拖都能关。
 * 用法：一个路由（presentation: "transparentModal"）整页就是一个 <Sheet>，关掉时回到上一页。
 * 不用 @gorhom/bottom-sheet：它和 reanimated 4 的兼容没确认，这里几十行就够。
 */
import { router } from "expo-router";
import { ReactNode, useCallback, useEffect } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { Glass } from "@/components/ui";
import { motion, radius, space, useColors } from "@/theme";

const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

export function Sheet({ children }: { children: (close: () => void) => ReactNode }) {
  const c = useColors();
  const bottom = useSafeAreaInsets().bottom;
  const { height } = useWindowDimensions();
  const y = useSharedValue(height);
  const fade = useSharedValue(0);
  const closing = useSharedValue(false); // 关的动画开始后，再点再拖都不管

  useEffect(() => {
    y.set(withSpring(0, motion.sheet));
    fade.set(withTiming(1, { duration: motion.base }));
  }, [y, fade]);

  const close = useCallback(() => {
    if (closing.get()) return;
    closing.set(true);
    fade.set(withTiming(0, { duration: motion.base }));
    y.set(withTiming(height, { duration: motion.base }, () => scheduleOnRN(leave)));
  }, [fade, y, height, closing]);

  const drag = usePanGesture({
    onUpdate: (e) => { if (!closing.get()) y.set(Math.max(0, e.translationY)); },
    onDeactivate: (e) => {
      if (closing.get()) return;
      if (e.translationY > 120 || e.velocityY > 900) scheduleOnRN(close);
      else y.set(withSpring(0, motion.sheet));
    },
  });

  const backdrop = useAnimatedStyle(() => ({ opacity: fade.value }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay }, backdrop]}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel="关闭" />
      </Animated.View>
      <Animated.View accessibilityViewIsModal style={[{ width: "100%", maxWidth: 560, alignSelf: "center", maxHeight: "92%" }, panel]}>
        <Glass style={{ borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderBottomWidth: 0,
          paddingHorizontal: space.lg, paddingBottom: bottom + space.lg, flexShrink: 1 }}>
        <GestureDetector gesture={drag}>
          <View style={{ alignItems: "center", paddingTop: space.sm, paddingBottom: space.md }}>
            <View style={{ width: 40, height: 5, borderRadius: radius.pill, backgroundColor: c.line }} />
          </View>
        </GestureDetector>
        {children(close)}
        </Glass>
      </Animated.View>
    </View>
  );
}
