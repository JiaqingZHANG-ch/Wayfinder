# 做事陪跑 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 白天每一块都有番茄倒计时，还有「被打断了 / 继续 / 做完了」三个按钮。继续时，停 ≤ 15 分钟就把后面的块往后推，停得更久就问要不要重排。晚上对账时，点过做完的自动填好。

**Architecture：**
- 后端新表 `block_runs` 记每一块的开始、各段暂停和做完时间。
- 新模块 `src/server/runs.py` 放纯函数：往后推、截短、专注时长、提醒，都不碰数据库，可以单独测。
- `api.py` 加三个接口，`/today` 多返回 `runs`。
- App 加一个纯函数模块 `mobile/src/runs.ts`（选哪一块、番茄进度）和「现在」卡组件。

**Tech Stack：** FastAPI + SQLite、pytest；Expo SDK 58 / React Native、TypeScript。

**Spec：** `docs/superpowers/specs/2026-11-22-block-runs-design.md`

## Global Constraints

- 分支 `block-runs`，每个任务单独提交，不推送、不合并。
- `POMODORO_MIN = 30`：25 分钟专注 + 5 分钟小歇。
- 小打断的分界是 `g ≤ 15` 分钟，等于 15 也算小打断。
- 能操作的块：`kind` 是 `must`、`proj`、`flex` 之一，或者带当天事项（`item_of(day, b)` 不为空）。
- 往后推时，`class` 和 `pinned` 的块不能挪。用户说的固定事项，求解器输出的就是 `class`，所以也不能挪。
- 推出来的块保留原来的 id 和 `pinned`。
- `free-` 开头的块被压到就剪短，剩下不足 `FREE_MIN_GAP`（30）分钟就删掉。
- 三个新接口都不带 version；块不在最新版里返回 404，块不能操作返回 422，状态不对返回 409。
- 时间一律用 `clock()` 给的、带时区的时间。计划时间换成时刻：逻辑日 `day` 的日期 + 块的 HH:MM，用 `clock()` 的时区。
- 原来那一版已确认的话，新版本也存成已确认；`in_calendar` 不跟着带过来，日历不重写。
- 提醒只算今天的，新加两种 kind：`block`、`pomodoro`，`url` 都是 `"/"`。
- `PRIVACY_VERSION` 改成 `"隐私说明-v5"`。
- 文案不写「又被打断了」「落后了」这类话。
- 测试命令：
  - `uv run pytest -q -p no:cacheprovider --basetemp=C:/Users/29377/AppData/Local/Temp/claude/32a5d6882ad6316a/010d2d7c-ae29-417f-9445-f71b9334b65d/scratchpad/pt`
  - `cd mobile && npx tsc --noEmit && npx expo lint --no-cache`
  - `git diff --check`
- Python 源码里有反斜杠时用 Edit 或 Write 工具写，不要用 bash heredoc（这里的 heredoc 会吃掉反斜杠）。

## Review Focus

1. **App 关掉再打开，或者跨过一次重排**：暂停中的块要照样显示「继续」，倒计时位置不能错。runs 按 block_id 记，重排会保留已经开始的块。测试放在 Task 3 的 `test_runs_survive_reflow`。
2. **暂停到块的计划结束时间以后才回来**（停了 40 分钟，而块只排了 30 分钟）：继续时这一块照样延长，并且问要不要重排，不能报错。测试是 Task 3 的 `test_resume_after_block_end`。
3. **已经点过做完的块，又点暂停或继续**：返回 409，计划不变。测试是 Task 3 的 `test_done_then_pause_409`。
4. **一个项目拆成两块，只做完一块**：晚上对账照常问这个项目，不预先填好。测试是 Task 5 的 runs-check 用例。
5. **块里有暂停时的番茄提醒**：时间要往后顺延暂停的时长；暂停中一条番茄提醒都不给。测试是 Task 2 的 `test_pomodoro_reminders_skip_pauses`。

---

### Task 1：`block_runs` 表、数据库方法、隐私和迁移

