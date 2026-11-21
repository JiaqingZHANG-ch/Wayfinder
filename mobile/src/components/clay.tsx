/**
 * 黏土舞台（v4 小样 .oil-ui/redesign2/explore/A-clay-town-v4.html 的 .stagebox / .fig / .bubble）。
 * 黏土全是图片（assets/images/clay/），这里只负责叠放和动。坐标照 v4 的 390×300 画布写，整块按屏宽等比缩放。
 * 常驻动效（呼吸、眨眼）在系统「减少动态效果」打开时、页面不在前台时停掉。
 */
import { Image, ImageSource } from "expo-image";
import { useIsFocused } from "expo-router";
import { ReactNode, useEffect } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import type { ClayIcon } from "@/clay-icon";
import { haptic } from "@/components/motion";
import { BATTERY_HINT } from "@/labels";
import { MAX_WIDTH, radius, type, useColors, useDark } from "@/theme";

const W = 390;
const H = 300;
const FILL = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;

const IMG = {
  day: require("../../assets/images/clay/stage-day.webp"),
  night: require("../../assets/images/clay/stage-night.webp"),
  stoneGrey: require("../../assets/images/clay/stone-grey.webp"),
  battery: require("../../assets/images/clay/battery.webp"),
  shadow: require("../../assets/images/clay/fig-shadow.webp"),
  body: require("../../assets/images/clay/fig-body.webp"),
  head: require("../../assets/images/clay/fig-head.webp"),
  blink: require("../../assets/images/clay/fig-blink.webp"),
  sit: require("../../assets/images/clay/fig-sit.webp"),
  walk: require("../../assets/images/clay/fig-walk.webp"),
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

// 石子沿路摆：[中心 x, 中心 y, 宽]，从小人前面一步起；全用灰石子（v4 脚下那颗赭石像一枚黄硬币，去掉了，脚下只留 fig-shadow 接触阴影）
const PATH = [[138, 244, 44], [172, 208, 38], [208, 173, 34], [244, 142, 30], [274, 114, 26]] as const;

/** 舞台：白天、夜里两张场景交叉淡入；stones 颗石子，一颗一件还没做的事，做完一件淡出一颗。children 叠在场景上（画布坐标）。 */
export function Stage({ night, stones, compact, children }: { night: boolean; stones: number; compact?: boolean; children?: ReactNode }) {
  const c = useColors();
  const { width, height } = useWindowDimensions();
  const full = Math.min(width, MAX_WIDTH);
  // compact 且屏矮（< 740）：整块（场景、石子、小人、电池、气泡）一起等比缩小，缩到场景图刚好铺满屏宽为止，左右不露底，
  // 画布居中对着场景图（场景图在画布 -70 到 390）。阶梯开着时页面不传 compact，回到原尺寸，每级仍是 44
  const s = compact && height < 740 ? Math.max(full / SCENE.width, 220 / H) : full / W;
  const left = s === full / W ? 0 : full / 2 - (SCENE.left + SCENE.width / 2) * s;
  const nightIn = useAnimatedStyle(() => ({ opacity: withTiming(night ? 1 : 0, { duration: 800 }) }), [night]);
  return (
    <View style={{ height: H * s, overflow: "hidden", borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card,
      backgroundColor: c.stage }}>
      <View style={{ position: "absolute", left, top: 0, width: W, height: H, transformOrigin: "0 0", transform: [{ scale: s }] }}>
        <Image source={IMG.day} style={SCENE} />
        <Animated.View style={[SCENE, nightIn]}><Image source={IMG.night} style={FILL} /></Animated.View>
        {PATH.map(([x, y, w], i) => <Stone key={i} x={x} y={y} w={w} on={i < stones} night={night} />)}
        {children}
      </View>
    </View>
  );
}
const SCENE = { position: "absolute", left: -70, bottom: 0, width: 460, height: (460 * 1032) / 1296 } as const;

function Stone({ x, y, w, on, night }: { x: number; y: number; w: number; on: boolean; night: boolean }) {
  const a = useAnimatedStyle(() => ({
    opacity: withTiming(on ? 1 : 0, { duration: 400 }),
    transform: [{ scale: withTiming(on ? 1 : 0.6, { duration: 400 }) }],
  }), [on]);
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: x - w / 2, top: y - w * 0.33, width: w, height: w },
      night && { filter: "brightness(0.55)" }, a]}>
      <Image source={IMG.stoneGrey} style={FILL} />
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
 * level 是电量 1–5：表情跟着换，1 格坐下。白天、夜里、收尾都是同一套母版图（材质统一）；night 只把整个人压暗一档。
 * 常驻呼吸（4 秒，纵向 1 → 1.014）和眨眼（3–6 秒一次，120ms）。onPress：点小人（今天页用来报电量）。
 */
