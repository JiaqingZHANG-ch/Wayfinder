// 对账按钮上的字（合并版设计 六）。键是后端认的值，值是给人看的字。
export const STATUS_LABELS = { done: "做了", floor: "做了保底", skip: "今天没做" } as const;
export const VS_PLAN_LABELS = { less: "比预想少", same: "差不多", more: "比预想多" } as const;

export type Status = keyof typeof STATUS_LABELS;
export type VsPlan = keyof typeof VS_PLAN_LABELS;
