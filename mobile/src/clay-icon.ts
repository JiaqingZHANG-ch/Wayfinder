import type { Block } from "./api";

/** 黏土事件图标（assets/images/clay/ic-*.webp）。 */
export type ClayIcon = "class" | "eng" | "read" | "gym" | "proj" | "lunch" | "sleep";

// 按顺序匹配标题关键词，先中先得
const WORDS: [RegExp, ClayIcon][] = [
  [/睡/, "sleep"],
  [/饭|餐|吃/, "lunch"],
  [/路上/, "class"], // 路上只出现在「去 / 从某节课的路上」，跟着那节课
  [/英语|听力|单词|口语|外语|法语|日语|english/i, "eng"],
  [/书|阅读|读/, "read"],
  [/健身|运动|跑步|锻炼|游泳|瑜伽|散步|球/, "gym"],
  [/项目|报告|论文|作业|代码|写/, "proj"],
];
const BY_KIND: Record<Block["kind"], ClayIcon> = { class: "class", must: "read", proj: "proj", flex: "gym", life: "lunch" };

/** 一件事用哪个黏土图标：课一律用课本；其余先看标题关键词，匹配不到按 kind 兜底。 */
export function clayIcon(b: Pick<Block, "title" | "kind">): ClayIcon {
  if (b.kind === "class") return "class";
  return WORDS.find(([re]) => re.test(b.title))?.[1] ?? BY_KIND[b.kind];
}