**Files：**
- Modify：`src/server/db.py`（SCHEMA、`USER_TABLES`、`JSON_COLUMNS`、`add_plan`，并加 3 个方法）
- Modify：`src/server/migrate_pg.py`（表的字段说明）
- Create：`supabase/migrations/20261125000000_block_runs.sql`（照 `20261124000000_say_the_day.sql` 的写法：建表、开 RLS、加「只能看和改自己」的策略）
- Modify：`src/server/privacy.py`、`docs/data-inventory.md`
- Test：`tests/test_db.py`

**Interfaces：**
- Produces：
  - 表 `block_runs`：`(user_id, day, block_id)` 是主键，另外有 `started_at TEXT NOT NULL`、`pauses TEXT NOT NULL`（JSON 数组 `[[from, to|null], …]`）、`done_at TEXT`、`planned_start TEXT NOT NULL`、`planned_end TEXT NOT NULL`。
  - `Db.block_runs(user_id: int, day: date) -> dict[str, dict]`：键是 block_id，值是 `{started_at, pauses, done_at, planned_start, planned_end}`，其中 `pauses` 已经解析成列表。
  - `Db.save_block_run(user_id: int, day: date, block_id: str, run: dict) -> None`：有就覆盖（upsert）。
  - `Db.add_plan(..., *, only_if_none=False, confirmed: bool = False) -> int`：`confirmed=True` 时 `confirmed_at` 写 `_now()`。

- [ ] **Step 1：写失败的测试**

  在 `tests/test_db.py` 里加两个测试：

  - `test_block_runs_roundtrip`：
    - 存一条 `{"started_at": "2026-11-20T15:00:00+01:00", "pauses": [["2026-11-20T15:20:00+01:00", None]], "done_at": None, "planned_start": "15:00", "planned_end": "16:00"}`；
    - 读回来要和存的完全相等；
    - 再存同一个 block_id，`done_at` 改掉，读回来是新值；
    - 只有这一条。
  - `test_add_plan_confirmed`：
    - `add_plan(..., confirmed=True)` 以后，`latest_plan(...)["confirmed_at"]` 不是 None；
    - 默认参数存的仍然是 None。

  现有的 `USER_TABLES` 查漏测试（约 126 行），要能自动覆盖到新表。

- [ ] **Step 2：运行测试，确认失败**

  命令：`uv run pytest tests/test_db.py -q -p no:cacheprovider --basetemp=…/pt`

  预期：新加的两个测试失败。

- [ ] **Step 3：实现**

  - 建表、加方法；
  - `"pauses"` 加进 `JSON_COLUMNS`，`"block_runs"` 加进 `USER_TABLES`；
  - `migrate_pg` 里加一行：`"block_runs": {"day": "text", "block_id": "text", "started_at": "text", "pauses": "json", "done_at": "text", "planned_start": "text", "planned_end": "text"}`；
  - 隐私：
    - `PRIVACY_TEXT` 的清单在「各件事上次定的时长」后面加「每一块实际几点开始、中间停了几次、几点做完」；
    - `PRIVACY_VERSION` 改成 v5，注释开头写「v5：补上每一块实际做的时间」；
  - `data-inventory.md` 加一行：`| block_runs | 每一块实际几点开始、各段暂停、几点做完、当时的计划起止 | | | | |`。

- [ ] **Step 4：跑全部测试**

  隐私版本变了，凡是写死 v4 的测试都要跟着改。

  预期：全部通过。

- [ ] **Step 5：提交**

  提交信息：「block_runs 表：记每一块实际几点开始、停了几次、几点做完；隐私说明 v5」。

---

### Task 2：`src/server/runs.py` 纯函数

**Files：**
- Create：`src/server/runs.py`
- Test：`tests/test_runs.py`

块用的是计划 JSON 里的 dict：`{id, title, start: "HH:MM", end: "HH:MM", kind, pinned?, task_id?}`。分钟换算用 `planner.model` 里的 `to_min` 和 `to_hhmm`。

