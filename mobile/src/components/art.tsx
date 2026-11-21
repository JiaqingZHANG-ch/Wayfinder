/** 每件事的几何记号（Glyph）：设置、长谈、旧时间线还在用。今天、本周、对账用的是黏土图标（components/clay.tsx）。 */
import { useId } from "react";
import { View } from "react-native";
import Svg, { ClipPath, Defs, G, Path, Rect } from "react-native-svg";

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
      {fill === "full" && <Path d={d} fill={color} />}
      {fill === "half" && <G clipPath={`url(#h${id})`}><Path d={d} fill={color} /></G>}
      {/* 大记号的描边别跟着放大成粗框 */}
      {fill !== "full" && <Path d={d} fill="none" stroke={color} strokeWidth={1.4 * Math.min(1, 40 / size)} strokeLinejoin="round" />}
    </Svg>
  );
}
