// 事件图标映射的自检：cd mobile && node --experimental-strip-types scripts/icon-check.mjs
import assert from "node:assert/strict";

import { clayIcon } from "../src/clay-icon.ts";

const cases = [
  ["统计软件", "class", "class"],
  ["英语课", "class", "class"], // 课一律是课本，不看关键词
  ["英语听力", "must", "eng"],
  ["看书（保底）", "must", "read"],
  ["健身", "flex", "gym"],
  ["EGG 报告", "proj", "proj"],
  ["午饭", "life", "lunch"],
  ["睡", "life", "sleep"],
  ["去统计软件的路上（按 20 分钟估，以实际为准）", "life", "class"],
  ["冥想", "must", "read"], // 匹配不到：按 kind 兜底
  ["新东西", "proj", "proj"],
  ["自由时间", "life", "lunch"],
];
for (const [title, kind, want] of cases) assert.equal(clayIcon({ title, kind }), want, `${title}（${kind}）`);
console.log(`icon-check ok：${cases.length} 条`);
