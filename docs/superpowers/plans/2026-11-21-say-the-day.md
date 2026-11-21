# 说一句话排今天：语音或打字 → AI 拆成任务块 → 求解器按精力排 → 拖动调整

## 背景
大多数日程 App 要人一条一条手动添加事项。用户想要的是：
- 把今天要做的事说给 App 听，打字或说话都行；
- App 听懂后拆成一块一块的任务，用现有的求解器按精力和难度排出推荐时间；
- 用户在时间轴上拖动块换时间，拉上下边缘改时长；
- App 记下这些改动，再问一句「要不要把其余的重新排一下」。

人生导师那部分先不做，入口全部藏起来，代码保留。

界面照用户给的第一张参考图：奶油底、暖橙色头部、圆角卡片、左边时间刻度、右边彩色圆角块，青绿色圆形按钮。要简约。

用户已定的两件事：
- 没说时长的事，AI 先估一个，块上标「估」。用户改过以后记下来，下次同一件事就用用户上次定的时长。
- 导师功能（深度长谈、回信、季度回顾、每周复盘）全部藏起来。

## 现有代码里能直接用的
- **求解器输入已经分好类**，见 `planner/docs/settings.md`：
  - `fixed`：固定时间，六项必填；
  - `tasks`：要花多少分钟，用 `remaining_min`，有 `heavy`；
  - `habits`；
  - `energy.cost[id]`：耗能系数，`love` 0、`recharge` 0.5、`drain` 1。
  
  只属于今天的任务已有先例：`api.py` 的 `day_raw`（约 260 行）把「明天的一件事」当 task 加进当天，`deadline` 写成当天，不进设置。
- **一句话解析**：`src/mentor/checkin.py` 的 `parse_sentence` 是现成模板，流程是 schema、`complete_json`、先查危机（`model_output_is_crisis`）、再校验。所有字段都设成必填，因为 qwen3 会丢掉可选字段。重试写法照 `review.py:174`。
- **排计划和版本**：
  - `solve_day`、`input_from_dict`、`replan_from(inp, now, done_ids, before)`，在 `planner/src/planner/solve.py:465/501`；
  - `src/server/replan.py` 的 `replan_after`；
  - `day_plans` 表每改一次加一个 version，`/plan/confirm` 写日历。
- **App**：
  - `components/plan-view.tsx` 有 `toMin`、`fromMin`、`useNow`、`NowLine`；
  - `clay.tsx` 的电池用 `usePanGesture`、吸附、`haptic.select()`、`withSpring`，拖块的手势照它写；
  - `sheet.tsx` 是底部面板；
  - `diff.ts` 的 `planDiff` 和 `changes.tsx` 用来列出改了几处；
  - `ui.tsx` 有 Card、Button、Field、Chip、IconButton；
  - `theme.ts` 只要改 `dayPalette` 和 `nightPalette` 两个对象（L21–66），全 App 就换色。
- **语音**：
  - 本机已有离线 faster-whisper，环境在 `AI工作空间/工具与运行环境/Python/asr/`（含 PyAV，能直接读 m4a 和 webm），模型 small 和 medium 在 `AI工作空间/模型/faster-whisper/`；
  - `expo-audio` 自带在 Expo Go 里，iOS、安卓、Web 都能录音；
  - 手机系统键盘自带的话筒在输入框里本来就能用，不用写代码。

## 做法（新分支 `say-the-day`，从 main 3e54384 开）

### 后端
1. **解析今天的话**：
   - 新文件 `src/mentor/day_parse.py`，照 `parse_sentence` 写；
   - 返回 `items: [{title, kind: "fixed"|"task", start, end, minutes, effort: "light"|"normal"|"heavy"}]`。所有字段必填，不知道的填 null；
   - 校验：时间是 HH:MM，并且 start 早于 end；minutes 在 5–480 之间；title 1–30 字，过 `banned_hits`；
   - 先查危机；失败重试 1 次，再失败返回 bad，App 提示「没听清，换个说法或直接加」。
