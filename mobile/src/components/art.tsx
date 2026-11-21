/**
 * Wayfinder 的招牌画面（对标调研：docs/design.md 开头）：
 * Sky：页面顶上的底色；Glyph：每件事自己的记号。今天页的弧已经换成黏土舞台（components/clay.tsx）。
 */
import { LinearGradient } from "expo-linear-gradient";
import { useId } from "react";
import { View } from "react-native";
import Svg, { ClipPath, Defs, G, LinearGradient as SvgLinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { skyTone, useColors, useDark } from "@/theme";

const SKY_HEIGHT = 460;

/** 页面背后的天色：顶上是时段的颜色，往下淡进底色；右上角一团柔光。不跟着内容滚。 */
export function Sky({ min }: { min: number }) {
  const c = useColors();
  const dark = useDark();
  const tone = skyTone(min, dark);
  const id = useId().replace(/:/g, "");
  // 太阳跟着时间从左往右走（6:00 → 24:00），和弧上的光点同一个方向；只在右边，不压页头的字
  const x = `${Math.round(60 + 28 * Math.min(1, Math.max(0, (min - 360) / 1080)))}%`;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: SKY_HEIGHT }}>
      <LinearGradient colors={[tone.top, tone.mid, c.bg]} locations={[0, 0.45, 1]} style={{ position: "absolute", inset: 0 }} />
      <Svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <Defs>
          <RadialGradient id={`g${id}`} cx={x} cy="2%" rx="26%" ry="22%" fx={x} fy="2%">
            <Stop offset="0" stopColor={tone.glow} stopOpacity={dark ? 0.55 : 0.8} />
            <Stop offset="0.35" stopColor={tone.glow} stopOpacity={dark ? 0.18 : 0.3} />
            <Stop offset="1" stopColor={tone.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#g${id})`} />
      </Svg>
    </View>
  );
}

// ---------- 记号 ----------

// 8 种几何记号，16×16 画布。由名字固定算出用哪一种：同一件事在时间线、对账、本周、设置里长一样。
const SHAPES = [
  "M8 1a7 7 0 1 0 0 14A7 7 0 1 0 8 1Z", // 圆
  "M4.5 1.5h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z", // 圆角方
  "M8 1l7 7-7 7-7-7Z", // 菱形
  "M8 1.5l7 12.5H1Z", // 三角
  "M1.5 14.5V8a6.5 6.5 0 0 1 13 0v6.5Z", // 拱门
  "M8 1l6.1 3.5v7L8 15l-6.1-3.5v-7Z", // 六边形
  "M8 1c3.5 4.2 6 7.2 6 9.5a6 6 0 0 1-12 0C2 8.2 4.5 5.2 8 1Z", // 水滴
  "M8 1q1.6 5.4 7 7-5.4 1.6-7 7-1.6-5.4-7-7 5.4-1.6 7-7Z", // 四角星
];
const STAR = 7;

export function glyphIndex(name: string): number {
  let h = 0;
  // 「看书（保底）」和「看书」是同一件事，记号要一样
  for (const ch of name.replace(/（保底）$/, "").trim()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % (SHAPES.length - 1); // 四角星留给「昨晚定的一件事」
}

/**
 * 一件事的记号。fill：full 实心（做了）、half 左半实心（保底）、empty 只描边（没做）、none 一个小点（那晚没记）。
 * star：「昨晚定的一件事」固定用四角星。
 */
export function Glyph({ name, color, size = 16, fill = "full", star, dim }: {
  name: string; color: string; size?: number; fill?: "full" | "half" | "empty" | "none"; star?: boolean; dim?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const d = SHAPES[star ? STAR : glyphIndex(name)];
  if (fill === "none") {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color, opacity: 0.6 }} />
      </View>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" opacity={dim ? 0.45 : 1}>
      {fill === "half" && (
        <Defs><ClipPath id={`h${id}`}><Rect x="0" y="0" width="8" height="16" /></ClipPath></Defs>
      )}
      {size >= 56 && fill !== "empty" && (
        <Defs>
          <SvgLinearGradient id={`l${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>
      )}
      {fill === "full" && <Path d={d} fill={color} />}
      {fill === "half" && <G clipPath={`url(#h${id})`}><Path d={d} fill={color} /></G>}
      {/* 大记号在填充上再叠一层上亮下暗的高光，像有体积；小记号不加 */}
      {size >= 56 && fill === "full" && <Path d={d} fill={`url(#l${id})`} />}
      {size >= 56 && fill === "half" && <G clipPath={`url(#h${id})`}><Path d={d} fill={`url(#l${id})`} /></G>}
      {/* 大记号的描边别跟着放大成粗框 */}
      {fill !== "full" && <Path d={d} fill="none" stroke={color} strokeWidth={1.4 * Math.min(1, 40 / size)} strokeLinejoin="round" />}
    </Svg>
  );
}

/** 一团柔光（径向渐变），垫在大记号、完成页后面。 */
export function Glow({ color, size, opacity }: { color: string; size: number; opacity: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <Svg width={size} height={size} style={{ position: "absolute" }} pointerEvents="none">
      <Defs>
        <RadialGradient id={`o${id}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} fill={`url(#o${id})`} />
    </Svg>
  );
}
