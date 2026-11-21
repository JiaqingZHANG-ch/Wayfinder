# 回信、季度回顾、档案「障碍」· 实施计划

**目标**：补上合并版设计里还没做的三块：§六之四的「30／90 天回信」和档案「障碍」层，§六之三的季度回顾。

**设计依据**：`U:/Obsidian/AI知识库/17-AI学习/AI应用开发与FDE实战/AI从0开发/成长导师/2026-11-19｜设计｜合并版App.md`，§六之三、§六之四。

**分支**：`letters-quarter`，从 main b54db94 开出来。每个任务单独提交，不推送，不合并。

## 全局约束（每个任务都要守）
- 用户写的字原样存、原样显示，模型不改写。这三块都**不调模型**：数字由 Python 算，字是用户自己的。
- 用户写的文字一律先过危机检查：用 api.py 里现有的 `screen(body, day)`。命中就返回 `crisis_reply()`，什么都不存。
- 新表要加进 `db.USER_TABLES`，JSON 列加进 `JSON_COLUMNS`。导出和删除靠它们，`tests/test_db.py` 会查漏。
- 所有给用户看的文案都要过 `tone.banned_hits`，并且有测试覆盖。文案要短，像人说话。不打分、不催、不和昨天比；没做到的写「没有记录」或「没做」。
- App 的界面照 `docs/design.md`（黏土小镇）和现有的基础件 `mobile/src/components/ui.tsx`、`clay.tsx`。**只换皮不砍功能**；也不发起新的 UI 打磨。
- 检查全绿才能提交：
  - `uv run pytest -q`
  - `cd mobile && npx tsc --noEmit && npx expo lint --no-cache`
  - `git diff --check`
- 时间都用逻辑日 `logical_date(clock())`：凌晨 4 点前算前一天。

## 任务 1 · 后端：档案「障碍」＋回信
**障碍**（设计 §六之四的档案层级表：障碍 = 各视角说的「最大的未知」）
- 在 `finish_step` 第 4 步里，用户选了版本 k（`choose` 是 0–2 的整数），并且智囊团结果存在（`rows[4]["council"]`），就把每个视角对第 k 个版本的 `unknown` 各提成一条待确认的「障碍」档案，最多 3 条。
- 这些文字由程序直接取，不再调模型；照样进 `profile_ids`，在长谈小结里一张一张确认。
- 「先不选」或者没有智囊团结果，就不提。

**回信**
- 新表 `letters`：`id, user_id, written_on TEXT, due TEXT, days INTEGER, text TEXT, prototype TEXT, habit_id TEXT, created_at`。
- 邀请：第 4 步做完以后，在 `talk_state` 里加 `letter_ask: bool`。条件是这一轮第 4 步已经 finished，且 `answers[4]` 里还没有 `letter_asked`。只问一次。
- `POST /letters`，参数是 `{days: 30|90, text}`：
  - text 去掉首尾空白后，长度在 1 到 MAX_INPUT 之间；
  - 先过危机检查；
  - `prototype` 和 `habit_id` 取这一轮第 4 步里已经接受的原型习惯（`proposals` 里 `key == "prototype"` 且 `status == "accepted"`）。habit_id 到设置的习惯里找 `source == "deep_talk"`、标题对得上的那个；找不到就存 null；
  - `due = written_on + days`；
  - 写完以后，在 `answers[4]` 里记 `letter_asked = true`。
- `POST /letters/decline`：只记 `letter_asked = true`。
- `GET /letters` 返回 `{"letters": [...]}`，按 due 排序。
  - 没到期的信，`status` 是 `"sealed"`，不带 text。
  - 到期的信（`today >= due`），`status` 是 `"open"`，带上：
    - text 原文；
    - prototype；
    - `logged_days`：写信第二天到到期日（正好 days 天）之间有对账的天数；
    - `done_days`：这些对账里 habit_id 状态是 done 或 floor 的天数，没有 habit_id 时为 null；
    - `span_days`。
- 本地提醒：`GET /today` 的 `later_reminders` 里，给每封还没到期的信加一条：
  - `kind: "letter"`、`day: due`、`at: "09:00"`、`url: "/letter"`；
  - 标题和正文写成常量放在 `mentor/reminders.py`，并加进 `tests/test_reminders.py` 的禁用词测试。
  - 不写进日历。
