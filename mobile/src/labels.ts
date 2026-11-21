// 对账按钮上的字（合并版设计 六）。键是后端认的值，值是给人看的字。
export const STATUS_LABELS = { done: "做了", floor: "做了保底", skip: "今天没做" } as const;
export const VS_PLAN_LABELS = { less: "比预想少", same: "差不多", more: "比预想多" } as const;

// 能量地图三选一（合并版设计 六之四 第 3 步），后端换算成消耗值：热爱 0、累但回血 0.5、擅长但耗能 1
export const ENERGY_LABELS = { love: "热爱", recharge: "累但回血", drain: "擅长但耗能" } as const;

export type Status =keyof typeof STATUS_LABELS;
export type VsPlan = keyof typeof VS_PLAN_LABELS;

// 电量 1–5 格各是什么感觉（下标就是格数，0 不用）
export const BATTERY_HINT = ["", "很累了", "有点累", "还行", "不错", "满格"] as const;
