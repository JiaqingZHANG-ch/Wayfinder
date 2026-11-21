/**
 * Wayfinder 的设计令牌：「安静的仪表」——白天暖纸、夜里暖炭，细边实色卡片，玻璃只用在标签栏和底部面板。
 * 规范见 docs/design.md。页面里不直接写颜色和数字，都从这里拿。
 * 每对「字 / 底」的对比度都 ≥ 4.5:1（WCAG AA），改色后要重新核对。
 */
import { createContext, useContext, useEffect, useState } from "react";
import { AppState, Platform, TextStyle, useColorScheme } from "react-native";

const light = {
  bg: "#FAF6F0", // 暖纸色页面底
  card: "#FFFDF9",
  sunken: "#F3ECE2", // 输入框、未选中的块
  line: "#E8DFD3",
  edge: "rgba(46, 42, 38, 0.08)", // 卡片的发丝边
  hair: "rgba(46, 42, 38, 0.06)", // 极浅的填充：选中的标签、进度槽
  text: "#2E2A26", // 13.2:1
  muted: "#6E655C", // 5.3:1
  primary: "#B4573A", // 陶土色；上面的白字 4.8:1
  onPrimary: "#FFFFFF",
  soft: "#F6E3D9", // 选中的柔和底
  onSoft: "#8A3F27", // 6.0:1
  danger: "#A63A32", // 6.0:1
  ok: "#4F7A55", // 完成的绿；白字 4.9:1
  onWarm: "#2E2A26", // 琥珀色（kind.flex）上的字 6.3:1
  primaryTrack: "rgba(255, 255, 255, 0.28)", // 陶土色底上的进度槽、图标圆
  overlay: "rgba(46, 42, 38, 0.5)", // 底部面板后面的遮罩
  shadow: "0 1px 2px rgba(90, 58, 40, 0.05)",
  glow: "0 6px 24px rgba(90, 58, 40, 0.07)", // 「此刻」主卡片；深色里换成一圈陶土微光
  glass: "rgba(255, 252, 247, 0.94)", // 标签栏、底部面板在不支持液态玻璃时的半透明底
  glassEdge: "rgba(255, 255, 255, 0.75)",
  glassShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 10px 30px rgba(60, 40, 25, 0.12)",
  // 计划里每类事情的颜色：课、习惯、项目、可选、生活
  kind: { class: "#A39A8F", must: "#6F8F72", proj: "#5B7A99", flex: "#D9A441", life: "#C4B8AA" },
};

const dark: typeof light = {
  bg: "#1C1916",
  card: "#26221E",
  sunken: "#302A25",
  line: "#3D3631",
  edge: "rgba(255, 240, 225, 0.08)",
  hair: "rgba(255, 240, 225, 0.08)",
  text: "#F2ECE4", // 14.9:1
  muted: "#B3A99E", // 6.8:1
  primary: "#E3906F", // 上面用深色字 7.1:1
  onPrimary: "#1C1916",
  soft: "#4A3027",
  onSoft: "#F3C9B6", // 7.9:1
  danger: "#F0918A", // 6.9:1
  ok: "#8DBE93", // 上面用 onPrimary（深色字）8.3:1
  onWarm: "#1C1916",
  primaryTrack: "rgba(28, 25, 22, 0.18)",
  overlay: "rgba(0, 0, 0, 0.55)",
  shadow: "0 1px 2px rgba(0, 0, 0, 0.3)",
  glow: "0 0 0 1px rgba(227, 144, 111, 0.18), 0 0 40px rgba(227, 144, 111, 0.12)",
  glass: "rgba(40, 34, 29, 0.9)",
  glassEdge: "rgba(255, 240, 225, 0.12)",
  glassShadow: "inset 0 1px 0 rgba(255, 240, 225, 0.14), 0 10px 30px rgba(0, 0, 0, 0.4)",
  kind: { class: "#8C8379", must: "#8DAE90", proj: "#86A3C2", flex: "#E3B661", life: "#6A6058" },
};

export type Colors = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 } as const;

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
// 数字和英文用 Geist（根布局里 useFonts 加载）；每个字重是一个字体名，原生上不能靠 fontWeight 选
const geist = (w: "300Light" | "400Regular" | "500Medium") =>
  Platform.select({ web: `Geist_${w}, ${stack}`, default: `Geist_${w}` });
const tabular: TextStyle["fontVariant"] = ["tabular-nums"];

// 字号阶梯 13 / 14 / 16 / 20 / 28 / 44 / 64，字重只用 400 / 500 / 600。中文正文行高约 1.6 倍，不用斜体、不加字距。
// hero / big 是大号细字重的数字，一屏最多一个 hero。num 是给时间、计数用的数字字体（叠在别的字号上）。
export const type = {
  hero: { fontFamily: geist("300Light"), fontSize: 64, lineHeight: 68, letterSpacing: -1.5, fontVariant: tabular },
  big: { fontFamily: geist("300Light"), fontSize: 44, lineHeight: 48, letterSpacing: -0.8, fontVariant: tabular },
  stat: { fontFamily: geist("400Regular"), fontSize: 28, lineHeight: 34, fontVariant: tabular }, // 瓷砖里的数字
  display: { fontFamily, fontSize: 28, lineHeight: 36, fontWeight: "600" },
  title: { fontFamily, fontSize: 20, lineHeight: 28, fontWeight: "600" },
  body: { fontFamily, fontSize: 16, lineHeight: 26, fontWeight: "400" },
  label: { fontFamily, fontSize: 14, lineHeight: 22, fontWeight: "500" },
  small: { fontFamily, fontSize: 13, lineHeight: 19, fontWeight: "400" }, // 中文 12 号在手机上偏小，说明文字最小 13
  num: { fontFamily: geist("400Regular"), fontVariant: tabular },
} as const;

/** 21:00–6:00 算夜里：就算系统是浅色，也换成暖炭色，晚上对账不刺眼。 */
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
