// 做事陪跑的自检：cd mobile && node --experimental-strip-types scripts/runs-check.mjs
import assert from "node:assert/strict";

import { doneItems, laterPreVs, pickNow, pomodoro } from "../src/runs.ts";

const b = (id, start, end, kind = "must", extra = {}) => ({ id, title: id, start, end, kind, task_id: null, pomodoros: null, ...extra });
const at = (hhmm) => `2026-11-20T${hhmm}:00+01:00`;
const ms = (hhmm) => Date.parse(at(hhmm));
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const run = (start, pauses = [], done = null) => ({ started_at: at(start), pauses: pauses.map(([f, t]) => [at(f), t && at(t)]), done_at: done && at(done), actual_min: null });

const read = b("read", "15:00", "16:00");
const report = b("report", "16:00", "17:00", "proj", { task_id: "r" });
const cls = b("cls", "17:00", "18:00", "class");
const blocks = [read, report, cls];

// 选哪一块：暂停着的优先（哪怕已经到了下一块的时间）；否则现在所在、没做完、能计时的；课不选
assert.equal(pickNow(blocks, { read: run("15:00", [["15:50", null]]) }, min("16:10"))?.id, "read");
assert.equal(pickNow(blocks, {}, min("16:10"))?.id, "report"); // 没点开始的现在这块
// 开始过、没点做完的优先于现在这块：过了结束才点「做完了」也记在对的那一块上
assert.equal(pickNow(blocks, { read: run("15:00") }, min("16:02"))?.id, "read");
assert.equal(pickNow(blocks, { report: run("16:00", [], "16:30") }, min("16:40")), null);
assert.equal(pickNow(blocks, {}, min("17:10")), null);
assert.equal(pickNow([b("item", "17:00", "18:00", "class", { item_id: "x" })], {}, min("17:10"))?.id, "item"); // 说的固定事项能计时

// 番茄：25 分钟专注 + 5 分钟小歇
assert.deepEqual(pomodoro(read, run("15:00"), ms("15:27")), { index: 1, total: 2, phase: "break", leftSec: 180, paused: false, pausedSec: 0 });
assert.deepEqual(pomodoro(read, run("15:00", [["15:10", "15:15"]]), ms("15:27")), { index: 1, total: 2, phase: "focus", leftSec: 180, paused: false, pausedSec: 0 });
assert.deepEqual(pomodoro(read, run("15:00", [["15:20", null]]), ms("15:26")), { index: 1, total: 2, phase: "focus", leftSec: 300, paused: true, pausedSec: 360 });
assert.deepEqual(pomodoro(read, run("15:00"), ms("16:10")), { index: 2, total: 2, phase: "break", leftSec: 0, paused: false, pausedSec: 0 });


// 对账预填：一件事今天所有块都做完才算
const items = [{ id: "read", title: "看书", project: false, tag: "", kind: "must" }, { id: "r", title: "写报告", project: true, tag: "", kind: "proj" }];
const two = [read, report, b("report-1", "18:00", "18:30", "proj", { task_id: "r" })];
assert.deepEqual([...doneItems(items, two, { read: run("15:00", [], "15:50"), report: run("16:00", [], "16:50") })], ["read"]);
assert.deepEqual([...doneItems(items, [read, report], { read: run("15:00", [], "15:50"), report: run("16:00", [], "16:50") })].sort(), ["r", "read"]);
assert.deepEqual([...doneItems(items, two, {})], []);
// 延长过（停了 10 分钟，15:00–16:10）：番茄个数按专注时长算，还是 2 个
assert.equal(pomodoro(b("read", "15:00", "16:10"), { ...run("15:00", [["15:10", "15:20"]]), planned_start: "15:00", planned_end: "16:00" }, ms("15:30")).total, 2);
// 评审：停 7 分钟、延长了 10 分钟——番茄个数按第一次点按钮时的计划起止（15:00–16:30，3 个）算
assert.equal(pomodoro(b("w", "15:00", "16:40"), { ...run("15:00", [["15:10", "15:17"]]), planned_start: "15:00", planned_end: "16:30" }, ms("15:20")).total, 3);
// 评审：继续时被课截住、块已经结束了，没点做完：没有别的能计时的块时，卡片还显示它
const early = b("early", "08:00", "09:00");
assert.equal(pickNow([early, b("cls2", "09:00", "10:00", "class")], { early: run("08:00", [["08:10", "09:30"]]) }, min("09:31"))?.id, "early");
// 评审：先填好的项目，「和预想比」那一屏不能被跳过（只往后找，不回头，免得「跳过」绕圈）
const st = [{ item: { id: "A" } }, { item: { id: "A" }, vs: true }, { item: { id: "P" }, vs: true }];
assert.equal(laterPreVs(st, 1, { A: { status: "done", vs_plan: "same" }, P: { status: "done" } }, new Set(["P"])), 2);
assert.equal(laterPreVs(st, 2, { A: { status: "done" }, P: { status: "done" } }, new Set(["P"])), -1);
assert.equal(laterPreVs(st, 1, { A: { status: "done" }, P: { status: "done", vs_plan: "less" } }, new Set(["P"])), -1);
console.log("runs-check ok");
