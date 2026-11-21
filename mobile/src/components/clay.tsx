/**
 * 黏土舞台（v4 小样 .oil-ui/redesign2/explore/A-clay-town-v4.html 的 .stagebox / .fig / .bubble）。
 * 黏土全是图片（assets/images/clay/），这里只负责叠放和动。坐标照 v4 的 390×300 画布写，整块按屏宽等比缩放。
 * 常驻动效（呼吸、眨眼）在系统「减少动态效果」打开时停掉。
 */
import { Image, ImageSource } from "expo-image";
import { ReactNode, useEffect } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withSpring,
  withTiming,
} from "react-native-reanimated";

import type { ClayIcon } from "@/clay-icon";
import { MAX_WIDTH } from "@/components/ui";
import { skyTone, type, useColors } from "@/theme";

const W = 390;
const H = 300;
const FILL = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;

const IMG = {
  day: require("../../assets/images/clay/stage-day.webp"),
  night: require("../../assets/images/clay/stage-night.webp"),
  stoneOchre: require("../../assets/images/clay/stone-ochre.webp"),
  stoneGrey: require("../../assets/images/clay/stone-grey.webp"),
  battery: require("../../assets/images/clay/battery.webp"),
  shadow: require("../../assets/images/clay/fig-shadow.webp"),
  body: require("../../assets/images/clay/fig-body.webp"),
  head: require("../../assets/images/clay/fig-head.webp"),
  blink: require("../../assets/images/clay/fig-blink.webp"),
  nightBody: require("../../assets/images/clay/fig-night-body.webp"),
  nightHead: require("../../assets/images/clay/fig-night-head.webp"),
  nightBlink: require("../../assets/images/clay/fig-night-blink.webp"),
  sit: require("../../assets/images/clay/fig-sit.webp"),
};
// 表情 3 是头图自带的脸，其余四张叠在头上
const FACES: Record<number, ImageSource> = {
  1: require("../../assets/images/clay/fig-face1.webp"),
  2: require("../../assets/images/clay/fig-face2.webp"),
  4: require("../../assets/images/clay/fig-face4.webp"),
  5: require("../../assets/images/clay/fig-face5.webp"),
};
const ICONS: Record<ClayIcon, ImageSource> = {
  class: require("../../assets/images/clay/ic-class.webp"),
  eng: require("../../assets/images/clay/ic-eng.webp"),
  read: require("../../assets/images/clay/ic-read.webp"),
  gym: require("../../assets/images/clay/ic-gym.webp"),
  proj: require("../../assets/images/clay/ic-proj.webp"),
  lunch: require("../../assets/images/clay/ic-lunch.webp"),
  sleep: require("../../assets/images/clay/ic-sleep.webp"),
};

// 石子沿路摆：[中心 x, 中心 y, 宽]，第一颗在小人脚下（v4 的 PATH）
const PATH = [[92, 284, 56], [138, 244, 44], [172, 208, 38], [208, 173, 34], [244, 142, 30], [274, 114, 26]] as const;

/** 舞台：白天、夜里两张场景交叉淡入；stones 颗石子，一颗一件还没做的事，做完一件淡出一颗。children 叠在场景上（画布坐标）。 */
export function Stage({ night, stones, children }: { night: boolean; stones: number; children?: ReactNode }) {
  const s = Math.min(useWindowDimensions().width, MAX_WIDTH) / W;
  const nightIn = useAnimatedStyle(() => ({ opacity: withTiming(night ? 1 : 0, { duration: 800 }) }), [night]);
  return (
    <View style={{ height: H * s, overflow: "hidden", borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
      backgroundColor: skyTone(0, night).top }}>
      <View style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transformOrigin: "0 0", transform: [{ scale: s }] }}>
        <Image source={IMG.day} style={SCENE} />
        <Animated.View style={[SCENE, nightIn]}><Image source={IMG.night} style={FILL} /></Animated.View>
        {PATH.map(([x, y, w], i) => <Stone key={i} x={x} y={y} w={w} first={i === 0} on={i < stones} night={night} />)}
        {children}
      </View>
    </View>
  );
}
const SCENE = { position: "absolute", left: -70, bottom: 0, width: 460, height: (460 * 1032) / 1296 } as const;

