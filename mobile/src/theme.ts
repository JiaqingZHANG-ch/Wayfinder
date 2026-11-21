/**
 * Wayfinder 的设计令牌：奶油底、暖橙头卡、青绿主按钮、彩色圆角任务块（2026-11-21「说一句话排今天」）。
 * 控件是平色块，不叠模糊投影，厚度只靠一道实色底边 0 4px 0 <edge>（RN 0.88 的 boxShadow，web 和原生都认）。
 * 规范见 docs/design.md。页面里不直接写颜色和数字，都从这里拿。
 * 对比度：文字 ≥ 4.5:1，非文字 ≥ 3:1（WCAG AA）。下面注释里是实测值（WCAG 2 公式算的），改色后要重新核对。
 */
import { createContext, useContext, useEffect, useState } from "react";
import { AppState, Platform, TextStyle, useColorScheme } from "react-native";

type Kinds = { class: string; must: string; proj: string; flex: string; life: string };
type Palette = {
  bg: string; surface: string; surface2: string; tint: string; ink: string; ink2: string;
  primary: string; primaryEdge: string; onPrimary: string; primaryInk: string;
  done: string; mark: string; line: string; cardEdge: string; danger: string; ok: string; warn: string; overlay: string;
  hi: string; // 卡片内高光
  stage: string; // 舞台场景图没盖到的那条天（v4 的 .stagebox 底色）
  head: string; onHead: string; // 今天页的暖橙头卡和上面的字
  kind: Kinds; // 时间轴上任务块的填充色（浅），上面写 ink / ink2
  kindEdge: Kinds; // 同色系的深一档：块的描边，也当这类事的记号（图标、进度条）
};

// 白天：奶油底、暖橙头卡、青绿主按钮（说一句话排今天，参考图 1）
const dayPalette: Palette = {
  bg: "#FFF6EA", // 奶油底
  surface: "#FFFDF8", // 卡片
  surface2: "#F6EADB", // 次级面：输入框、未选的块
  tint: "#DCEFEA", // 浅青绿：被改动的行、选中的底
  ink: "#3A2A1E", // 深棕：vs bg 12.8:1，vs surface 13.5:1，vs surface2 11.6:1，vs tint 11.5:1
  ink2: "#6B5444", // vs bg 6.6:1，vs surface 6.9:1，vs surface2 5.9:1，vs tint 5.9:1
  primary: "#1F7A73", // 青绿，主按钮填充：vs bg 4.8:1；vs head 2.9:1，所以头卡上的圆按钮带 primaryEdge 底边
  primaryEdge: "#155C56", // 主色控件的底边 / 记号：vs bg 7.3:1，vs head 4.4:1
  onPrimary: "#FFFFFF", // vs primary 5.1:1
  primaryInk: "#17635D", // 主色的字：vs bg 6.6:1，vs surface 6.9:1，vs tint 5.9:1
  done: "#2F7F5B", // 做了（记号）：vs surface 4.8:1
  mark: "#8A6F58", // 没做 / 没记（记号）：vs surface 4.6:1，vs bg 4.4:1
  line: "#EFE2CF", // 分隔线，装饰性
  cardEdge: "#EADBC4", // 卡片、次要按钮、标签栏的底边，装饰性（卡片靠里面的字认出来）
  danger: "#A63A32", // 不刺眼的砖红：vs bg 6.0:1，vs surface 6.3:1
  ok: "#2A7352", // 当字用的绿：vs surface 5.6:1，vs bg 5.3:1
  warn: "#A86400", // 琥珀，时间撞在一起的块描边（不用红）：vs bg 4.4:1，vs surface 4.6:1，vs 四种块填充 3.3–3.6:1（≥3:1）
  overlay: "rgba(58, 42, 30, 0.5)",
  hi: "rgba(255, 255, 255, 0.4)",
  stage: "#FFF1DE",
  head: "#F6B77C", // 暖橙头卡
  onHead: "#3A2A1E", // vs head 7.8:1（ink2 在橙上只有 4.0，头卡上的字一律用它）
  // 块上的字：ink vs 块 9.7–11.7:1，ink2 vs 块 5.0–6.0:1
  kind: { class: "#CFDDF8", must: "#D7E6DA", proj: "#FBD9B5", flex: "#F9CFD3", life: "#F4ECE1" }, // 蓝 灰绿 桃 粉 淡
  // 块边界 vs bg / vs surface：class 3.8 / 4.0，must 3.7 / 3.9，proj 3.5 / 3.7，flex 3.9 / 4.1，life 3.1 / 3.3
  kindEdge: { class: "#5F7FB8", must: "#5E8A69", proj: "#B87436", flex: "#B8636E", life: "#9A8A7A" },
};