2. **估时长**：
   - 新表 `duration_memory(user_id, key, minutes, updated_at)`，key 是去掉空格、数字以后的标题；
   - minutes 为 null 时，先查这张表，有就用，标 `estimated: false, source: "上次"`；
   - 没有就用 effort 的默认值（light 30、normal 60、heavy 90），标 `estimated: true`。
   - 模型不负责估时长，免得它乱编。
3. **当天事项和排程**：
   - 新表 `day_items(user_id, day, items JSON)`；
   - `POST /day/say {text}`：先过 `screen()` 查危机，解析，存 `day_items`，再排程，返回未确认的新计划版本加 items。不追加：每次说都以这次为准，替换当天全部事项；
   - 排程：`day_raw(raw, day)` 先拿设置里的课和习惯，再并进 `day_items`：
     - fixed 进 `fixed`，kind 是 meeting；
     - task 进 `tasks`，`remaining_min` 是 minutes，`deadline` 是当天，`heavy` 看 effort 是不是 heavy，`energy.cost` 按 effort 给 0.5、1 或 1；
   - 写一个共用函数 `day_input(raw, day)`，`/today` 和 `/energy` 都改用它，这样重排时当天事项不会丢。
4. **手动改和钉住**：
   - `POST /plan/edit {version, block_id, start, end}`：在最新版上改这一块的时间，标 `pinned: true`，存成新版本（未确认）。不自动重排。
   - 只查两件事：起止时间合法，块在 wake 到 sleep 之间。和别的块重叠时不拦，在返回里带 `overlaps: [id…]`。
   - 如果这块来自 `day_items`，时长变了就把新时长写进 `duration_memory`。来自设置的习惯不写，习惯时长归设置页管。
   - `DELETE /plan/block/{id}`：从当天事项里去掉这一块，存新版本。
5. **按精力重排其余的**：
   - `POST /plan/reflow {version}`：钉住的块和已经开始的块原样保留，其余交给求解器重排。
   - 做法：钉住的块当成 `fixed` 喂给求解器；输出后按 id 把原来的 kind 和 `pinned` 恢复。求解器会把 fixed 一律输出成 class，所以要恢复。
   - 用 `replan_from(inp, now, before=…)` 保住已经过去的部分。
   - 返回新版本，以及用 `planDiff` 能比出来的前后两版。
6. **语音转写**：
   - `POST /transcribe`，收 multipart 音频，大小 ≤ 5MB；
   - 用 subprocess 调 `WHISPER_PYTHON`（环境变量，默认空），跑仓库里新写的 `scripts/transcribe_once.py <音频>`，模型取 `WHISPER_MODEL`，默认是本机 small 模型的路径；`language=zh`，返回文字。
   - 没配 `WHISPER_PYTHON` 时返回 501「这台电脑没装语音转写，先打字或用键盘上的话筒」。
   - 写上 `shortcut:` 注释：每次都重新加载模型，慢了再改成常驻服务。
   - 转出来的文字不直接排程，先填进输入框，用户看一眼再点「排一下」。
7. 所有新表加进 `USER_TABLES` 和 `migrate_pg`，在 supabase 迁移里加 RLS，`privacy.py` 里补一句，版本号加 1。

### App
8. **换色**：`theme.ts` 两套调色板照参考图 1 改：
   - 浅色：奶油底 `#FFF6EA`、卡片 `#FFFDF8`、头部暖橙 `#F6B77C`、主按钮青绿 `#1F7A73`；
   - 任务块：桃 `#FBD9B5`、粉 `#F9CFD3`、蓝 `#CFDDF8`、灰绿 `#D7E6DA`；
   - 字是深棕；
   - 深色模式取同色系的暗版。
   
   对比度要实测：文字 ≥ 4.5:1，块边界 ≥ 3:1，测出来的值写进注释。