export function Figure({ level, night, left = 18, top = 106, onPress }: {
  level?: number | null; night: boolean; left?: number; top?: number; onPress?: () => void;
}) {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const still = reduced || !focused; // 切到别的页面就不再呼吸、眨眼
  const pose = level === 1 ? "sit" : "stand";
  const face = level || 3;

  const breath = useSharedValue(0);
  const blink = useSharedValue(0);
  useEffect(() => {
    if (still) {
      cancelAnimation(breath);
      breath.set(0);
      blink.set(0);
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
  }, [still, breath, blink]);

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
    // 读屏不读小人：它能做的事气泡都能做
    <View pointerEvents={onPress ? "box-none" : "none"} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[{ position: "absolute", left, top, width: 149, height: 190, zIndex: 5 }, night && { filter: "brightness(0.75)" }]}>
      <View pointerEvents="none" style={[FILL, pose === "sit" && { transform: [{ translateX: -7.5 }, { translateY: -4.75 }, { scaleX: 1.3 }] }]}>
        <Img src={IMG.shadow} />
      </View>
      <Animated.View pointerEvents="none" style={[FILL, { transformOrigin: "50% 97%" }, breathe]}>
        <Fade on={pose === "stand"}><Img src={IMG.body} /></Fade>
        <Animated.View style={[FILL, { transformOrigin: "55.2% 33.3%" }, tilt]}>
          <Fade on={pose === "stand"}>
            <Img src={IMG.head} />
            <Animated.View style={[FILL, eyesOpen]}>
              {[1, 2, 4, 5].map((k) => <Fade key={k} on={face === k} ms={180}><Img src={FACES[k]} /></Fade>)}
            </Animated.View>
            <Animated.View style={[FILL, eyesShut]}><Img src={IMG.blink} /></Animated.View>
          </Fade>
        </Animated.View>
        <Fade on={pose === "sit"}><Img src={IMG.sit} /></Fade>
      </Animated.View>
      {onPress && <Pressable onPress={onPress} style={FILL} />}
    </View>
  );
}
const SOFT = { damping: 12, stiffness: 180 };

/**
 * 导师的一句话：从小人头顶冒出来的实底气泡（控件：平色块 + 4px 卡片底边），字不压在场景上。top 是画布坐标（让出状态栏用）；
 * hide：报电量开着阶梯时收起，不和阶梯叠在一起。onPress：气泡问了话就能点（今天页点了打开电量阶梯）。
 */
export function Bubble({ text, top = 54, hide, wide, onPress }: {
  text: string; top?: number; hide?: boolean; wide?: boolean; onPress?: () => void;
}) {
  const c = useColors();
  const a = useAnimatedStyle(() => ({ opacity: withTiming(hide ? 0 : 1, { duration: 200 }) }), [hide]);
  return (
    // wide：舞台右边没有电池时可以更宽；最多两行，不压到小人头顶
    <Animated.View aria-live="polite" pointerEvents={hide ? "none" : "auto"}
      style={[a, { position: "absolute", left: 16, top, maxWidth: wide ? W - 32 : 300, zIndex: 6 }]}>
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={text}
        style={{ minHeight: 44, justifyContent: "center", paddingTop: 8, paddingBottom: 9, paddingHorizontal: 13, borderRadius: radius.btn,
          backgroundColor: c.surface, boxShadow: `0 4px 0 ${c.cardEdge}` }}>
        <View style={{ position: "absolute", left: 52, bottom: -7, width: 16, height: 16, borderRadius: 3,
          backgroundColor: c.surface, transform: [{ rotate: "45deg" }] }} />
        <Text numberOfLines={2} style={[type.body, { fontSize: 16, lineHeight: 22, fontWeight: "500", color: c.text }]}>{text}</Text>
      </Pressable>
    </Animated.View>
  );
}

// 电池壳是一张 120×240 的图（2x）：上 34、左右 14、下 14 是不能拉的边，九宫格只拉中段；显示成 46×232，放在舞台右下
const SRC_X = [0, 14, 106, 120], DST_X = [0, 7, 39, 46];
const SRC_Y = [0, 34, 226, 240], DST_Y = [0, 17, 225, 232];
const BAT = { left: 321, top: 48, w: 46, h: 232 };
// 电池每档 = 阶梯每档 = 44（v4 的 H(L)）：第 L 档的「电」高 fillOf(L)，阶梯第 L 级的顶在 280 - 56 - (L-1)·44
const fillOf = (L: number) => (L ? 32 + (L - 1) * 44 : 0);
const levelOf = (h: number) => {
  "worklet";
  return Math.max(1, Math.min(5, Math.round((h - 32) / 44) + 1));
};
const FULL = fillOf(5);
const SPRING = { stiffness: 320, damping: 13 };

