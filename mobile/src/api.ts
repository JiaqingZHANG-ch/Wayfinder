// 和后端（growth-mentor 的 serve.ps1，默认 http://127.0.0.1:8000）说话的地方。接口说明见后端的 /docs 页。
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type Block = {
  id: string;
  title: string;
  start: string; // "HH:MM"
  end: string;
  kind: "life" | "must" | "proj" | "flex" | "class"; // 生活 | 习惯 | 项目 | 可选 | 课
  task_id: string | null;
  pomodoros: number | null;
};

export type Plan = {
  day: string;
  version: number;
  confirmed: boolean;
  energy_level: number | null;
  blocks: Block[];
  warnings: string[];
  energy_used: number;
  energy_cap: number;
};

export type Week = { start: string; end: string; logged_days: number };

export type CheckinItem = { id: string; title: string; project: boolean };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(API_URL + path);
  const body = await res.json();
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`);
  return body as T;
}

export const getToday = () => getJson<Plan>("/today");
export const getWeek = () => getJson<Week>("/week");

// 循环 ④：在这里写 postCheckin(body)，用 fetch 发 POST /checkin（method、headers、body 照 /docs 里的写）

/** 今晚要对账的事项：习惯和可选项按块 id，项目按任务 id 只算一次。和后端 api.py 的 _items 一致。 */
export function checkinItems(plan: Plan): CheckinItem[] {
  const items = new Map<string, CheckinItem>();
  for (const b of plan.blocks) {
    if (b.kind === "must" || b.kind === "flex") items.set(b.id, { id: b.id, title: b.title, project: false });
    else if (b.kind === "proj" && b.task_id) items.set(b.task_id, { id: b.task_id, title: b.title, project: true });
  }
  return [...items.values()];
}