// 夜里（也就是 App 的深色模式）：同一套暖色的暗版，深可可底
const nightPalette: Palette = {
  bg: "#1E1915",
  surface: "#2A231D",
  surface2: "#241E19",
  tint: "#1E3B38",
  ink: "#FBF1E4", // vs bg 15.6:1，vs surface 13.9:1，vs surface2 14.8:1，vs tint 10.8:1
  ink2: "#D4C5B3", // vs bg 10.3:1，vs surface 9.2:1，vs surface2 9.8:1，vs tint 7.2:1
  primary: "#5CC0B5", // vs bg 8.0:1，vs head 3.4:1
  primaryEdge: "#2F857C", // vs bg 4.0:1
  onPrimary: "#0F2725", // vs primary 7.2:1
  primaryInk: "#7FD8CE", // vs bg 10.5:1，vs surface 9.3:1，vs tint 7.3:1
  done: "#7FD1A6", // vs surface 8.5:1
  mark: "#A8988A", // vs surface 5.5:1，vs bg 6.2:1
  line: "#3A3029",
  cardEdge: "#4A3E34",
  danger: "#F0918A", // vs bg 7.6:1，vs surface 6.7:1
  ok: "#7FD1A6", // vs surface 8.5:1
  warn: "#F2B84B", // 琥珀：vs bg 9.7:1，vs surface 8.7:1，vs 四种块填充 5.8–6.3:1
  overlay: "rgba(0, 0, 0, 0.55)",
  hi: "rgba(255, 255, 255, 0.06)",
  stage: "#1B2033",
  head: "#7A4A27", // 暗橙头卡
  onHead: "#FBF1E4", // vs head 6.6:1
  // 块上的字：ink vs 块 9.2–13.7:1，ink2 vs 块 6.1–9.1:1
  kind: { class: "#2E3A55", must: "#2F4136", proj: "#553B27", flex: "#553136", life: "#2A241F" },
  // 块边界 vs bg / vs surface：class 7.4 / 6.6，must 8.0 / 7.1，proj 7.7 / 6.8，flex 7.3 / 6.5，life 4.4 / 3.9
  kindEdge: { class: "#8FA9E0", must: "#8DBB98", proj: "#D9A170", flex: "#DE939C", life: "#8C7E70" },
};

/** 新令牌加上旧名字（旧页面还在用，任务 2–4 换完再删）。clay 是卡片的整套厚度：内高光 + 实色底边。 */
const tokens = (p: Palette) => ({
  ...p,
  clay: `inset 0 2px 0 ${p.hi}, 0 4px 0 ${p.cardEdge}`,
  clayBtn: `0 4px 0 ${p.primaryEdge}`,
  // 旧名字 → 新值
  card: p.surface,
  sunken: p.surface2,
  edge: p.line,
  hair: p.line,
  text: p.ink,
  muted: p.ink2,
  soft: p.tint,
  onSoft: p.primaryInk,
  shadow: `inset 0 2px 0 ${p.hi}, 0 4px 0 ${p.cardEdge}`,
  glassEdge: "transparent", // 底部面板以前的发丝边：控件不描边
  glassShadow: `inset 0 2px 0 ${p.hi}`,
});

const light = tokens(dayPalette);
const dark = tokens(nightPalette);

export type Colors = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
// card / btn / in 是 v4 的三档；sm md lg xl 是旧名字，映射到最接近的一档
export const radius = { card: 20, btn: 14, in: 12, sm: 12, md: 14, lg: 20, xl: 24, pill: 999 } as const;


