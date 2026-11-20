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

export type Profile = { id: number; level: string; content: string; confirmed_at: string | null };

export type Crisis = { crisis: true; message: string };

export type OnboardingTurn =
  | Crisis
  | { crisis: false; done: boolean; reply: string | null; question: string | null; proposals?: Profile[] };

export type Energy = "love" | "recharge" | "drain";
export type Settings = {
  wake: string;
  sleep: string;
  habits: { title: string; minutes: number; floor_min: number; energy: Energy | null }[];
};

/** 后端回了错误：status 是 HTTP 状态码（比如 409 = 还没建档），message 是给人看的话。 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    // 422 的 detail 可能是字段错误的列表，取第一条的 msg
    const detail = typeof data.detail === "string" ? data.detail : data.detail?.[0]?.msg;
    throw new ApiError(res.status, detail ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const getToday = () => send<Plan>("GET", "/today");
export const getWeek = () => send<Week>("GET", "/week");
export const getSettings = () => send<Settings>("GET", "/settings");
export const putSettings = (s: Settings) => send<Settings | Crisis>("PUT", "/settings", s);
export const postOnboarding = (answer?: string) => send<OnboardingTurn>("POST", "/onboarding", { answer });
export const confirmProfile = (id: number, content?: string) =>
  send<{ confirmed: Profile[]; pending: Profile[] } | Crisis>("POST", "/profile/confirm", { id, content });
export const postEnergy = (level: number) => send<Plan | Crisis>("POST", "/energy", { level });
export const confirmPlan = (version: number) => send<Plan>("POST", "/plan/confirm", { version });

// 第 3 周循环 ④：在这里写 postCheckin(body)，照上面几行的样子调 send

/** 今晚要对账的事项：习惯和可选项按块 id，项目按任务 id 只算一次。和后端 api.py 的 _items 一致。 */
export function checkinItems(plan: Plan): CheckinItem[] {
  const items = new Map<string, CheckinItem>();
  for (const b of plan.blocks) {
    if (b.kind === "must" || b.kind === "flex") items.set(b.id, { id: b.id, title: b.title, project: false });
    else if (b.kind === "proj" && b.task_id) items.set(b.task_id, { id: b.task_id, title: b.title, project: true });
  }
  return [...items.values()];
}

export const isCrisis = (x: object): x is Crisis => "crisis" in x && x.crisis === true;