**Interfaces：**
- Produces：
  - `extend(blocks: list[dict], block_id: str, minutes: int, sleep: int, ripple: bool) -> tuple[list[dict], bool]`
    - 返回新的块列表（按开始时间排好）和 ok。
    - 规则：
      - 被延长的块，新结束时间取三者里最早的：`原结束 + minutes`、它后面第一个 `class` 或 `pinned` 块的开始、`sleep`。被截住了 ok 就是 False。
      - `ripple=True` 而且没被截住时，按推法依次把后面的块往后挪：
        - `新开始 = max(原开始, 前一块的新结束)`，时长不变；
        - 碰到不重叠的块就停；
        - 碰到 `class` 或 `pinned` 的块，或者挪完会超过 `sleep`，ok 就是 False。这时只返回被延长的那一块的改动，其余块保持原样；
        - `free-` 块被压到就剪短，不足 30 分钟就删掉。`free-` 块不挡路，也不更新「前一块的新结束」。
      - `ripple=False` 时只延长这一块（同样会被截住），ok 固定是 False。
  - `clashes(blocks: list[dict], block_id: str) -> list[str]`：和这一块重叠的非 `free-` 块，加上这一块自己。没有重叠时返回空列表。
  - `cut_at(blocks: list[dict], block_id: str, now_min: int) -> list[dict] | None`
    - 新结束时间是 `now_min` 向上取整到 5 分钟。
    - 新结束不早于原结束，或者新时长短于 `MIN_BLOCK`（10），返回 None（不改）。否则返回截短后的块列表。
    - `MIN_BLOCK` 从 `api.py` 挪到 `runs.py`，由 `api.py` 导入。
  - `paused_seconds(run: dict, now: datetime) -> int`：各段暂停的总秒数，没关的那段算到 now。
  - `focus_seconds(run: dict, now: datetime) -> int`：`now − started_at − 暂停秒数`，最小是 0。
  - `run_reminders(blocks: list[dict], runs: dict[str, dict], operable: set[str], now: datetime, started_at: Callable[[dict], datetime]) -> list[dict]`
    - 每条提醒是 `{kind, at: "HH:MM", title, body, url: "/"}`，按 `at` 排好序。
    - `started_at(b)` 返回这一块计划开始的时刻，由 api 传进来，因为只有 api 知道逻辑日和时区。
    - 规则：
      - `block` 提醒：operable 里还没做完、计划开始时间晚于 now 的块，在开始时提醒。标题是 `到点了：{title}`，正文是 `{start}–{end}`。
      - `pomodoro` 提醒：只给正在走的块。正在走的意思是：没做完，没在暂停，而且已经有记录，或者 `start ≤ now < end`（没记录时按计划开始时间算）。
        - 块里一共 `n = ceil(块长 / 30)` 个番茄。专注到第 `30(k−1)+25` 分钟时提醒「休息 5 分钟」，到第 `30k` 分钟时提醒「回来接着做」。最后一个番茄不提醒回来。正文都是块的标题。
        - 时刻 = `now + (目标专注秒数 − 已专注秒数)`，只保留晚于 now 的。

