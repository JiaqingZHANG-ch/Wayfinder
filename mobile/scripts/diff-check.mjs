// 报电量前后对比的自检：cd mobile && node --experimental-strip-types scripts/diff-check.mjs
import assert from "node:assert/strict";

import { planDiff } from "../src/diff.ts";

const b = (id, title, start, end, kind = "must") => ({ id, title, start, end, kind, task_id: id, pomodoros: null });
const before = [
  b("eat", "晚饭", "17:55", "18:40", "life"),
  b("read", "看书", "18:40", "19:25"),
  b("listen", "英语听力", "19:30", "20:00"),
  b("egg", "EGG 报告", "20:00", "20:50", "proj"),
  b("egg", "EGG 报告", "21:00", "21:50", "proj"),
  b("old", "上午的课", "09:00", "10:00", "class"),
];
const after = [
  b("eat", "晚饭", "17:55", "18:40", "life"),
  b("read", "看书（保底）", "18:40", "18:55"),
  b("egg", "EGG 报告", "19:30", "20:20", "proj"),
  b("egg", "EGG 报告", "21:00", "21:50", "proj"),
  b("walk", "散步", "22:00", "22:20", "flex"),
  b("old", "上午的课", "09:00", "10:00", "class"),
];

assert.deepEqual(planDiff(before, after, "17:05"), [
  { time: "18:40", title: "看书（保底）", was: "45 分", now: "15 分" },
  { time: "19:30", title: "EGG 报告", now: "挪到 19:30" },
  { time: "19:30", title: "英语听力", now: "今晚不排了" },
  { time: "22:00", title: "散步", now: "新加 20 分" },
]);
assert.deepEqual(planDiff(before, before, "17:05"), []);
// 过了午夜的块不算过去；正在做的块只比 from 之后的部分
const late = [b("late", "收尾", "23:50", "00:20"), b("now", "EGG 报告", "23:00", "24:00", "proj")];
assert.deepEqual(planDiff(late, [late[0], b("now", "EGG 报告", "23:00", "23:50", "proj")], "23:40"), [
  { time: "23:00", title: "EGG 报告", was: "20 分", now: "10 分" },
]);
assert.deepEqual(planDiff(late, [late[1]], "23:40"), [{ time: "23:50", title: "收尾", now: "今晚不排了" }]);
// 习惯没有 task_id：按块 id 对上，换成保底版改了标题也算同一件
const habit = (title, start, end) => ({ id: "habit-1", title, start, end, kind: "must", task_id: null, pomodoros: null });
assert.deepEqual(planDiff([habit("看书", "18:40", "19:25")], [habit("看书（保底）", "18:25", "18:35")], "17:05"), [
  { time: "18:25", title: "看书（保底）", was: "45 分", now: "10 分" },
]);
console.log("diff-check ok");