9. **今天页重做**（`(tabs)/index.tsx`）：
   - 头部：橙色圆角头卡，写「今天」和日期，加一行本周日期条，照参考图；
   - 输入条：一个输入框（「说说今天要做什么」）、右边话筒按钮、一个「排一下」按钮。录音时话筒变成停止键，旁边显示秒数；
   - 时间轴：左边是小时刻度，1 小时 = 64px，块高按分钟正比。块是圆角彩色卡，写标题、时间，估出来的带「估」标；
   - 生活块（吃饭等）用淡色；
   - 没有事项时显示一句提示，加一个示例句；
   - 黏土舞台、小人、电池不再出现在今天页。报电量入口改成头卡上的一个小按钮，点开现有的 `/energy`。
10. **拖动和拉伸**（新组件 `components/timeline.tsx`）：
    - 按住块的身体上下拖，吸附到 5 分钟，带触感，松手后调 `/plan/edit`；
    - 拖块底边的小把手改时长，同样吸附到 5 分钟，最短 10 分钟；
    - 点块打开底部面板：改标题、时长，或者删除；
    - 有重叠时，撞在一起的块描一圈琥珀色边，不用红色；
    - 只要手动改过，底部出现一条「要不要把其余的按精力重新排一下？」，两个按钮「重排」「不用」：
      - 点重排调 `/plan/reflow`，用 `Changes` 列出改了几处；
      - 点不用，这条就收起，直到下次再改。
    - 「用这个计划」按钮走现有的 `/plan/confirm`。
    - 「减少动态效果」打开时，松手直接落位。
11. **录音**：
    - 装 `expo-audio`（Expo Go 自带）；
    - `app.json` 加上 iOS 麦克风说明和安卓 `RECORD_AUDIO`；
    - 网页版只在 localhost 或 HTTPS 下能录，录不了就提示「用键盘上的话筒」。
12. **藏起导师**：
    - 新加一个常量 `MENTOR = false`，放在 `src/features.ts`；
    - 藏掉的地方：
      - `me.tsx` 里长谈、我的方向、给自己的信、季度回顾；
      - `checkin.tsx` 对账后邀请长谈；
      - `week.tsx` 的复盘入口；
    - 根布局的路由保留，链接还能进。
    - 后端的复盘提醒、回信提醒也一起关掉：`/today` 不再下发 letter 类型的提醒。

## 拆成任务（每项单独提交，不推送、不合并）
1. 后端：解析今天的话，估时长，`day_items`，`/day/say`，`day_input` 接进 `/today` 和 `/energy`。
2. 后端：`/plan/edit`、删块、`/plan/reflow`、钉住，以及记住改过的时长。
3. 后端：`/transcribe` 和 `scripts/transcribe_once.py`。
4. App：换色，今天页重做（头卡、输入条、按比例的时间轴），藏起导师。
5. App：拖动、拉伸、块面板、重排提示条。
6. App：录音和权限。
7. 整支分支交给 Fable 评审，然后修。

前三项和第 4 项改的文件不重叠，可以并行。第 5 项依赖 2 和 4，第 6 项依赖 3 和 4。

## 验证
- `uv run pytest -q`（现在 534 passed）、`cd planner && uv run pytest -q -p no:cacheprovider`、`cd mobile && npx tsc --noEmit && npx expo lint --no-cache`、`git diff --check`。
- 新测试：
  - 解析：时长为 null 时，先用上次的，再用默认值；时间不合法会被拦下；危机。
  - `/day/say`：替换当天事项；习惯照样排进去；报电量重排以后当天事项还在。
  - `/plan/edit`：钉住、重叠时带 `overlaps`、改了时长会被记住。
  - `/plan/reflow`：钉住的块和已经开始的块不动，其余重排；kind 能恢复。
  - `/transcribe`：没配置时返回 501；用假的 subprocess 测通路。
- 真模型：用本机 qwen3 跑 10 句真实的中文说法，看拆得对不对，结果记进 `evals/cases.jsonl`，新加一类 day。
- 真转写：录 3 段 10 秒中文，测 small 模型的耗时和准确度，写进 `docs/backend.md`。
- 浏览器端到端（`app-backend-day` + `app-web`，390×844）：
  1. 打字「9 点到 11 点上课，下午写报告，晚上健身一小时」；
  2. 看到块；
  3. 拖动报告块；
  4. 拉长；
  5. 出现重排提示，点「重排」；
  6. 「用这个计划」。
  
  截图发给用户。用完删掉 `var/app.db`，关掉服务。