- [ ] **Step 1：写失败的测试**（`tests/test_runs.py`）

  用一组手写的块，`sleep = to_min("22:00")`：

  ```python
  A = {"id": "a", "title": "看书", "start": "15:00", "end": "16:00", "kind": "must"}
  B = {"id": "b", "title": "写报告", "start": "16:00", "end": "17:00", "kind": "proj", "task_id": "r"}
  F = {"id": "free-1", "title": "自由时间", "start": "17:00", "end": "18:00", "kind": "life"}
  C = {"id": "dinner", "title": "晚饭", "start": "18:00", "end": "18:45", "kind": "life"}
  K = {"id": "cls", "title": "课", "start": "19:00", "end": "20:00", "kind": "class"}
  ```

  - `test_push_ripples_and_trims_free`：
    - `extend([A,B,F,C,K], "a", 10, sleep, True)`；
    - ok 为 True；
    - a 变成 15:00–16:10，b 变成 16:10–17:10；
    - free-1 变成 17:10–18:00；
    - dinner 和 cls 不变；
    - 所有 id 和 `pinned` 都不变。
  - `test_push_drops_short_free`：
    - F 改成 17:00–17:35；
    - 延长 10 分钟以后，free-1 只剩 25 分钟，所以被删掉。
  - `test_push_blocked_by_class_keeps_others`：
    - K 改成 17:05–18:00，块是 `[A,B,K]`，延长 10 分钟；
    - ok 为 False；
    - a 是 15:00–16:10，b 仍是 16:00–17:00；
    - `clashes(result, "a") == ["a", "b"]`，顺序按开始时间。
  - `test_extension_capped_at_class`：
    - 块是 `[A, K]`，K 改成 16:05–17:00，延长 10 分钟；
    - a 是 15:00–16:05，ok 为 False。
  - `test_push_past_sleep_fails`：
    - 块是 21:00–21:55 的一块 `x`（must），前面有 20:00–21:00 的 `a`，延长 a 10 分钟，sleep 是 22:00；
    - ok 为 False，x 不变。
  - `test_pinned_is_immovable`：
    - B 带 `pinned: True`，延长 a 10 分钟；
    - ok 为 False，b 不变，a 被截在 16:00。
  - `test_no_ripple_only_extends`：
    - `extend([A,B], "a", 20, sleep, False)`；
    - a 是 15:00–16:20，b 不变，ok 为 False。
  - `test_cut_at`：
    - `cut_at([A], "a", to_min("15:31"))` 的结果是 a 15:00–15:35；
    - now 是 15:58 时，向上取整到 16:00，不早于原结束，返回 None；
    - now 是 15:04 时，向上取整到 15:05，只剩 5 分钟，短于 10 分钟，返回 None。
  - `test_focus_and_paused_seconds`：
    - run 从 15:00 开始，暂停过 `[15:20, 15:26]`，还有一段从 15:40 开始没关；
    - now 是 15:50 时，`paused_seconds == 960`，`focus_seconds == 2040`。
  - `test_block_reminders_only_future_operable_not_done`：
    - now 是 15:30；
    - operable 是 `{"a", "b"}`，b 没有记录；
    - 结果里 kind 是 block 的只有 b，在 16:00，标题是「到点了：写报告」，正文是「16:00–17:00」。
  - `test_pomodoro_reminders_skip_pauses`：
    - a 是 15:00–16:00 的 must，有两个番茄；
    - run 从 15:00 开始，暂停过 `[15:10, 15:15]`；now 是 15:20；
    - pomodoro 提醒依次是：15:30「休息 5 分钟」、15:35「回来接着做」、16:00「休息 5 分钟」。第 2 个番茄是最后一个，不给「回来」；
    - 暂停中（最后一段没关）时没有 pomodoro 提醒。

- [ ] **Step 2：运行测试，确认失败**

  命令：`uv run pytest tests/test_runs.py -q …`

  预期：ImportError。

- [ ] **Step 3：实现 `runs.py`**

  按上面的 Interfaces 写；文件开头用一句话说明这个模块做什么。

- [ ] **Step 4：运行测试，确认通过**

- [ ] **Step 5：提交**

  提交信息：「做事陪跑的纯函数：往后推、截短、专注时长、块和番茄提醒」。

---

### Task 3：三个接口，`/today` 返回 runs 和提醒

**Files：**
- Modify：`src/server/api.py`
  - 在 `/plan/reflow` 后面加三个路由和一个小工具 `operable(day, b) -> bool`；
  - 改 `today_body`，返回 runs 和新提醒。
- Test：`tests/test_block_runs_api.py`
  - fixture 照 `tests/test_plan_edit_api.py` 的写法，复用 `test_day_say_api` 的 `TEMPLATE`、`say`、`reply`、`MEETING`、`REPORT`；
  - 时钟可以改：`now = {"t": datetime(2026, 11, 20, 8, 0)}`，`clock = lambda tz: now["t"].replace(tzinfo=tz)`。

**Interfaces：**
- Consumes：Task 1 的 `Db.block_runs`、`save_block_run`、`add_plan(confirmed=)`；Task 2 的 `extend`、`clashes`、`cut_at`、`paused_seconds`、`focus_seconds`、`run_reminders`。
- Produces：
  - `POST /block/{block_id}/pause`、`POST /block/{block_id}/resume`、`POST /block/{block_id}/done`，都没有请求体。
  - pause 和 done 返回 `today_body(day)`；resume 返回 `{**today_body(day), "ask_reflow": bool, "overlaps": list[str]}`。
  - `today_body` 多一个 `"runs": {block_id: {started_at, pauses, done_at, actual_min}}`。只有做完的块 `actual_min` 才有值，等于 `focus_seconds` 换算成分钟后取整（`round`）；其他块是 None。
  - `reminders` 后面接上 `run_reminders(...)` 的结果。按今天的块算，operable 用 `operable()` 判断。

