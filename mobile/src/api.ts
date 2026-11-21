import type { Status, VsPlan } from "./labels";

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
export type Reminder = { kind: "after_class" | "evening" | "letter"; at: string; title: string; body: string; url: string };

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
  later_reminders?: (Reminder & { day: string })[]; // 只有 GET /today 带：往后 6 天的
  goals?: Record<string, string>; // 只有 GET /today 带：习惯块 id → 它服务的目标原文
  checked_in?: boolean; // 只有 GET /today 带：今晚对过账没有
  tomorrow_task?: string | null; // 只有 GET /today 带：对账时写的「明天先做」
  checkin?: { items: Record<string, { status?: Status; vs_plan?: VsPlan }>; note: string | null; blocker: string | null } | null; // 只有 GET /today 带：今晚上次对账记的
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
export type Habit = { id?: string; title: string; minutes: number; floor_min: number; energy: Energy | null; source?: "self" | "deep_talk" | "invest"; goal_id?: number | null };
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
  const data = await res.json().catch(() => {
    if (res.ok) throw new Error("bad json");
    return { detail: "服务那边出了点问题，过一会儿再试。" };
  });
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
/** preview：只算不存（version 是 0），面板里点「就这样」时再正式报一次。 */
export const postEnergy = (level: number, preview = false) => send<Plan | Crisis>("POST", "/energy", { level, preview });
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
export type CheckinResult = { crisis: false; saved: { tomorrow_task?: string; items?: Record<string, { status?: Status }> }; closing: string }; // saved 是存下的整份对账
export const postCheckin = (body: CheckinBody) => send<CheckinResult | Crisis>("POST", "/checkin", body);

/** 深度长谈的一屏：kind 决定怎么画；question / hint / items / options 按 kind 有。和后端 deep_talk.STEPS 一致。 */
export type TalkScreen = {
  id: string;
  kind: "scores" | "open" | "follow" | "energy" | "version" | "council" | "rate" | "choose";
  question?: string;
  hint?: string;
  items?: string[];
  options?: string[]; // scores：可以跳过的项；follow：三个追问
};
export type CouncilResult = {
  lenses: { title: string; versions: { sees: string; unknown: string; test: string }[] }[]; // versions 按三个版本的顺序
  disagreement: string;
};
export type HabitProposal = {
  key: string; // "prototype" = 第 4 次的原型习惯；其余是「投资自己」的候选
  title: string;
  minutes: number;
  floor_min: number;
  when: string | null;
  why: string | null;
  source: "deep_talk" | "invest";
  status: "pending" | "accepted" | "declined";
};
/** GET /deep-talk 和其他长谈接口都回这个。step / screen 是 null = 这一轮聊完了。answers 的键是步数（字符串）。 */
export type DeepTalkState = {
  crisis: false;
  round: number;
  step: number | null;
  screen: string | null;
  steps: { step: number; name: string; status: "todo" | "doing" | "done" }[];
  screens: Record<string, { name: string; screens: TalkScreen[] }>;
  answers: Record<string, Record<string, unknown> & { profile_ids?: number[] }>;
  invite: boolean;
  snoozes: number;
  // crisis：智囊团的模型输出是危机，message 是固定的求助话术
  council: { status: "running" | "done" | "failed" | "crisis"; result: CouncilResult | null; message?: string } | null;
  active_goal_ids: number[]; // 「为了」和「我」页目标认的档案 id：第 4 次做完的最新一轮提出的
  proposals: { profiles: Profile[]; habits: HabitProposal[]; tomorrow: string | null };
  tonight_task: string | null;
  can_set_tomorrow: boolean; // 今晚对过账才能定明天的一件事
  habits_full: boolean;
  letter_ask: boolean; // 第 4 次做完、还没问过要不要给将来的自己写信
  energy_items: { id: string; title: string; kind: "habit" | "class" | "project"; energy: Energy | null }[];
  reply: string | null; // 只有答开放问题时有：导师的一句
  tomorrow_change?: { before: Block[]; after: Block[] }; // 只有第 3 次标完累不累、真改了时有：明天改前改后的计划
};
/** 这一步还有几张待确认的卡片：档案提议（「不要」过的后端已经去掉），第 4 次再加习惯和明天的一件事。 */
export function pendingCount(s: DeepTalkState, step: number) {
  const ids = s.answers[step]?.profile_ids ?? [];
  return s.proposals.profiles.filter((x) => ids.includes(x.id)).length
    + (step === 4 ? s.proposals.habits.filter((h) => h.status === "pending").length + (s.can_set_tomorrow && s.proposals.tomorrow ? 1 : 0) : 0);
}
export type TalkConfirm = { kind: "profile"; id: number } | { kind: "habit"; key: string } | { kind: "tomorrow" };

export const getProfile = () => send<{ confirmed: Profile[]; pending: Profile[] }>("GET", "/profile");
export const getDeepTalk = () => send<DeepTalkState>("GET", "/deep-talk");
export const answerDeepTalk = (step: number, screen: string, value: unknown) =>
  send<DeepTalkState | Crisis>("POST", "/deep-talk/answer", { step, screen, value });
export const snoozeDeepTalk = () => send<DeepTalkState>("POST", "/deep-talk/snooze", {});
export const startCouncil = () => send<DeepTalkState>("POST", "/deep-talk/council", {});
/** content 不填 = 原样。 */
export const confirmDeepTalk = (what: TalkConfirm, accept: boolean, content?: string) =>
  send<DeepTalkState | Crisis>("POST", "/deep-talk/confirm", { ...what, accept, content });
/** 给将来自己的信：sealed 没到期（只有日期）；open 到期了，带原文和这段时间的数字，done_days 是 null = 没有对应的习惯。 */
export type Letter = {
  id: number; written_on: string; due: string; days: 30 | 90; status: "sealed" | "open";
  text?: string; prototype?: string | null; logged_days?: number; done_days?: number | null; span_days?: number;
};
export const getLetters = () => send<{ letters: Letter[] }>("GET", "/letters");
export const postLetter = (days: 30 | 90, text: string) => send<{ letters: Letter[] } | Crisis>("POST", "/letters", { days, text });
export const declineLetter = () => send<DeepTalkState>("POST", "/letters/decline", {});
/** "2026-12-21" → "2026年12月21日" */
export const dayText = (d: string) => `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
/** 季度回顾：last 是上一次存的（没有就是 null）；available 为真才显示入口。 */
export type QuarterGoal = { text: string; check: string };
export type Quarter = {
  id: number; day: string; scores: Record<string, number>; focus: string; start: string; stop: string; keep: string; goals: QuarterGoal[];
};
export type QuarterIn = Omit<Quarter, "id" | "day"> & { extra_area?: string };
export const getQuarter = () => send<{ areas: string[]; available: boolean; days_used: number; last: Quarter | null }>("GET", "/quarter");
export const postQuarter = (q: QuarterIn) => send<Quarter | Crisis>("POST", "/quarter", q);
export const restartDeepTalk = () => send<DeepTalkState>("POST", "/deep-talk/restart", {});

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