function Stone({ x, y, w, first, on, night }: { x: number; y: number; w: number; first: boolean; on: boolean; night: boolean }) {
  const a = useAnimatedStyle(() => ({
    opacity: withTiming(on ? 1 : 0, { duration: 400 }),
    transform: [{ scale: withTiming(on ? 1 : 0.6, { duration: 400 }) }],
  }), [on]);
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: x - w / 2, top: y - w * 0.33, width: w, height: w },
      night && { filter: [{ brightness: 0.55 }] }, a]}>
      <Image source={first ? IMG.stoneOchre : IMG.stoneGrey} style={FILL} />
    </Animated.View>
  );
}

/** 一层图：on 时淡入，换姿势、换表情都靠两层交叉淡入。 */
function Fade({ on, ms = 260, children }: { on: boolean; ms?: number; children: ReactNode }) {
  const a = useAnimatedStyle(() => ({ opacity: withTiming(on ? 1 : 0, { duration: ms }) }), [on, ms]);
  return <Animated.View pointerEvents="none" style={[FILL, a]}>{children}</Animated.View>;
}
const Img = ({ src }: { src: ImageSource }) => <Image source={src} style={FILL} />;

/**
 * 小人：影子、身体、头、闭眼、表情分层叠放（同一画框 451×576，显示成 149×190）。
 * level 是电量 1–5：表情跟着换，1 格坐下；night 换提灯的夜间身体和头。
 * 常驻呼吸（4 秒，纵向 1 → 1.014）和眨眼（3–6 秒一次，120ms）。
 */
export function Figure({ level, night, left = 18, top = 106 }: { level?: number | null; night: boolean; left?: number; top?: number }) {
  const reduced = useReducedMotion();
  const pose = night ? "night" : level === 1 ? "sit" : "stand";
  const face = night ? 3 : level || 3;

  const breath = useSharedValue(0);
  const blink = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      cancelAnimation(breath);
      breath.set(0);
      return;
    }
    breath.set(withRepeat(withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }), -1, true));
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        blink.set(withSequence(withTiming(1, { duration: 0 }), withDelay(120, withTiming(0, { duration: 0 }))));
        next();
      }, 3000 + Math.random() * 3000);
    };
    next();
    return () => clearTimeout(t);
  }, [reduced, breath, blink]);

  const breathe = useAnimatedStyle(() => ({
    transform: [{ scaleX: 1 + 0.006 * breath.value }, { scaleY: 1 + 0.014 * breath.value }],
  }));
  // 累的时候头往右歪，很有劲时往左仰（转轴在脖子）
  const [rot, dy] = face === 1 || face === 2 ? [4, 2] : face === 5 ? [-3, -1] : [0, 0];
  const tilt = useAnimatedStyle(() => ({
    transform: [{ translateY: withSpring(dy, SOFT) }, { rotate: `${withSpring(rot, SOFT)}deg` }],
  }), [rot, dy]);
  const eyesOpen = useAnimatedStyle(() => ({ opacity: 1 - blink.value }));
  const eyesShut = useAnimatedStyle(() => ({ opacity: blink.value }));

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", left, top, width: 149, height: 190, zIndex: 5 }}>
      <View style={[FILL, pose === "sit" && { transform: [{ translateX: -7.5 }, { translateY: -4.75 }, { scaleX: 1.3 }] }]}>
        <Img src={IMG.shadow} />
      </View>
      <Animated.View style={[FILL, { transformOrigin: "50% 97%" }, breathe]}>
        <Fade on={pose === "stand"}><Img src={IMG.body} /></Fade>
        <Fade on={pose === "night"}><Img src={IMG.nightBody} /></Fade>
        <Animated.View style={[FILL, { transformOrigin: "55.2% 33.3%" }, tilt]}>
          <Fade on={pose === "stand"}>
            <Img src={IMG.head} />
            <Animated.View style={[FILL, eyesOpen]}>
              {[1, 2, 4, 5].map((k) => <Fade key={k} on={face === k} ms={180}><Img src={FACES[k]} /></Fade>)}
            </Animated.View>
            <Animated.View style={[FILL, eyesShut]}><Img src={IMG.blink} /></Animated.View>
          </Fade>
          <Fade on={pose === "night"}>
            <Img src={IMG.nightHead} />
            <Animated.View style={[FILL, eyesShut]}><Img src={IMG.nightBlink} /></Animated.View>
          </Fade>
        </Animated.View>
        <Fade on={pose === "sit"}><Img src={IMG.sit} /></Fade>
      </Animated.View>
    </View>
  );
}
const SOFT = { damping: 12, stiffness: 180 };

