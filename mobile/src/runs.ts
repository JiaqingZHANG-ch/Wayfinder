import type { Block, CheckinItem, Run } from "./api";

// 做事陪跑的纯函数（不碰 React）：「现在」卡显示哪一块、番茄走到哪了。自检：node --experimental-strip-types scripts/runs-check.mjs

const POMODORO = 30 * 60; // 一个番茄：25 分钟专注 + 5 分钟小歇（秒）
const FOCUS = 25 * 60;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 能计时的块：习惯、项目、可选项和当天事项；课和吃饭不用（和后端 operable 一致）。 */
export function operable(b: Block): boolean {
  return b.kind === "must" || b.kind === "proj" || b.kind === "flex" || !!b.item_id;
}

const isPaused = (run: Run | undefined) => !!run && run.pauses.length > 0 && run.pauses[run.pauses.length - 1][1] === null;

/** 「现在」卡显示哪一块：暂停着没做完的优先（你是从它那里被打断的）；否则现在所在、没做完的那块；都没有就 null。 */
export function pickNow(blocks: Block[], runs: Record<string, Run>, nowMin: number): Block | null {
  const open = blocks.filter((b) => operable(b) && !runs[b.id]?.done_at);
  return open.find((b) => isPaused(runs[b.id]))
    ?? open.find((b) => toMin(b.start) <= nowMin && nowMin < toMin(b.end))
    ?? null;
}

/** 番茄走到哪了。没点过按钮（run 为空）就从计划开始时刻 startMs 算。专注时长超过整块后停在最后一个番茄的小歇末尾。 */
export function pomodoro(b: Block, run: Run | undefined, nowMs: number, startMs: number) {
  const pausedMs = (run?.pauses ?? []).reduce((s, [f, t]) => s + ((t ? Date.parse(t) : nowMs) - Date.parse(f)), 0);
  const open = isPaused(run) ? nowMs - Date.parse(run!.pauses[run!.pauses.length - 1][0]) : 0;
  // 继续时块往后延长过暂停的时长：番茄个数按专注时长（块长减去已经停完的那几段）算
  const total = Math.max(1, Math.ceil(((toMin(b.end) - toMin(b.start)) * 60_000 - (pausedMs - open)) / (POMODORO * 1000)));
  const focus = Math.max(0, Math.floor((nowMs - (run ? Date.parse(run.started_at) : startMs) - pausedMs) / 1000));
  const paused = isPaused(run);
  const pausedSec = Math.floor(open / 1000);
  if (focus >= total * POMODORO) return { index: total, total, phase: "break" as const, leftSec: 0, paused, pausedSec };
  const within = focus % POMODORO;
  const phase = within < FOCUS ? ("focus" as const) : ("break" as const);
  return { index: Math.floor(focus / POMODORO) + 1, total, phase, leftSec: (phase === "focus" ? FOCUS : POMODORO) - within, paused, pausedSec };
}

/** 晚上对账能先填成「做了」的事：这件事今天所有的块都点过「做完了」（块属于哪件事：块 id 或 task_id 就是事的 id）。 */
export function doneItems(items: CheckinItem[], blocks: Block[], runs: Record<string, Run>): Set<string> {
  return new Set(items.filter((it) => {
    const mine = blocks.filter((b) => b.id === it.id || b.task_id === it.id);
    return mine.length > 0 && mine.every((b) => !!runs[b.id]?.done_at);
  }).map((it) => it.id));
}
