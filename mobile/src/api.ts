import type { Status } from "./labels";

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

/** 一条本地提醒：at 是当天的 "HH:MM"，url 是点开后去的页面。 */
export type Reminder = { kind: "after_class" | "evening"; at: string; title: string; body: string; url: string };

export type Plan = {
  day: string;
  version: number;
  confirmed: boolean;
  energy_level: number | null;
  blocks: Block[];
  warnings: string[];
  energy_used: number;
  energy_cap: number;
  reminders?: Reminder[]; // 只有 GET /today 带
  checked_in?: boolean; // 只有 GET /today 带：今晚对过账没有
  tomorrow_task?: string | null; // 只有 GET /today 带：对账时写的「明天先做」
  calendar?: "off" | "written" | "reconnect" | "failed"; // 只有确认计划时带：写「Wayfinder 计划」日历的结果
};

/** 近 7 天：每个习惯做了几天（含保底）；每个项目几天比预想少 / 差不多 / 多。 */
export type Week = {
  start: string;
  end: string;
  logged_days: number;
  logged: boolean[]; // start 到 end 每天一格：那晚对过账没有
  habits: { id: string; title: string; done_days: number; days: (Status | null)[] }[]; // days 同样按天
  projects: { id: string; title: string; less: number; same: number; more: number }[];
  review?: "due" | "today" | null;
};

/** 复盘里的一条调整：answer 是 null（还没点）、"好" 或 "先不改"。 */
export type Adjustment = {
  kind: "minutes" | "floor_min" | "add_habit";
  habit_id?: string;
  title?: string;
  value: number;
  why: string;
  answer: "好" | "先不改" | null;
};
export type Review = {
  crisis: false;
  id: number;
  week_end: string;
  summary: string;
  adjustments: Adjustment[];
  question: string; // 带进下周的问题，导师不回答
  last_question: string | null;
  still_right: (Profile & { question: string }) | null; // 「还对吗」：回答用 confirmProfile
};

// tag：标题上面那行小字；kind：记号的颜色；one：「昨晚定的一件事」（没有保底版）
export type CheckinItem = { id: string; title: string; project: boolean; tag: string; kind: Block["kind"]; one?: boolean };

export type Profile = { id: number; level: string; content: string; confirmed_at: string | null };

export type Crisis = { crisis: true; message: string };

export type OnboardingTurn =
  | Crisis
  | { crisis: false; done: boolean; reply: string | null; question: string | null; proposals?: Profile[] };

export type Energy = "love" | "recharge" | "drain";
export type Habit = { id?: string; title: string; minutes: number; floor_min: number; energy: Energy | null };
/** 每周课表里的一节课：weekday 0 = 星期一 … 6 = 星期日。 */
export type ClassItem = {
  title: string;
  weekday: number;
  start: string;
  end: string;
  where: "campus" | "other";
  energy: Energy | null;
};
export type Project = {
  id?: string;
  title: string;
  hours_left: number;
  deadline: string | null; // "YYYY-MM-DD"
  heavy: boolean;
  energy: Energy | null;
};
export type Settings = {
  wake: string;
  sleep: string;
  habits: Habit[]; // 已有的带着 id 送回去，对账历史才接得上
  timetable?: ClassItem[]; // 不填 = 不改
  projects?: Project[]; // 不填 = 不改
  reminders?: { after_class: boolean; evening: string | null }; // 不填用默认：下课提醒开、晚上 21:00
};

/** 国家决定危机提示显示哪国热线：CN / FR / ""（别的国家或不想说，两边都列）。 */
export type Country = "CN" | "FR" | "";
export type Me = {
  country: Country;
  is_adult: boolean | null;
  consented: boolean; // 同意过当前这一版隐私说明
  privacy: { version: string; text: string };
};

/** 后端回了错误：status 是 HTTP 状态码（比如 409 = 还没建档），message 是给人看的话。 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const OFFLINE = "没连上，网络好了再试一次。";
/** 给用户看的出错说明：后端说的人话原样给；断网这类原始错误（英文、系统的）只说没连上。 */
export const say = (e: unknown) => (e instanceof ApiError ? e.message : OFFLINE);

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
export const getMe = () => send<Me>("GET", "/me");
/** consent 不填 = 只改国家，不算同意。 */
export const putMe = (country: Country, is_adult: boolean, consent?: string) =>
  send<Me>("PUT", "/me", { country, is_adult, consent });
export const exportData = () => send<{ exported_at: string; tables: Record<string, object[]> }>("GET", "/export");
export const deleteMe = () => send<{ deleted: true }>("DELETE", "/me?confirm=true");
export const getReview = () => send<Review | Crisis>("POST", "/review", {});
export const answerAdjustment = (id: number, index: number, accept: boolean) =>
  send<Review>("POST", "/review", { id, index, accept });

/** 晚间对账：按钮的结果（result）或一句话（sentence）二选一。 */
export type CheckinBody =
  | { result: { items: Record<string, { status: string; vs_plan?: string }>; note?: string; blocker?: string; tomorrow_task?: string } }
  | { sentence: string };
export type CheckinResult = { crisis: false; saved: { tomorrow_task?: string }; closing: string }; // saved 是存下的整份对账
export const postCheckin = (body: CheckinBody) => send<CheckinResult | Crisis>("POST", "/checkin", body);

/** 今晚要对账的事项：习惯和可选项按块 id，项目按任务 id 只算一次。和后端 api.py 的 _items 一致。 */
export function checkinItems(plan: Plan): CheckinItem[] {
  const items = new Map<string, CheckinItem>();
  for (const b of plan.blocks) {
    if (b.kind === "must" || b.kind === "flex") {
      items.set(b.id, { id: b.id, title: b.title, project: false, tag: b.kind === "must" ? "习惯" : "可选", kind: b.kind });
    } else if (b.task_id === "one-thing") {
      items.set(b.task_id, { id: b.task_id, title: b.title, project: false, tag: "昨晚定的一件事", kind: b.kind, one: true });
    } else if (b.kind === "proj" && b.task_id) {
      items.set(b.task_id, { id: b.task_id, title: b.title, project: true, tag: "项目", kind: b.kind });
    }
  }
  return [...items.values()];
}

export const isCrisis = (x: object): x is Crisis => "crisis" in x && x.crisis === true;
