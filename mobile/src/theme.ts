/**
 * Wayfinder 的设计令牌：「黏土小镇」（v4 小样 .oil-ui/redesign2/explore/A-clay-town-v4.html 的 :root）。
 * 材质只有两种说法：黏土 = 图片（assets/images/clay/）；控件 = 平色块，不描边、不叠模糊投影，
 * 厚度只靠一道实色底边 0 4px 0 <edge>（RN 0.88 的 boxShadow，web 和原生都认）。
 * 规范见 docs/design.md。页面里不直接写颜色和数字，都从这里拿。
 * 对比度：文字 ≥ 4.5:1，非文字 ≥ 3:1（WCAG AA）。下面注释里是实测值，改色后要重新核对。
 */
import { createContext, useContext, useEffect, useState } from "react";
import { AppState, Platform, TextStyle, useColorScheme } from "react-native";

type Palette = {
  bg: string; surface: string; surface2: string; tint: string; ink: string; ink2: string;
  primary: string; primaryEdge: string; onPrimary: string; primaryInk: string;
  done: string; mark: string; line: string; cardEdge: string; danger: string; ok: string; overlay: string;
  hi: string; // 卡片内高光
  stage: string; // 舞台场景图没盖到的那条天（v4 的 .stagebox 底色）
  kind: { class: string; must: string; proj: string; flex: string; life: string };
};

// 白天
const dayPalette: Palette = {
  bg: "#F8EEDD", // 奶油底
  surface: "#FFFAF1", // 卡片
  surface2: "#F3E6CF", // 次级面：未选的块、输入框
  tint: "#FCE6BD", // 被改动的行、选中的浅主色底
  ink: "#2E2216", // vs surface 14.9:1，vs bg 13.5:1，vs tint 12.7:1
  ink2: "#6A5038", // vs bg 6.5:1，vs surface 7.2:1，vs surface2 6.0:1，vs tint 6.1:1
  primary: "#EBAA3C", // 雨衣黄，只做填充（vs bg 1.8:1，不能当字和记号）
  primaryEdge: "#A3631A", // 主色控件的底边，也当主色的记号 / 边框：vs bg 4.2:1，vs surface 4.6:1，vs tint 4.0:1
  onPrimary: "#2A1606", // vs primary 8.5:1
  primaryInk: "#8A4B0B", // 主色的字：vs bg 5.9:1，vs surface 6.5:1，vs tint 5.6:1
  done: "#3F8A64", // 做了（记号）：vs surface 4.0:1
  mark: "#8E6E4C", // 没做 / 没记（记号）：vs surface 4.5:1，vs bg 4.1:1
  line: "#E7D8BF", // 分隔线，装饰性
  cardEdge: "#E2CFAE", // 卡片、次要按钮、标签栏的底边
  danger: "#A63A32", // 不刺眼的砖红：vs bg 5.6:1，vs surface 6.2:1；危险按钮上的 bg 色字 5.6:1
  ok: "#2F7A55", // 当字用的绿（done 当字不够 4.5）：vs surface 5.0:1，vs bg 4.5:1
  overlay: "rgba(46, 34, 22, 0.5)",
  hi: "rgba(255, 255, 255, 0.4)",
  stage: "#F7ECD9",
  kind: { class: "#A39A8F", must: "#6F8F72", proj: "#5B7A99", flex: "#D9A441", life: "#C4B8AA" },
};

// 夜里（也就是 App 的深色模式）：v4 的灰蓝石板夜色
const nightPalette: Palette = {
  bg: "#191C28",
  surface: "#252A3A",
  surface2: "#1F2331",
  tint: "#4A3A3E",
  ink: "#FBF3E4", // vs bg 15.4:1，vs surface 13.0:1，vs tint 9.7:1
  ink2: "#CBD1E0", // vs bg 11.1:1，vs surface 9.3:1，vs tint 7.0:1
  primary: "#F2B64C", // vs bg 9.4:1
  primaryEdge: "#B9761F", // vs bg 4.6:1，vs surface 3.9:1
  onPrimary: "#2A1606", // vs primary 9.5:1
  primaryInk: "#FFC766", // vs bg 11.0:1，vs surface 9.3:1，vs tint 6.9:1
  done: "#7FD1A6", // vs surface 7.9:1
  mark: "#9AA3BF", // vs surface 5.7:1，vs bg 6.8:1
  line: "#343A4E",
  cardEdge: "#6B7493", // 比面亮一档，像月光照到的边：vs bg 3.7:1
  danger: "#F0918A", // vs bg 7.4:1，vs surface 6.2:1；危险按钮上的 bg 色字 7.4:1
  ok: "#7FD1A6", // vs surface 7.9:1
  overlay: "rgba(0, 0, 0, 0.55)",
  hi: "rgba(255, 255, 255, 0.06)",
  stage: "#1B2033",
  kind: { class: "#8C8379", must: "#8DAE90", proj: "#86A3C2", flex: "#E3B661", life: "#6A6058" },
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
