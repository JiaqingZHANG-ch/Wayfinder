import type { Block } from "./api";

/** 报电量前后，今晚变了的一件事：time 是新的开始时间，was 是原来的时长（只在时长变了时有）。 */
export type Change = { time: string; title: string; was?: string; now: string };

// 凌晨 4 点前算前一天（和 plan-view 的 toMin 一致），过了午夜的块才不会被当成过去
const min = (t: string) => { const h = Number(t.slice(0, 2)); return (h < 4 ? h + 24 : h) * 60 + Number(t.slice(3, 5)); };

/**
 * 比较重排前后 from 之后的安排，只列变了的：时长变了、挪了时间、新加的、今晚不排了的。吃饭路上这些生活块不算。
 * 同一件事拆成几块时按第几块对上。项目按 task_id，习惯和课按块 id（习惯换成保底版时标题会变，id 不变）。
 */
// shortcut: 同一件事拆成几块时按第几块配对，第一块被拿掉会错位成「时长变了」；常见了再按开始时间对齐
export function planDiff(before: Block[], after: Block[], from: string): Change[] {
  const dur = (b: Block) => min(b.end) - Math.max(min(b.start), min(from)); // 正在做的块只算 from 之后的部分
  const keyed = (bs: Block[]) => {
    const seen = new Map<string, number>();
    return bs.filter((b) => b.kind !== "life" && min(b.end) > min(from)).map((b) => {
      const k = b.task_id ?? b.id;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      return [`${k}#${n}`, b] as const;
    });
  };
  const old = new Map(keyed(before));
  const out: Change[] = [];
  for (const [k, b] of keyed(after)) {
    const o = old.get(k);
    old.delete(k);
    if (!o) out.push({ time: b.start, title: b.title, now: `新加 ${dur(b)} 分` });
    else if (dur(o) !== dur(b)) out.push({ time: b.start, title: b.title, was: `${dur(o)} 分`, now: `${dur(b)} 分` });
    else if (o.start !== b.start) out.push({ time: b.start, title: b.title, now: `挪到 ${b.start}` });
  }
  for (const o of old.values()) out.push({ time: o.start, title: o.title, now: "今晚不排了" });
  return out.sort((a, b) => a.time.localeCompare(b.time));
}
