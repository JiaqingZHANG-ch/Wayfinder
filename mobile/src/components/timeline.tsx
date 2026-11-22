import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Block, DayItem, Run } from "@/api";
import { BlockSheet } from "@/components/block-sheet";
import { haptic } from "@/components/motion";
import { fromMin, kindName, toMin } from "@/components/plan-view";
import { radius, space, type, useColors } from "@/theme";

/** 1 小时画 64px，块高按分钟正比。 */
export const HOUR = 64;
export const minToY = (min: number) => (min * HOUR) / 60;
const GUTTER = 52; // 左边刻度的宽
const MIN_H = 22; // 10 分钟的块也看得见一条
const SNAP = 5; // 拖动、拉伸都吸附到 5 分钟
const MIN_MINUTES = 10; // 最短一块
const SPRING = { stiffness: 320, damping: 13 };

const span = (m: number) => (m < 60 ? `${m} 分钟` : m % 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m / 60} 小时`);

/** 自由时间：不画成卡片，留空白（参考图只画事情本身）。后端把它标成 life 块、标题以「自由时间」开头。 */
const isFree = (b: Block) => b.kind === "life" && b.title.startsWith("自由时间");
/** 能拖的：习惯、项目、可选（含会议），以及说出来的固定事项（kind 是 class 但带 item_id）。设置里的课和生活块不能动。 */
const movable = (b: Block) => b.kind === "must" || b.kind === "proj" || b.kind === "flex" || !!b.item_id;

/** 改完一块的结果：返回错误说明，成功是 null。 */
export type EditBlock = (b: Block, start: number, end: number, title?: string) => Promise<string | null>;

/**
 * 今天的竖向时间轴：左边整点刻度，右边按时间摆的圆角彩色块，现在那一刻画一条线。
 * 从第一块所在的整点画到最后一块结束后的整点；块之间不排列避让，时间撞在一起的块描一圈琥珀色边。
 * 可动的块：长按后上下拖改时间，拖底边小把手改时长，点一下开面板（时长、删除）。
 */
export function Timeline({ blocks, items, runs, now, onEdit, onDelete, onError }: {
  blocks: Block[]; items?: DayItem[]; runs?: Record<string, Run>; now: number; onEdit: EditBlock; onDelete: (b: Block) => Promise<string | null>;
  onError: (msg: string) => void; // 拖动、拉伸失败时把原因说在页面上
}) {
  const c = useColors();
  const saving = useRef(false); // 上一次改动的请求还没回来时，别的块先不让改（版本号还是旧的，会 409）
  const guarded: EditBlock = async (b, s, e) => {
    if (saving.current) return "上一处改动还没存好，稍等一下再拖。";
    saving.current = true;
    try { return await onEdit(b, s, e); } finally { saving.current = false; }
  };
  const [open, setOpen] = useState<string | null>(null); // 面板里那一块的 id
  const shown = blocks.filter((b) => !isFree(b));
  if (!shown.length) return null;
  // 只按画出来的块定起止：自由时间不画，也不该把时间轴撑到早上 7 点
  const from = Math.floor(Math.min(...shown.map((b) => toMin(b.start))) / 60) * 60;
  const to = Math.ceil(Math.max(...shown.map((b) => toMin(b.end))) / 60) * 60;
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const guess = new Set(items?.filter((x) => x.estimated).map((x) => x.id));
  // 两两比一下，时间有交叠的就是撞了（块不多，n² 没问题）
  const clash = new Set(shown.filter((a, i) => shown.some((o, j) => j !== i && toMin(a.start) < toMin(o.end) && toMin(o.start) < toMin(a.end))).map((b) => b.id));
  const panel = shown.find((b) => b.id === open);
  return (
    <View style={{ height: minToY(to - from) + 10, marginTop: space.xs }}>
      {hours.map((h) => (
        <View key={h} pointerEvents="none" style={{ position: "absolute", top: minToY(h - from), left: 0, right: 0,
          marginTop: -9 }}>
          <Text style={[type.small, type.num, { width: GUTTER - space.sm, fontSize: 12, lineHeight: 18, color: c.muted }]}>{fromMin(h)}</Text>
        </View>
      ))}
      {now >= from && now <= to && (
        <View accessible accessibilityLabel={`现在 ${fromMin(now)}`} pointerEvents="none"
          style={{ position: "absolute", top: minToY(now - from) - 4, left: GUTTER - 4, right: 0, flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: c.primaryEdge }} />
          <View style={{ flex: 1, height: 2, backgroundColor: c.primaryEdge }} />
        </View>
      )}
      {shown.map((b) => (
        <TimelineBlock key={`${b.id}${b.start}${b.end}`} b={b} top={minToY(toMin(b.start) - from)}
          height={minToY(toMin(b.end) - toMin(b.start))} estimated={!!b.item_id && guess.has(b.item_id)}
          drag={movable(b) ? { lo: from - toMin(b.start), hi: to - toMin(b.end), onEdit: guarded, onFail: onError, onOpen: () => setOpen(b.id) } : undefined}
          clash={clash.has(b.id)} done={!!runs?.[b.id]?.done_at} />
      ))}
      {panel && (
        <BlockSheet b={panel} onClose={() => setOpen(null)} onDelete={() => onDelete(panel)}
          onSave={(end, title) => onEdit(panel, toMin(panel.start), end, title)} />
      )}
    </View>
  );
}

type Drag = {
  lo: number; hi: number; // 往前、往后最多能挪几分钟（不出时间轴）
  onEdit: EditBlock; onFail: (msg: string) => void; onOpen: () => void;
};

/**
 * 时间轴上的一块：位置和高度由外面给（top / height 是像素）。
 * 有 drag 就能动：长按 200ms 再上下拖（不长按是滚页面），底边把手一碰就拉；都吸附到 5 分钟、每换一格一下触感。
 * 松手调 onEdit；失败就弹回原位。「减少动态效果」打开时跟手和弹回都直接落位。
 */
export function TimelineBlock({ b, top, height, estimated, drag, clash, done }: {
  b: Block; top: number; height: number; estimated: boolean; drag?: Drag; clash?: boolean; done?: boolean; // done：白天点过「做完了」
}) {
  const c = useColors();
  const reduced = useReducedMotion();
  const life = b.kind === "life";
  const start = toMin(b.start);
  const minutes = toMin(b.end) - start;
  const h = Math.max(MIN_H, height - 2); // 相邻两块之间留 2px 缝
  const tall = h >= 44;
  const title = life ? b.title.split(/[：（]/)[0] : b.title;
  const [live, setLive] = useState<[number, number] | null>(null); // 拖动中的新时间（起、止）
  const dy = useSharedValue(0); // 跟手的位移和增高（像素，已吸附）
  const dh = useSharedValue(0);
  const cur = useSharedValue(0); // 现在吸附到的分钟差
  const lo = useSharedValue(0);
  const hi = useSharedValue(0);
  useEffect(() => { lo.set(drag?.lo ?? 0); hi.set(drag?.hi ?? 0); }, [drag?.lo, drag?.hi, lo, hi]);

  const sub = live ? `${fromMin(live[0])}–${fromMin(live[1])}` : [`${b.start}–${b.end}`, !life && kindName(b)].filter(Boolean).join("  ");
  const follow = (v: typeof dy, px: number) => { "worklet"; v.set(reduced ? px : withSpring(px, SPRING)); };
  const tick = (ds: number, de: number) => { haptic.select(); setLive([start + ds, start + minutes + de]); };
  const reset = () => { setLive(null); dy.set(reduced ? 0 : withSpring(0, SPRING)); dh.set(reduced ? 0 : withSpring(0, SPRING)); };
  // 成功后块会拿新时间重新挂上（key 变了），失败或没动才在这里弹回
  const finish = async (ds: number, de: number) => {
    if (!drag || (!ds && !de)) return reset();
    const err = await drag.onEdit(b, start + ds, start + minutes + de);
    if (err) { haptic.tap(); drag.onFail(err); }
    reset();
  };
  const edit = (ds: number, de: number) => { haptic.tap(); finish(ds, de); }; // 读屏动作用

  const move = usePanGesture({
    activateAfterLongPress: 200,
    onActivate: () => { cur.set(0); scheduleOnRN(haptic.tap); },
    onUpdate: (e) => {
      const d = Math.min(hi.get(), Math.max(lo.get(), Math.round((e.translationY * 60) / HOUR / SNAP) * SNAP));
      if (d !== cur.get()) { cur.set(d); scheduleOnRN(tick, d, d); }
      follow(dy, minToY(d));
    },
    onDeactivate: (e) => { if (e.canceled) scheduleOnRN(reset); else scheduleOnRN(finish, cur.get(), cur.get()); },
  });
  const stretch = usePanGesture({
    activeOffsetY: [-4, 4],
    onActivate: () => { cur.set(0); },
    onUpdate: (e) => {
      const d = Math.min(hi.get(), Math.max(MIN_MINUTES - minutes, Math.round((e.translationY * 60) / HOUR / SNAP) * SNAP));
      if (d !== cur.get()) { cur.set(d); scheduleOnRN(tick, 0, d); }
      follow(dh, minToY(d));
    },
    onDeactivate: (e) => { if (e.canceled) scheduleOnRN(reset); else scheduleOnRN(finish, 0, cur.get()); },
  });
  const tap = useTapGesture({ maxDistance: 8, onActivate: () => { if (drag) scheduleOnRN(drag.onOpen); } });
  const body = useCompetingGestures(move, tap);
  const place = useAnimatedStyle(() => ({ transform: [{ translateY: dy.get() }], height: h + dh.get() }));

  const card = (
    <View accessible accessibilityRole={drag ? "button" : undefined}
      accessibilityLabel={`${b.start} 到 ${b.end}，${kindName(b)}${b.title}，${span(minutes)}${estimated ? "，时长是估的" : ""}${done ? "，已做完" : ""}${clash ? "，和别的事时间重叠" : ""}`}
      accessibilityActions={drag ? [
        { name: "activate", label: "打开，改时长或删除" },
        { name: "earlier", label: "提前 5 分钟" }, { name: "later", label: "推后 5 分钟" },
        { name: "longer", label: "加长 5 分钟" }, { name: "shorter", label: "缩短 5 分钟" },
      ] : undefined}
      onAccessibilityAction={drag ? (e) => {
        const n = e.nativeEvent.actionName;
        if (n === "activate") drag.onOpen();
        // 读屏动作也不能出时间轴、不能短于 10 分钟
        else if (n === "earlier" && drag.lo <= -SNAP) edit(-SNAP, -SNAP);
        else if (n === "later" && drag.hi >= SNAP) edit(SNAP, SNAP);
        else if (n === "longer" && drag.hi >= SNAP) edit(0, SNAP);
        else if (n === "shorter" && minutes - SNAP >= MIN_MINUTES) edit(0, -SNAP);
      } : undefined}
      // 参考图 1：浅色块不描边，矮块是胶囊；只有撞时间的才描一圈琥珀色
      style={{ flex: 1, borderRadius: Math.min(18, h / 2), backgroundColor: c.kind[b.kind],
        borderWidth: clash ? 2 : 0, borderColor: c.warn,
        paddingHorizontal: space.md, paddingVertical: tall ? space.sm : 0, justifyContent: "flex-start", // 矮块横排也靠左，和高块的标题对齐
        flexDirection: tall ? "column" : "row", alignItems: tall ? "stretch" : "center", gap: tall ? 0 : space.sm, overflow: "hidden",
        opacity: done ? 0.55 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 }}>
        <Text numberOfLines={1} style={[type.label, { flexShrink: 1, lineHeight: 18, fontWeight: life ? "500" : "700",
          color: life ? c.muted : c.text }]}>{done ? "✓ " : ""}{title}</Text>
        {estimated && (
          <View style={{ paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: c.surface }}>
            <Text style={[type.small, { lineHeight: 17, color: c.muted }]}>估</Text>
          </View>
        )}
      </View>
      {(tall || !life || live) && h >= 30 && (
        <Text numberOfLines={tall ? 2 : 1} style={[type.small, type.num, { lineHeight: 17, color: live ? c.text : c.muted,
          fontWeight: live ? "700" : "400", flexShrink: 1 }]}>{sub}</Text>
      )}
    </View>
  );
  return (
    <Animated.View style={[{ position: "absolute", top, left: GUTTER, right: 0, zIndex: live ? 5 : 0 }, place]}>
      {drag ? <GestureDetector gesture={body}>{card}</GestureDetector> : card}
      {drag && (
        // 底边把手：和身体并排（不嵌在手势里），免得两个拖动互相抢；块很矮时只占一半高
        <GestureDetector gesture={stretch}>
          <View accessible={false} importantForAccessibility="no" style={{ position: "absolute", left: 0, right: 0, bottom: 0,
            height: Math.min(20, h / 2), alignItems: "center", justifyContent: "flex-end", paddingBottom: 3 }}>
            {/* 矮块只留拉的地方、不画把手，免得压住标题 */}
            {tall && <View style={{ width: 24, height: 3, borderRadius: radius.pill, backgroundColor: c.kindEdge[b.kind], opacity: 0.5 }} />}
          </View>
        </GestureDetector>
      )}
    </Animated.View>
  );
}