规则（照 spec 来）：

- **建记录**：某一块第一次被点时新建。
  - `started_at` = 这一块的计划开始时刻；
  - `planned_start` 和 `planned_end` 照块的起止；
  - `pauses` 是空列表。
- **pause**：
  - 已经做完了，或者最后一段暂停还没关，返回 409；
  - 计划开始时间晚于现在，返回 409，因为还没开始；
  - 追加一段 `[now, None]`，不存新的计划版本。
- **resume**：
  - 没有记录，或者最后一段暂停已经关了，返回 409；
  - 关掉这一段暂停，算出 `g = ceil(秒数 / 60)` 分钟，推移量 `shift = ceil(g / 5) × 5`；
  - 调用 `extend(blocks, id, shift, inp.sleep, ripple = g <= 15)`；
  - 新计划用 `add_plan(..., confirmed = 原版已确认)` 存成新版本；
  - `ask_reflow = not ok`；
  - `overlaps` 在 ok 时是空列表，不 ok 时是 `clashes(新块, id)`。
- **done**：
  - 计划开始时间晚于现在，或者已经做完了，返回 409；
  - 正在暂停的话，先关掉那一段；
  - 写 `done_at = now`；
  - `cut_at` 返回的不是 None 时，才存新版本（确认状态照 resume 的规则）。
- 三个接口找块、判断能不能操作，都按 `latest_plan` 的最新版来。
  - 块不在最新版里返回 404；
  - 课和吃饭的块返回 422，文案是「这一块不用计时」。

- [ ] **Step 1：写失败的测试**

  `tests/test_block_runs_api.py`：先说一句话把今天排出来，再把时钟拨到某一块里面。

  - `test_pause_creates_run_at_planned_start`：
    - 在块开始后 20 分钟点暂停；
    - `runs[id]["started_at"]` 的时间部分等于块的 start；
    - `pauses` 有一段，第二项是 None；
    - 计划版本号不变。
  - `test_pause_twice_409_and_class_422`：
    - 连点两次暂停，第二次返回 409；
    - 对课的块点暂停返回 422；
    - 不存在的 id 返回 404。
  - `test_short_resume_pushes_later_blocks`：
    - 暂停以后拨 7 分钟再点继续；
    - 推移量是 10 分钟，这一块的 end 加 10 分钟；
    - 后面紧挨着它的、能挪的那一块，start 也加 10 分钟；
    - `ask_reflow` 是 False，`overlaps` 是空列表；
    - 所有块的 `pinned` 都和之前一样。
  - `test_resume_exactly_15_is_small`：停 15 分钟，`ask_reflow` 是 False。
  - `test_long_resume_asks_reflow_then_reflow_keeps_block`：
    - 停 20 分钟再继续，`ask_reflow` 是 True；
    - 再调 `/plan/reflow`，这一块的 start 和 end 都和继续后一样。
  - `test_resume_after_block_end`：
    - 暂停的时间一直拖到块的计划结束之后 10 分钟；
    - 点继续返回 200，`ask_reflow` 是 True。
  - `test_runs_survive_reflow`：
    - 暂停以后调 `/plan/reflow`；
    - `/today` 的 `runs` 里还有这个 id，而且这个 id 还在 blocks 里。
  - `test_done_early_cuts_block`：
    - 在块开始后 31 分钟点做完；
    - 这一块的 end 等于 start 加 35 分钟；
    - 后面的块不动；
    - `runs[id]["actual_min"]` 是 31；
    - 版本号加 1。
  - `test_done_then_pause_409`：做完以后再点暂停或继续，都返回 409。
  - `test_done_before_start_409`：对一块还没开始的块点做完，返回 409。
  - `test_confirmed_stays_confirmed`：
    - 先 `/plan/confirm`，再暂停、继续；
    - 新版本的 `confirmed` 是 True。
  - `test_today_has_block_reminders`：
    - `/today` 的 `reminders` 里有 kind 为 block 的提醒；
    - 每条都是还没开始、能操作的块的 start，url 是 `"/"`。
  - `test_export_and_delete_include_block_runs`：
    - 暂停一次以后，`/export` 里有 block_runs 的一行；
    - `DELETE /me?confirm=true` 以后，这一行没了。

