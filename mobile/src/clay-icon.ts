import type { Block } from "./api";

/** 黏土事件图标（assets/images/clay/ic-*.webp）。 */
export type ClayIcon = "class" | "eng" | "read" | "gym" | "proj" | "lunch" | "sleep";

// 按顺序匹配标题关键词，先中先得
const WORDS: [RegExp, ClayIcon][] = [
  [/睡/, "sleep"],
  [/饭|餐|吃/, "lunch"],
  [/英语|听力|单词|口语|外语|法语|日语|english/i, "eng"],
  [/书|阅读|读/, "read"],
  [/健身|运动|跑步|锻炼|游泳|瑜伽|散步|球/, "gym"],
  [/项目|报告|论文|作业|代码|写/, "proj"],
];
const BY_KIND: Record<Exclude<Block["kind"], "life">, ClayIcon> = { class: "class", must: "read", proj: "proj", flex: "gym" };

/**
 * 一件事用哪个黏土图标：课一律用课本；其余先看标题关键词，匹配不到按 kind 兜底。
 * 生活块只认吃饭和睡觉，去学校、回家这类没有合适的图标，返回 null（不画图标）。
 */
export function clayIcon(b: Pick<Block, "title" | "kind">): ClayIcon | null {
  if (b.kind === "class") return "class";
  const hit = WORDS.find(([re]) => re.test(b.title))?.[1];
  if (b.kind === "life") return hit === "lunch" || hit === "sleep" ? hit : null;
  return hit ?? BY_KIND[b.kind];
}