- 真机（iPhone Expo Go）的录音和拖动手感要用户来试，汇报时说明。

## 前后端约定（各任务都照这个，不自己改形状）
- `DayItem`：
  `{id: "item-xxxxxxxx", title, kind: "fixed"|"task", start: "HH:MM"|null, end: "HH:MM"|null, minutes: int, effort: "light"|"normal"|"heavy", estimated: bool, source: "说的"|"上次"|"估的"}`
  - fixed 一定有 start 和 end，minutes 由它俩算出来；
  - task 的 start 和 end 是 null。
- `Block` 加两个可选字段：
  - `pinned?: bool`：手动改过的块；
  - `item_id?: string`：来自当天事项的块，对应 DayItem.id。task 块里它等于 `task_id`，fixed 块里它等于 `id`。
- `GET /today` 和 `POST /day/say` 都多返回一个 `items: DayItem[]`。`/day/say` 的其余部分和 `GET /today` 的形状一样，也就是返回最新的、还没确认的那版计划。
- `POST /day/say {text}`：
  - 危机时返回 `{crisis: true, ...}`，和别的接口一样；
  - 解析失败返回 422，detail 是「没听清，换个说法或直接加」。
- `POST /plan/edit {version, block_id, start, end}`：返回 `GET /today` 的形状，另加 `overlaps: string[]`。version 不是最新版时返回 409。
- `DELETE /plan/block/{block_id}?version=N`：返回 `GET /today` 的形状。
- `POST /plan/reflow {version}`：返回 `GET /today` 的形状，另加 `before: Block[]`，是重排前那一版的块，给 `planDiff` 用。
- `POST /transcribe`（multipart，字段名 `audio`）：返回 `{text}`；没配转写返回 501。

## 评审后补的约定（分支评审第 1–7、10、13、14 条）
- 所有重排今天的地方（`/energy`、改设置、`/plan/reflow`、`/day/say`）走同一个函数 `reflow`：
  - 还没到起床时间就排整天；过了起床时间只排现在之后，已经过去和正在做的块照存着的原样留下。`/day/say` 也一样，今天还没有计划时先按设置排出今天本来的样子当「过去」（不存）。凌晨还算昨天时 `/day/say` 和 `/energy` 一样返回 409。
  - 钉住的块就是最新版计划里 `pinned: true` 的块，每次重排都带着：还没开始的当 fixed 喂求解器，排完换回原样；和正在做的块重叠、求解器没留下的也原样加回（允许重叠）。`/day/say` 替换事项时，原来事项的块不再钉住。
  - 今天必做的排不完不再 422：能排多少排多少，`warnings` 里加一句「今天剩下的时间排不下：写报告（还差 40 分钟）」。固定事项冲突等别的排不下照旧 422。已经过去和正在做的今天必做块按钟点分钟扣掉。
- 计划 JSON 多一个 `skipped: string[]`：今天删掉的习惯、可选项（块 id）和设置里的项目（任务 id），之后任何重排都不排它们。
- `/plan/edit`：带 `item_id` 的块（包括输出成 class 的说的固定事项）都能改。改了时长，事项的 `minutes` 改成今天排的总长、`estimated: false`、`source: "说的"`；说的固定事项挪了，事项的 `start`、`end` 跟着改。
- `DELETE /plan/block/{id}`：只有 must、proj、flex 和带 `item_id` 的块能删，课、吃饭、路上返回 422。
- `POST /plan/reflow` 另加 `overlaps: string[]`：和钉住的块撞上的块（两边都列）。
- 今天必做的块长按 5 分钟取整，不凑成 30 分钟的番茄（C28）。
- `/day/say` 一句话里有不合格的项：丢掉那一项，其余照排；全都不合格才 422「没听清」。
- `/transcribe`：先看 `Content-Length`（没有 411，超过 413），再看 `Origin`（不在白名单 403），然后才收请求体。
