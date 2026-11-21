/**
 * Wayfinder 的三样招牌画面（对标调研：docs/design.md 开头）：
 * Sky：页面顶上跟着时段变的天色；Arc：今天从第一件到上床的一道弧，小光点是现在；Glyph：每件事自己的记号。
 */
import { LinearGradient } from "expo-linear-gradient";
import { useId } from "react";
import { View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { Block } from "@/api";
import { skyTone, useColors, useDark } from "@/theme";

const SKY_HEIGHT = 460;

/** 页面背后的天色：顶上是时段的颜色，往下淡进底色；右上角一团柔光。不跟着内容滚。 */
export function Sky({ min }: { min: number }) {
  const c = useColors();
  const dark = useDark();
  const tone = skyTone(min, dark);
  const id = useId().replace(/:/g, "");
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: SKY_HEIGHT }}>
      <LinearGradient colors={[tone.top, c.bg]} locations={[0, 1]} style={{ position: "absolute", inset: 0 }} />
      <Svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <Defs>
          <RadialGradient id={`g${id}`} cx="82%" cy="6%" rx="70%" ry="55%" fx="82%" fy="6%">
            <Stop offset="0" stopColor={tone.glow} stopOpacity={dark ? 0.38 : 0.5} />
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
      {fill === "full" && <Path d={d} fill={color} />}
      {fill === "half" && <G clipPath={`url(#h${id})`}><Path d={d} fill={color} /></G>}
      {fill !== "full" && <Path d={d} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />}
    </Svg>
  );
}

// ---------- 今天的弧 ----------

const toMin = (t: string) => { const h = Number(t.slice(0, 2)); return (h < 4 ? h + 24 : h) * 60 + Number(t.slice(3, 5)); };

/**
 * 一道像太阳走过天空的弧：左端是今天第一件事开始，右端是最后一件结束。
 * 走过的那段亮起来，弧上每件正事一个记号，现在的位置一个发光的小点。done：今天收好了，整道弧都亮。
 */
export function Arc({ blocks, now, width, height = 120, done }: {
  blocks: Block[]; now: number; width: number; height?: number; done?: boolean;
}) {
  const c = useColors();
  const id = useId().replace(/:/g, "");
  if (!blocks.length || width <= 0) return null;
  const start = toMin(blocks[0].start);
  const end = Math.max(...blocks.map((b) => toMin(b.end)));
  const span = Math.max(1, end - start);
  const pad = 10;
  const rx = (width - pad * 2) / 2, ry = height - 22, cx = width / 2, base = height - 6;
  const at = (m: number) => {
    const t = Math.min(1, Math.max(0, (m - start) / span));
    return { x: cx - rx * Math.cos(Math.PI * t), y: base - ry * Math.sin(Math.PI * t), t };
  };
  const p = done ? at(end) : at(now);
  const full = `M${pad} ${base} A${rx} ${ry} 0 0 1 ${width - pad} ${base}`;
  const lit = p.t > 0 ? `M${pad} ${base} A${rx} ${ry} 0 0 1 ${p.x} ${p.y}` : "";
  const marks = blocks.filter((b) => b.kind !== "life");
  return (
    <Svg width={width} height={height}>
      <Defs>
        <RadialGradient id={`n${id}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={c.primary} stopOpacity={0.55} />
          <Stop offset="1" stopColor={c.primary} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Path d={full} stroke={c.line} strokeWidth={1.5} strokeDasharray="2 5" strokeLinecap="round" fill="none" />
      {lit !== "" && <Path d={lit} stroke={c.primary} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.9} />}
      {marks.map((b) => {
        const q = at(toMin(b.start));
        const past = done || toMin(b.end) <= now;
        return (
          <G key={b.id} x={q.x - 6} y={q.y - 6}>
            <Circle cx={6} cy={6} r={7} fill={c.bg} />
            <G opacity={past ? 0.55 : 1}>
              <GlyphPath name={b.title} star={b.task_id === "one-thing"} color={c.kind[b.kind]} filled={past} />
            </G>
          </G>
        );
      })}
      {!done && p.t > 0 && p.t < 1 && (
        <G>
          <Circle cx={p.x} cy={p.y} r={16} fill={`url(#n${id})`} />
          <Circle cx={p.x} cy={p.y} r={5} fill={c.primary} />
          <Circle cx={p.x} cy={p.y} r={2} fill={c.bg} />
        </G>
      )}
    </Svg>
  );
}

/** 弧上的小记号（12×12）：过去的实心，还没到的描边。 */
function GlyphPath({ name, star, color, filled }: { name: string; star?: boolean; color: string; filled: boolean }) {
  const d = SHAPES[star ? STAR : glyphIndex(name)];
  return (
    <G scale={0.75}>
      <Path d={d} fill={filled ? color : "none"} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </G>
  );
}