- 测试写在 `tests/test_letters_api.py`，可以借用 `test_deep_talk_api.py` 里的 `finish_step4` 这类帮手。至少覆盖：
  - 选了版本才提障碍，提的是对应版本的 unknown；
  - letter_ask 只出现一次（写了或者不要以后都消失）；
  - 危机文字不存；
  - 没到期不给 text；
  - 到期以后数字对得上（造几天的 day_logs）；
  - 提醒里出现到期日；
  - 导出里有 letters，删除以后没有。

## 任务 2 · App：回信
- `api.ts` 加类型和调用。`Reminder.kind` 加 `"letter"`。
- 长谈第 4 步的小结里，提议都处理完以后，如果 `letter_ask` 为真，显示一张卡：
  - 问「要不要给 30 天后的自己留几句话？」，两个按钮「要」「不用了」；
  - 点「要」：一个多行输入框、30 天 / 90 天二选一（默认 30），按钮「封好」。封好以后显示「到 {日期} 再打开」。
- 新页面 `mobile/src/app/letter.tsx`，列出所有信：
  - 没到期的只显示「{日期} 可以打开」；
  - 到期的显示原文（用「」括起来，标上写信日期）、原型名，和一句数字：「这 {span} 天里，你记录了 {logged} 天，『{原型}』做了 {done} 天」。done 为 null 时只说记录了几天。
- 「我」页在设置行上面加一行「给自己的信」（有信才显示），点进 /letter。
- 通知点开跳 /letter，现有的 `useNotificationRouting` 不用改。

## 任务 3 · 后端：季度回顾
- 新表 `quarterly_reviews`：`id, user_id, day TEXT, scores TEXT(json), focus TEXT, start TEXT, stop TEXT, keep TEXT, goals TEXT(json), created_at`。
- 生活之轮默认 6 项：`AREAS = ("健康", "学习或工作", "钱", "玩", "朋友和亲密关系", "成长")`，用户可以加一项（2–8 个字）。
- `GET /quarter` 返回：
  - `areas`；
  - `available`：从第一条对账到今天满 90 天，并且上一次季度回顾是 84 天以前或者从来没做过；
  - `days_used`；
  - `last`：上一次的完整记录，或 null。
- `POST /quarter` 的参数是 `{scores: {项: 0–10 的整数}, extra_area?: str, focus: str, start: str, stop: str, keep: str, goals: [{text, check}]}`：
  - scores 必须正好覆盖默认 6 项，加上 extra_area（如果给了）；
  - focus 必须是其中一项；
  - start、stop、keep 至少填一个，每个不超过 MAX_INPUT；
  - goals 有 1–3 条，text 和 check 都不能是空的（check 是「每周看什么」），各 60 字以内；
  - 所有字先过危机检查。
  - 存下以后，每条目标写成一条**已确认**的档案：level 是「目标」，source 是「季度回顾」，要加进 `PROFILE_SOURCES`。内容是 `f"{text}（每周看：{check}）"`。
  - 返回存好的记录。
- 不在 `available` 为假时拒绝（用户可以从链接提前进来）。只是入口不显示。
- 「××视角」作为季度回顾的第二个入口，**这次不做**，在计划里记为后续。
- 测试写在 `tests/test_quarter_api.py`：校验的每一条、危机、available 的两个边界（89/90 天、83/84 天）、目标进了已确认档案、导出和删除。

## 任务 4 · App：季度回顾
- 新页面 `mobile/src/app/quarter.tsx`，一屏一问：
  1. 6 项（加可选的第 7 项）各选 0–10，用现有的分数组件（深度长谈第 1 步打分那种）。
  2. 选 1 项作为接下来 90 天的重点。如果选的不是分最低的那一项（同分取第一个），就在下面中性地提一句：「分最低的是『{项}』，你选了『{项}』。先这样记下。」不拦着他。
  3. Start / Stop / Keep 三个输入框，标题是「开始做」「停下」「继续」。
  4. 目标 1–3 条，每条两格：「目标」和「每周看什么」。
  5. 保存后的结果页：重点、目标列表，按钮「好」。
- 「我」页：
  - `available` 为真时，长谈卡下面出现入口「可以做一次季度回顾了」；
  - 有 `last` 时，「我的方向」卡里加一行「这一季的重点：{focus}」。

## 后续（这次不做）
- 重复点保存会多一条回顾（存新回顾时上一季来源是「季度回顾」的「目标」档案会被删掉，只留最新一组）。
- 季度回顾里开「××视角」会议。
- 每周复盘里逐条查季度目标。
- 「止损底线」：长谈里还没有问它的那一屏。