- [ ] **Step 2：运行测试，确认失败**

  预期：路由不存在，返回 404 或 405。

- [ ] **Step 3：实现**

  - 三个路由；
  - `today_body` 加上 `runs` 和提醒；
  - `MIN_BLOCK` 改成从 `runs.py` 导入。

- [ ] **Step 4：跑全部后端测试**

  预期：全部通过。

- [ ] **Step 5：提交**

  提交信息：「做事接口：被打断、继续（≤15 分钟往后推，久了问重排）、做完；/today 带 runs 和块、番茄提醒」。

---

### Task 4：App 上的「现在」卡

**Files：**
- Create：`mobile/src/runs.ts`（纯函数，不 import React）
- Create：`mobile/scripts/runs-check.mjs`（照 `scripts/diff-check.mjs` 的写法，用 `node --experimental-strip-types` 跑，assert 不过就退出码 1）
- Create：`mobile/src/components/now-card.tsx`
- Modify：
  - `mobile/src/api.ts`：类型和三个调用；
  - `mobile/src/app/(tabs)/index.tsx`：把卡放在时间轴上面，并接上返回结果；
  - `mobile/src/components/timeline.tsx`：做完的块打勾、变淡。

**Interfaces：**
- Consumes：Task 3 的接口和 `runs` 的形状。
- Produces：
  - `api.ts`：
    - `type Run = { started_at: string; pauses: [string, string | null][]; done_at: string | null; actual_min: number | null }`；
    - `Plan.runs?: Record<string, Run>`；
    - `Reminder.kind` 加上 `"block" | "pomodoro"`；
    - `pauseBlock(id)`、`resumeBlock(id)`、`doneBlock(id)`，都调 `send("POST", `/block/${encodeURIComponent(id)}/…`)`；
    - `resumeBlock` 的返回类型是 `Plan & { ask_reflow: boolean; overlaps: string[] }`。
  - `runs.ts`：
    - `operable(b: Block): boolean`：`kind` 是 `must`、`proj`、`flex` 之一，或者带 `item_id`；
    - `pickNow(blocks: Block[], runs: Record<string, Run>, nowMin: number): Block | null`：照 spec 的三条选块规则；
    - `pomodoro(b: Block, run: Run | undefined, nowMs: number, startMs: number): { index: number; total: number; phase: "focus" | "break"; leftSec: number; paused: boolean; pausedSec: number }`：
      - `startMs` 是计划开始时刻，没有记录时用它；
      - `index` 从 1 开始；
      - 专注时长超过整块以后，`index = total`，`phase = "break"`，`leftSec = 0`。
- `NowCard({ plan, onPlan, onAsk }: { plan: Plan; onPlan: (p: Plan) => void; onAsk: () => void })`：
  - 每秒刷新一次（用自己的 `useState` 加 `setInterval`；React Compiler 会把渲染里的 `new Date()` 缓存住，所以时间要放进 state 里）；
  - 按钮：「被打断了」和「做完了」，暂停中换成「继续」；
  - 专注时显示「专注 还剩 mm:ss」，小歇时显示「小歇 还剩 mm:ss」，暂停中显示「停了 N 分钟」；
  - resume 返回 `ask_reflow` 时调 `onAsk()`。
- 在 `index.tsx` 里，`onAsk` 做的事和 `edit()` 成功后一样：`setAsk(true)` 再 `setMoved(null)`。时间轴本来就会给重叠的块描琥珀色边（`timeline.tsx` 里的 `clash`），所以不用另外传 overlaps。