/** 导师的一句话：从小人头顶冒出来的实底气泡，字不压在场景上。top 是画布坐标（让出状态栏用）。 */
export function Bubble({ text, top = 54 }: { text: string; top?: number }) {
  const c = useColors();
  return (
    <View aria-live="polite" style={{ position: "absolute", left: 16, top, maxWidth: 300, paddingTop: 8, paddingBottom: 9,
      paddingHorizontal: 13, borderRadius: 14, backgroundColor: c.surface, zIndex: 6 }}>
      <View style={{ position: "absolute", left: 52, bottom: -7, width: 16, height: 16, borderRadius: 3,
        backgroundColor: c.surface, transform: [{ rotate: "45deg" }] }} />
      <Text style={[type.body, { fontSize: 16, lineHeight: 22, fontWeight: "800", color: c.text }]}>{text}</Text>
    </View>
  );
}

// 电池壳是一张 120×240 的图：上 34、左右 14、下 14 是不能拉的边（2x），中间只拉中段
const BAT = { w: 46, h: 232, top: 17, side: 7, bottom: 7 };

/**
 * 黏土电池（舞台右侧）。这一步是静态占位：显示报了几格，点一下打开报电量面板。拖动选档在任务 3 接。
 * shortcut: 三段拼出来的九宫格只拉竖向，横向整张压窄；任务 3 换成能拖的电池时一起做真九宫格。
 */
export function Battery({ level, onPress }: { level?: number | null; onPress: () => void }) {
  const c = useColors();
  const mid = BAT.h - BAT.top - BAT.bottom;
  const piece = (h: number, imgH: number, imgTop: number) => (
    <View style={{ height: h, overflow: "hidden" }}>
      <Image source={IMG.battery} style={{ position: "absolute", left: 0, top: imgTop, width: BAT.w, height: imgH }} contentFit="fill" />
    </View>
  );
  const sy = mid / (240 - 34 - 14); // 中段源图 192px 拉到 mid
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={level ? `电量 ${level} 格，点一下重新报` : "报个电量"}
      style={{ position: "absolute", left: 344 - BAT.w / 2, top: 280 - BAT.h, width: BAT.w, height: BAT.h, zIndex: 7 }}>
      {piece(BAT.top, 120, 0)}
      {piece(mid, 240 * sy, -34 * sy)}
      {piece(BAT.bottom, 120, BAT.bottom - 120)}
      <View pointerEvents="none" style={{ position: "absolute", left: BAT.side, right: BAT.side, top: BAT.top, bottom: BAT.bottom }}>
        {!!level && <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: (mid * level) / 5, borderRadius: 4,
          backgroundColor: c.primary }} />}
        {[1, 2, 3, 4].map((k) => (
          <View key={k} style={{ position: "absolute", left: "12%", right: "12%", top: (mid * k) / 5 - 1.5, height: 3, borderRadius: 2,
            backgroundColor: "rgba(255, 236, 200, 0.45)" }} />
        ))}
      </View>
    </Pressable>
  );
}

/** 一件事的黏土图标。 */
export function EventIcon({ icon, size = 32, dim }: { icon: ClayIcon; size?: number; dim?: boolean }) {
  return <Image source={ICONS[icon]} style={{ width: size, height: size, opacity: dim ? 0.8 : 1 }} />;
}
