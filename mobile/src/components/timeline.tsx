import { Text, View } from "react-native";

import { Block, DayItem } from "@/api";
import { fromMin, kindName, toMin } from "@/components/plan-view";
import { radius, space, type, useColors } from "@/theme";

/** 1 小时画 64px，块高按分钟正比。 */
export const HOUR = 64;
export const minToY = (min: number) => (min * HOUR) / 60;
const GUTTER = 52; // 左边刻度的宽
const MIN_H = 22; // 10 分钟的块也看得见一条

const span = (m: number) => (m < 60 ? `${m} 分钟` : m % 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m / 60} 小时`);

/**
 * 今天的竖向时间轴：左边整点刻度，右边按时间摆的圆角彩色块，现在那一刻画一条线。
 * 从第一块所在的整点画到最后一块结束后的整点；块之间不排列避让（排程本来不重叠，重叠的提示归下一步）。
 */
export function Timeline({ blocks, items, now }: { blocks: Block[]; items?: DayItem[]; now: number }) {
  const c = useColors();
  if (!blocks.length) return null;
  const from = Math.floor(Math.min(...blocks.map((b) => toMin(b.start))) / 60) * 60;
  const to = Math.ceil(Math.max(...blocks.map((b) => toMin(b.end))) / 60) * 60;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const guess = new Set(items?.filter((x) => x.estimated).map((x) => x.id));
  return (
    <View style={{ height: minToY(to - from) + 10, marginTop: space.xs }}>
      {hours.map((h) => (
        <View key={h} pointerEvents="none" style={{ position: "absolute", top: minToY(h - from), left: 0, right: 0,
          flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: -9 }}>
          <Text style={[type.small, type.num, { width: GUTTER - space.sm, lineHeight: 18, color: c.muted }]}>{fromMin(h)}</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
        </View>
      ))}
      {blocks.map((b) => (
        <TimelineBlock key={`${b.id}${b.start}`} b={b} top={minToY(toMin(b.start) - from)}
          height={minToY(toMin(b.end) - toMin(b.start))} estimated={!!b.item_id && guess.has(b.item_id)} />
      ))}
      {now >= from && now <= to && (
        <View accessible accessibilityLabel={`现在 ${fromMin(now)}`} pointerEvents="none"
          style={{ position: "absolute", top: minToY(now - from) - 4, left: GUTTER - 4, right: 0, flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: c.primaryEdge }} />
          <View style={{ flex: 1, height: 2, backgroundColor: c.primaryEdge }} />
        </View>
      )}
    </View>
  );
}

/**
 * 时间轴上的一块：位置和高度由外面给（top / height 是像素），自己只管长相。
 * 拖动、拉伸的手势加在这一层：外面包一层手势、改 top / height 就行。
 */
export function TimelineBlock({ b, top, height, estimated }: { b: Block; top: number; height: number; estimated: boolean }) {
  const c = useColors();
  const life = b.kind === "life";
  const minutes = toMin(b.end) - toMin(b.start);
  const h = Math.max(MIN_H, height - 2); // 相邻两块之间留 2px 缝
  const tall = h >= 44;
  const title = life ? b.title.split(/[：（]/)[0] : b.title;
  const sub = [`${b.start}–${b.end}`, !life && kindName(b)].filter(Boolean).join("  ");
  return (
    <View accessible accessibilityLabel={`${b.start} 到 ${b.end}，${kindName(b)}${b.title}，${span(minutes)}${estimated ? "，时长是估的" : ""}`}
      style={{ position: "absolute", top, left: GUTTER, right: 0, height: h, borderRadius: tall ? radius.btn : radius.in,
        backgroundColor: c.kind[b.kind], borderWidth: 1.5, borderColor: c.kindEdge[b.kind],
        paddingHorizontal: space.md, paddingVertical: tall ? space.sm : 0, justifyContent: tall ? "flex-start" : "center",
        flexDirection: tall ? "column" : "row", alignItems: tall ? "stretch" : "center", gap: tall ? 0 : space.sm, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 }}>
        <Text numberOfLines={1} style={[type.label, { flexShrink: 1, lineHeight: 18, fontWeight: life ? "500" : "700",
          color: life ? c.muted : c.text }]}>{title}</Text>
        {estimated && (
          <View style={{ paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: c.surface }}>
            <Text style={[type.small, { lineHeight: 17, color: c.muted }]}>估</Text>
          </View>
        )}
      </View>
      {(tall || !life) && h >= 30 && (
        <Text numberOfLines={tall ? 2 : 1} style={[type.small, type.num, { lineHeight: 17, color: c.muted, flexShrink: 1 }]}>{sub}</Text>
      )}
    </View>
  );
}
