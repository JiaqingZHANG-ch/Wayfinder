/**
 * Wayfinder 的设计令牌：有点温度的陪伴者——柔和、圆润、暖色纸感。
 * 规范见 docs/design.md。页面里不直接写颜色和数字，都从这里拿。
 * 每对「字 / 底」的对比度都 ≥ 4.5:1（WCAG AA），改色后要重新核对。
 */
import { Platform, useColorScheme } from "react-native";

const light = {
  bg: "#FAF6F0", // 暖纸色页面底
  card: "#FFFDF9",
  sunken: "#F3ECE2", // 输入框、未选中的块
  line: "#E8DFD3",
  text: "#2E2A26", // 13.2:1
  muted: "#6E655C", // 5.3:1
  primary: "#B4573A", // 陶土色；上面的白字 4.8:1
  onPrimary: "#FFFFFF",
  soft: "#F6E3D9", // 选中的柔和底
  onSoft: "#8A3F27", // 6.0:1
  danger: "#A63A32", // 6.0:1
  // 计划里每类事情的颜色：课、习惯、项目、可选、生活
  kind: { class: "#A39A8F", must: "#6F8F72", proj: "#5B7A99", flex: "#D9A441", life: "#E8DFD3" },
};

const dark: typeof light = {
  bg: "#1C1916",
  card: "#26221E",
  sunken: "#302A25",
  line: "#3D3631",
  text: "#F2ECE4", // 14.9:1
  muted: "#B3A99E", // 6.8:1
  primary: "#E3906F", // 上面用深色字 7.1:1
  onPrimary: "#1C1916",
  soft: "#4A3027",
  onSoft: "#F3C9B6", // 7.9:1
  danger: "#F0918A", // 6.9:1
  kind: { class: "#8C8379", must: "#8DAE90", proj: "#86A3C2", flex: "#E3B661", life: "#3D3631" },
};

export type Colors = typeof light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

// 只用系统字体（不打包十几 MB 的中文字体）：手机上不填 = 系统字体，网页给一串回退
const fontFamily = Platform.select({
  web: 'system-ui, -apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
});

// 中文正文行高约 1.6 倍，标题 1.3–1.4 倍；中文不用斜体、不加字距
export const type = {
  display: { fontFamily, fontSize: 28, lineHeight: 36, fontWeight: "700" },
  title: { fontFamily, fontSize: 20, lineHeight: 28, fontWeight: "600" },
  body: { fontFamily, fontSize: 16, lineHeight: 26, fontWeight: "400" },
  label: { fontFamily, fontSize: 15, lineHeight: 22, fontWeight: "500" },
  small: { fontFamily, fontSize: 13, lineHeight: 20, fontWeight: "400" },
} as const;

/** 当前配色：跟随系统的浅色 / 深色。 */
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