// 动效：按 Apple HIG 的弹簧手感（不回弹过头），时长 150–400ms；系统开了「减少动态效果」时 reanimated 自动跳过
export const motion = {
  fast: 160,
  base: 260,
  slow: 420,
  press: { damping: 20, stiffness: 400, mass: 0.6 }, // 按下缩放
  sheet: { damping: 24, stiffness: 260, mass: 0.9 }, // 面板滑入
} as const;

// 中文只用系统字体（不打包十几 MB 的中文字体）：手机上不填 = 系统字体，网页给一串回退
const stack = 'system-ui, -apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const fontFamily = Platform.select({ web: stack });
// 数字和英文用 Nunito 700 / 800 / 900（根布局里 useFonts 加载）；每个字重是一个字体名，原生上不能靠 fontWeight 选
const nunito = (w: "700Bold" | "800ExtraBold" | "900Black") =>
  Platform.select({ web: `Nunito_${w}, ${stack}`, default: `Nunito_${w}` });
const tabular: TextStyle["fontVariant"] = ["tabular-nums"];

// 字号阶梯 13 / 14 / 16 / 20 / 28 / 48 / 60。中文正文行高约 1.6 倍，不用斜体。
// 字重分层：Nunito 数字 900（hero、big）/ 800（stat）/ 700（num：时间、计数，叠在别的字号上）；
// 中文用系统字体 700（display 页标题、大卡标题）/ 600（title、按钮）/ 500（label：行标题、气泡）/ 400（body、small：正文和副行）。
// eyebrow 是区块顶上的小标签：小字、加字距、灰色。
export const type = {
  hero: { fontFamily: nunito("900Black"), fontSize: 60, lineHeight: 66, letterSpacing: -1.5 }, // 今天页「还剩 N 分钟」，一屏最多一个
  big: { fontFamily: nunito("900Black"), fontSize: 48, lineHeight: 56, letterSpacing: -0.5 },
  stat: { fontFamily: nunito("800ExtraBold"), fontSize: 34, lineHeight: 40 }, // 瓷砖、石子堆、电池里的数字
  display: { fontFamily, fontSize: 28, lineHeight: 36, fontWeight: "700" },
  title: { fontFamily, fontSize: 20, lineHeight: 28, fontWeight: "600" },
  body: { fontFamily, fontSize: 16, lineHeight: 26, fontWeight: "400" },
  label: { fontFamily, fontSize: 14, lineHeight: 22, fontWeight: "500" },
  small: { fontFamily, fontSize: 13, lineHeight: 19, fontWeight: "400" }, // 中文 12 号在手机上偏小，说明文字最小 13
  num: { fontFamily: nunito("700Bold"), fontVariant: tabular },
  eyebrow: { fontFamily, fontSize: 12, lineHeight: 16, fontWeight: "500", letterSpacing: 1.5 },
} as const;

/** 21:00–6:00 算夜里：就算系统是浅色，也换成石板夜色，晚上对账不刺眼。 */
const isNight = (d = new Date()) => d.getHours() >= 21 || d.getHours() < 6;
const Night = createContext(false);
export const NightProvider = Night.Provider;

/** 根布局用：打开 App、回到前台时看一次现在是不是夜里。正在用的时候不换，免得整屏突然闪一下。 */
export function useNightClock() {
  const [night, setNight] = useState(isNight);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") setNight(isNight()); });
    return () => sub.remove();
  }, []);
  return night;
}

/** 舞台用哪张场景：只看钟点（21:00–6:00 是夜景）。系统深色时中午还是白天的小镇，只有控件换深色。 */
export const useNightScene = () => useContext(Night);

/** 现在用深色吗：系统是深色，或者到了夜里。 */
export function useDark() {
  const night = useContext(Night);
  return useColorScheme() === "dark" || night;
}

/** 当前配色：白天跟随系统，夜里一律深色。 */
export function useColors(): Colors {
  return useDark() ? dark : light;
}

/** 底部标签栏占的高度（不含安全区）：标签页底部要留出这么多空，内容才不被挡住。 */
export const TAB_SPACE = 96;
export const MAX_WIDTH = 560; // 网页上内容不铺满，像一张纸