- [ ] **Step 1：写 `runs-check.mjs` 断言**

  - `pickNow`：
    - 有暂停着的块时，优先选它，哪怕现在已经在下一块的时间里；
    - 没有时，选现在所在的、还没做完的能操作块；
    - 课的块不选；
    - 做完的不选；
    - 都没有返回 null。
  - `pomodoro`：
    - 块是 15:00–16:00，没有记录，现在是 15:27：`{index: 1, phase: "break", leftSec: 180}`；
    - 有一段暂停 `[15:10, 15:15]`，现在是 15:27：`{index: 1, phase: "focus", leftSec: 180}`；
    - 暂停中：`paused` 是 true，`pausedSec` 正确。

- [ ] **Step 2：运行脚本，确认失败**

  命令：`node --experimental-strip-types mobile/scripts/runs-check.mjs`

  预期：import 失败。

- [ ] **Step 3：实现**

  `runs.ts`、`api.ts`、`now-card.tsx`，以及 `index.tsx` 的接线。

  做完的块：`TimelineBlock` 加一个 `done?: boolean`，为 true 时 `opacity` 是 0.55，标题前加一个勾，读屏文字里加「已做完」。样式先从简，以后对照参考图再改。

- [ ] **Step 4：验证**

  - `node --experimental-strip-types mobile/scripts/runs-check.mjs` 通过；
  - `cd mobile && npx tsc --noEmit && npx expo lint --no-cache` 没有报错。

- [ ] **Step 5：提交**

  提交信息：「今天页的「现在」卡：番茄倒计时、被打断/继续/做完；做完的块打勾」。

---

### Task 5：晚上对账预先填好做完的事

**Files：**
- Modify：`mobile/src/runs.ts`（加一个函数）、`mobile/scripts/runs-check.mjs`、`mobile/src/app/checkin.tsx`

**Interfaces：**
- Produces：
  - `doneItems(items: CheckinItem[], blocks: Block[], runs: Record<string, Run>): Set<string>`：
    - 一件事今天所有的块都有 `done_at`，就算做完；
    - 块属于哪件事：`b.id === item.id` 或者 `b.task_id === item.id`。

- [ ] **Step 1：写 runs-check 断言**

  - 习惯只有一块，做完了：结果里有它；
  - 项目有两块，只做完一块：结果里没有它；
  - 没有任何记录：结果是空集合。

- [ ] **Step 2：运行，确认失败**

- [ ] **Step 3：实现**

  - 在 `checkin.tsx` 的 `load()` 里，`plan.checkin` 为空时，用 `doneItems` 把这些事预先填成 `{status: "done"}`，并把这个集合存进 state（`pre`）；
  - `stepsOf` 加一个参数 `pre: Set<string>`，`pre` 里的事不再问「做没做」那一屏。项目照样问「比预想多还是少」；
  - 提交时，`picked` 本来就会带上 choices 里所有有 status 的事，所以预先填好的会一起交上去；
  - 汇总页照常列出这些事，可以点进去改。

- [ ] **Step 4：验证**

  runs-check、`tsc`、`lint` 都通过。

- [ ] **Step 5：提交**

  提交信息：「对账：白天点过做完的事先填好，只问没点过的」。

---

### Task 6：端到端验证（不写新代码，只有发现问题才修）

- [ ] 跑后端全部测试、planner 的测试、App 的 tsc 和 lint、`git diff --check`。
- [ ] 用 scratchpad 里的 `devday.ps1`（假时钟）起后端和网页，再用 `scratchpad/r6.mjs` 在 390×844 的窗口里走一遍：
  1. 「现在」卡出现；
  2. 点「被打断了」，把时钟拨 5 分钟，点「继续」：后面的块往后推了；
  3. 再暂停 20 分钟，点「继续」：出现提示条，点「重排」，列出改了几处；
  4. 点「做完了」：块打了勾；
  5. 晚上对账时，这件事已经填好了。

  截图发给用户。
- [ ] 收尾：删掉 `var/app.db`，关掉服务和 Ollama。
- [ ] 整支分支交给最强的模型做一次评审，修掉重要问题，然后汇报。

  真机上的通知、番茄提醒要用户在 iPhone 上试，汇报时写清楚。