/**
 * 黏土电池（舞台右侧）和它的 5 级阶梯。
 * 点一下（动不到 8px）只开 / 关阶梯；按住上下拖按档吸附，每过一档震一下，小人跟着换表情（onLive）；
 * 松手或点阶梯的一级才算报了（onPick）。开着阶梯时舞台蒙一层，点蒙层收起，不报。
 * level：报过的格数；live：正在选的格数（阶梯开着或刚松手时）。
 */
export function Battery({ level, live, open, onOpen, onLive, onPick }: {
  level: number | null; live: number | null; open: boolean;
  onOpen: (open: boolean) => void; onLive: (n: number) => void; onPick: (n: number) => void;
}) {
  const c = useColors();
  const reduced = useReducedMotion();
  const shown = live ?? level ?? 0;
  const fill = useSharedValue(fillOf(shown));
  const start = useSharedValue(0);
  const cur = useSharedValue(0);
  const dragging = useSharedValue(false);

  useEffect(() => {
    if (!dragging.value) fill.set(reduced ? fillOf(shown) : withSpring(fillOf(shown), SPRING));
  }, [shown, reduced, fill, dragging]);

  const step = (n: number) => { haptic.select(); onLive(n); };
  const cancel = () => { fill.set(fillOf(level ?? 0)); onOpen(false); };
  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    onActivate: () => {
      dragging.set(true);
      start.set(Math.max(fill.value, fillOf(1)));
      cur.set(levelOf(start.value));
      scheduleOnRN(onOpen, true);
      scheduleOnRN(step, cur.value);
    },
    onUpdate: (e) => {
      let h = start.value - e.translationY;
      if (h > FULL) h = FULL + (h - FULL) * 0.3; // 拉过头：橡皮筋阻尼
      if (h < fillOf(1)) h = fillOf(1) - (fillOf(1) - h) * 0.3;
      fill.set(h);
      const n = levelOf(h);
      if (n !== cur.value) {
        cur.set(n);
        scheduleOnRN(step, n);
      }
    },
    onDeactivate: (e) => {
      dragging.set(false);
      if (e.canceled) { scheduleOnRN(cancel); return; } // 被系统打断（来电、手势被抢）不算报了
      const n = levelOf(fill.value);
      fill.set(reduced ? fillOf(n) : withSpring(fillOf(n), SPRING));
      scheduleOnRN(onPick, n);
    },
  });
  const tap = useTapGesture({ maxDistance: 8, onActivate: () => { scheduleOnRN(onOpen, !open); } });
  const gesture = useCompetingGestures(pan, tap);

  const core = useAnimatedStyle(() => ({ height: Math.max(0, fill.value) }));
  const veil = useAnimatedStyle(() => ({ opacity: withTiming(open ? 0.8 : 0, { duration: reduced ? 0 : 250 }) }), [open, reduced]);

  return (
    <>
      <Animated.View pointerEvents={open ? "auto" : "none"} style={[FILL, { zIndex: 4, backgroundColor: c.bg }, veil]}>
        <Pressable onPress={cancel} accessibilityRole="button" accessibilityLabel="先不报" style={FILL} />
      </Animated.View>
      {[5, 4, 3, 2, 1].map((n) => (
        <Rung key={n} n={n} on={shown === n} open={open} reduced={reduced} onPress={() => { step(n); onPick(n); }} />
      ))}
      <GestureDetector gesture={gesture}>
        <View accessible accessibilityRole="adjustable" accessibilityLabel="电量，点一下选，或按住上下拉"
          accessibilityValue={{ text: shown ? `${shown} 格，${BATTERY_HINT[shown]}` : "还没报" }}
          accessibilityActions={[{ name: "activate" }, { name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (actionName === "activate") onOpen(!open);
            else onPick(Math.max(1, Math.min(5, (shown || 2) + (actionName === "increment" ? 1 : -1))));
          }}
          style={{ position: "absolute", left: BAT.left, top: BAT.top, width: BAT.w, height: BAT.h, zIndex: 7, cursor: "grab" }}>
          {[0, 1, 2].flatMap((r) => [0, 1, 2].map((k) => {
            const sx = (DST_X[k + 1] - DST_X[k]) / (SRC_X[k + 1] - SRC_X[k]);
            const sy = (DST_Y[r + 1] - DST_Y[r]) / (SRC_Y[r + 1] - SRC_Y[r]);
            return (
              <View key={`${r}${k}`} style={{ position: "absolute", left: DST_X[k], top: DST_Y[r], overflow: "hidden",
                width: DST_X[k + 1] - DST_X[k], height: DST_Y[r + 1] - DST_Y[r] }}>
                <Image source={IMG.battery} contentFit="fill" style={{ position: "absolute", left: -SRC_X[k] * sx, top: -SRC_Y[r] * sy,
                  width: 120 * sx, height: 240 * sy }} />
              </View>
            );
          }))}
          <View pointerEvents="none" style={{ position: "absolute", left: DST_X[1], right: DST_X[1], top: DST_Y[1], bottom: DST_X[1] }}>
            <Animated.View style={[{ position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 4, overflow: "hidden",
              backgroundColor: c.primary, opacity: shown ? 0.92 : 0 }, core]}>
              {!!shown && <Text style={[type.num, { fontFamily: type.stat.fontFamily, fontSize: 22, lineHeight: 30, textAlign: "center",
                color: c.onPrimary }]}>{shown}</Text>}
            </Animated.View>
            {/* 刻痕：空电池也看得出能装 5 格 */}
            {[1, 2, 3, 4].map((k) => (
              <View key={k} style={{ position: "absolute", left: "12%", right: "12%", bottom: fillOf(k) - 1, height: 3, borderRadius: 2,
                backgroundColor: "rgba(255, 236, 200, 0.45)" }} />
            ))}
          </View>
        </View>
      </GestureDetector>
    </>
  );
}

/** 阶梯的一级：「3 正常」，对着电池里第 3 档的顶；选中的是主色底。收着时淡出、往右让 14。 */
function Rung({ n, on, open, reduced, onPress }: { n: number; on: boolean; open: boolean; reduced: boolean; onPress: () => void }) {
  const c = useColors();
  const a = useAnimatedStyle(() => ({
    opacity: withTiming(open ? 1 : 0, { duration: reduced ? 0 : 200 }),
    transform: [{ translateX: reduced ? 0 : withSpring(open ? 0 : 14, SPRING) }],
  }), [open, reduced]);
  return (
    <Animated.View pointerEvents={open ? "auto" : "none"} style={[{ position: "absolute", right: 78, top: 223 - (n - 1) * 44, height: 46,
      justifyContent: "center", zIndex: 6 }, a]}>
      {/* 可点区域 46 高（画布按 375 宽缩小后仍 ≥ 44，相邻两级重叠 2），看得见的药丸 32 高 */}
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
        accessibilityLabel={`${n} 格，${BATTERY_HINT[n]}`} accessibilityElementsHidden={!open}
        style={{ height: 46, justifyContent: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, height: 32, paddingHorizontal: 12, borderRadius: radius.pill,
          backgroundColor: on ? c.primary : c.surface, boxShadow: `0 4px 0 ${on ? c.primaryEdge : c.cardEdge}` }}>
          <Text style={[type.num, { fontFamily: type.stat.fontFamily, fontSize: 16, color: on ? c.onPrimary : c.primaryInk }]}>{n}</Text>
          <Text style={[type.label, { fontSize: 15, lineHeight: 20, color: on ? c.onPrimary : c.text }]}>{BATTERY_HINT[n]}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const BEANS = {
  brown: require("../../assets/images/clay/bean-brown.webp"),
  ochre: require("../../assets/images/clay/bean-ochre.webp"),
};
/** 一颗黏土豆（本周的夜豆、石子堆）：白天用深棕，夜里用赭石（v4 的 --stone-dark，两边对底都 ≥ 3:1）。 */
export function Bean({ night, w, h = w }: { night: boolean; w: number; h?: number }) {
  return <Image source={night ? BEANS.ochre : BEANS.brown} contentFit="fill" style={{ width: w, height: h }} />;
}

/** 一件事的黏土图标；没有合适的图标（icon 是 null）就不画。 */
export function EventIcon({ icon, size = 32 }: { icon: ClayIcon | null; size?: number }) {
  return icon && <Image source={ICONS[icon]} style={{ width: size, height: size }} />;
}

/**
 * 不在舞台上的小人（出错页、同意页、「我」页顶条）：和舞台上同一套分层图，按 height 等比缩小，在版面里正常占位。
 * level 同 Figure（1 是坐着歇会儿）；walk：本周页顶上那个走在路上的姿势（一张整图，不眨眼）。
 * night：压暗一档，默认跟深色模式；站在场景图上时跟场景走。
 */
export function Mascot({ level, height = 190, walk, night: scene }: {
  level?: number | null; height?: number; walk?: boolean; night?: boolean;
}) {
  const dark = useDark();
  const night = scene ?? dark;
  const k = height / 190;
  return (
    <View style={{ width: 149 * k, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: "absolute", left: 0, top: 0, width: 149, height: 190, transformOrigin: "0 0", transform: [{ scale: k }] }}>
        {walk ? (
          <View style={[FILL, night && { filter: "brightness(0.75)" }]}><Img src={IMG.shadow} /><Img src={IMG.walk} /></View>
        ) : <Figure level={level} night={night} left={0} top={0} />}
      </View>
    </View>
  );
}
