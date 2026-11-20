# Wayfinder 开发说明（第 2 周起）

## 每天用：一键打开

```powershell
.\wayfinder.ps1
```

开出三个窗口（本机 Ollama、后端、网页版），网页版起来后自动用浏览器打开 http://localhost:8081 。关掉窗口就停。默认用本机 qwen3:14b（你写的话不出电脑，一句话要等 20–30 秒）；想不用模型先 `$env:MODEL = 'fake'`。

一天怎么用：早上看首页计划 → 下课点「下课了，报电量」（电量 1–2 时晚上的习惯只排保底版）→ 晚上「晚间对账」点按钮或写一句话（填了「明天最想先做的一件事」，第二天会先排它一个番茄，第二天对账时它是第一项）→ 每周首页出现「每周复盘」时点进去。课表、习惯、项目在首页「设置」里改，保存时会先试排今天，排不出来就不存。

## 底座阶段改成「读懂 + 改一处」的循环（2026-11-20）

为了让你先能天天用，下面这些原来留给你写的地方我先写好了。对应的循环不用再从零写，改成：读懂那几行，然后自己改一处、跑测试看变化。

| 原来的循环 | 现在在哪 | 建议改的一处 |
|---|---|---|
| 第 2 周 ③ `days_with_note` | `src/server/db.py` | 把「note 不为空」改成「note 或 blocker 不为空」，看 `tests/test_db.py` 哪条变红 |
| 第 4 周 ① 设置页 | `mobile/src/app/settings.tsx` | 给课表加一个「这节课在哪个教室」的输入（前后端都要改） |
| 第 4 周 ② 能量地图 | `mobile/src/app/onboarding.tsx` 的 `EnergyPick` | 把三选一的说明文字改成你自己的说法（`mobile/src/labels.ts`） |
| 第 4 周 ④ / 第 1 周循环 4（C26 保底版） | `daily-planner/src/planner/solve.py` 的 `_low_energy` | 把 `LOW_ENERGY = 2` 改成 3，看 `tests/test_energy.py` 怎么变 |
| 第 4 周 ⑥ `stalest_profile` | `src/server/db.py` | 把 14 天改成 7 天，先改测试再改 SQL |

## 启动（开发时只开后端）

```powershell
.\serve.ps1
```

然后用浏览器打开 http://127.0.0.1:8000/docs ，每个接口都能点「Try it out」试。

- 数据库：`var/app.db`（不进 git）。想从头来，停掉服务后删掉它。
- 新数据库从建档开始。想跳过建档、直接用一份现成设置：先设 `$env:PLAN_TEMPLATE = '..\daily-planner\examples\users\学生.json'`（或别的求解器输入文件）。

## 换模型（循环 ⑥）

```powershell
$env:MODEL = 'ollama'      # 或 fake（默认）、deepseek
$env:OLLAMA_MODEL = 'qwen3:14b'   # 可不设，默认就是它
.\serve.ps1
```

`fake` 不会真的解析一句话，`POST /checkin` 发 `sentence` 会让你点按钮补；按钮结果（`result`）照常能存。

## 文件在哪

| 文件 | 做什么 |
|---|---|
| `src/server/api.py` | 全部接口，打开 `/docs` 看 |
| `src/server/db.py` | 建表（每张都带 `user_id`）和读写 |
| `src/mentor/tone.py` | 说话规则、禁用说法、`quote_is_verbatim` |
| `src/mentor/checkin.py` | 对账格式校验、一句话解析 |
| `src/mentor/model.py` | 模型出口 `make_model`：fake / ollama / deepseek |

## 第 2 周留给你的循环

- ② 给 `GET /today` 加一个字段：在 `api.py` 的 `out()` 里加，`/docs` 里看到它。
- ③ ~~在 `db.py` 的 `days_with_note` 里写一条 SELECT~~ 已写好，改成「读懂 + 改一处」（见开头的表）。
- ⑤ Ollama 和 qwen3:14b 已经装在 U 盘。先另开一个窗口运行 `AI工作空间\工具与运行环境\Ollama-启动.ps1`，再在这里：`$env:MODEL_TEST='ollama'; uv run pytest tests/test_checkin.py -k real`。
- ⑦ 在 `tests/test_tone.py` 的 `BAD` 里加 3 条坏示范，先红，再去 `tone.py` 的 `BANNED` 补说法，变绿。

## 第 3 周：网页版（`mobile/`，Expo SDK 58 + Expo Router）

先开后端 `.\serve.ps1`，再在另一个窗口 `.\web.ps1`，浏览器打开 http://localhost:8081 。

| 文件 | 做什么 |
|---|---|
| `mobile/src/app/index.tsx` | 今日计划页 |
| `mobile/src/app/checkin.tsx` | 晚间对账页（空壳：事项列表 + 一句话输入框） |
| `mobile/src/api.ts` | 调后端：`getToday`、`getWeek`、`checkinItems` |
| `mobile/src/labels.ts` | 按钮上的字：做了／做了保底／今天没做；比预想少／差不多／多 |

留给你的循环（代码里搜「循环 ③」「循环 ④」能找到位置）：
- ① 在 `AI工作空间\临时文件` 里自己另建一个练习项目 `npx create-expo-app@latest expo-practice`（项目名不能用中文），网页版能开，体会脚手架做了什么；正式项目已经在 `mobile/`。
- ② 改 `index.tsx` 的标题和颜色。
- ③ 对账页的三个按钮（点了变色）和「记录了几天」。
- ④ `api.ts` 里写 `postCheckin`，接上「记好了」按钮，把返回的 `closing` 显示出来；然后在 `/docs` 或数据库里查到这一条。

改完跑 `cd mobile; npx tsc --noEmit; npx expo lint`，两个都没报错再贴 diff。

## 第 4 周：建档、设置、报电量后重排

新数据库打开网页版会先跳到建档：两问方向（一次一问）→ 确认导师写的那句方向（可以改）→ 填作息和第一个习惯 → 第一张计划。首页的「下课了，报电量」进重排页。

| 文件 | 做什么 |
|---|---|
| `src/mentor/onboarding.py` | 建档的问题、每轮发给模型的内容 `build_messages`、一轮的处理 `run_round` |
| `src/server/settings.py` | 设置表单 ↔ 求解器输入；能量地图 热爱 0／累但回血 0.5／擅长但耗能 1 |
| `src/server/db.py` | 新增 `profiles`：模型只提议，确认了才算 |
| `mobile/src/app/onboarding.tsx` | 建档页（对话 + 确认方向 + React Hook Form 表单） |
| `mobile/src/app/energy.tsx` | 报电量 → 只重排今晚 → 「就这样」确认 |

留给你的循环：
- ① ~~加「设置」页~~ 已写好（作息、习惯、每周课表、项目、提醒），改成「读懂 + 改一处」。
- ② ~~能量地图三选一~~ 已写好，提交后用 `/docs` 的 `GET /settings` 看 `energy` 对了。
- ③ 画「点击 → 接口 → 求解器 → 数据库 → 页面」，在 `api.py` 的某个接口里加一行 `print`，终端能看到。
- ④ 报一次「电量 2」：C26 已实现，晚上的习惯只排保底版，标题带「（保底）」。
- ⑤ 在 Python 里打印一轮 `build_messages(...)` 的结果，逐段说出每段为什么在里面。
- ⑥ ~~`stalest_profile` 写查询~~ 已写好：确认过超过 14 天的那条方向，复盘时问「还对吗」。

## 第 5 周：手机和两条本地提醒

- `GET /today` 多了 `reminders`：下课那条（当天最后一节课结束时，没课就没有）、晚上那条（设置里的时间，默认 21:00）。文案在 `src/mentor/reminders.py`，`tests/test_reminders.py` 管禁用词。
- 手机上 `mobile/src/notifications.native.ts` 每次打开首页把今天还没到点的提醒重新定一遍，点通知直达 `/energy` 或 `/checkin`；网页版不定提醒。
- 设置接口多了 `reminders: {after_class, evening}`。

手机上怎么开：先 `$env:HOST = '0.0.0.0'; .\serve.ps1`，再 `.\phone.ps1`，iPhone 相机扫二维码进 Expo Go。第一次可能要在 Windows 防火墙里允许 Python 用专用网络（这一步你自己点）。后端没有登录，只在自己家的 Wi-Fi 这样开。

留给你的循环：
- ① iPhone 扫码打开，能看到今日计划。
- ② 在任意页面临时加一条 1 分钟后的通知（`scheduleNotificationAsync` 的 `TIME_INTERVAL`），手机收到后删掉。
- ③ 设置页里加两条提醒的时间和开关（`Settings.reminders`），改 `reminders.py` 文案时 `tests/test_reminders.py` 保持绿；到点收到，点开直达。
- ④ Android Studio 模拟器（SDK 目录放 U 盘）里跑一次。

## 第 6 周：每周复盘、「Wayfinder 计划」日历

**每周复盘**（`POST /review`）：最早一条对账满 6 天前、且 7 天内没复盘过，首页出现「满 7 天了，每周复盘 →」（`GET /week` 的 `review` 字段）。

- 数字全由 `src/mentor/review.py` 的 `week_stats` 从 `day_logs` 算；模型只写成话。正文里每个数字都得在统计里出现，「」里的话得是用户某天的原话（或事项名、规律里的卡点），否则重来一次，再不行用程序拼的几句事实。
- 调整最多 3 条（改标准版／改保底版／加一个习惯），点「好」才写进设置，今天的计划跟着换新版本；点过不能改口。
- 「还对吗」用 `db.stalest_profile`：确认过超过 14 天的那条方向才问。
- 带进下周的问题存在 `weekly_reviews.question`，下次复盘页顶上显示。
- 真模型（qwen3:14b）试了 3 次，2 次直接通过，1 次退回兜底句。模型偶尔会提方向不对的调整（比如说「保底太长」却把保底加长），格式合法就会出现，靠用户点「先不改」。

**日历**：`CALENDAR=off`（默认）／`fake`／`google`。确认计划后写入「Wayfinder 计划」日历，只写习惯、项目和可选项（课和吃饭不写），同一天再确认就整天换掉。授权失效时计划照样确认，App 提示重连。代码在 `src/server/calendar.py`，权限只要 `calendar.app.created`（只能动这个 App 自己建的日历）。

留给你的循环：
- ① 画 OAuth 授权流程。
- ② Google Cloud 建测试项目 → 打开 Calendar API → 建「桌面应用」OAuth 客户端 → 把 `credentials.json` 放到 `var/google/` → `uv run python -m server.calendar` 授权一次。
- ③ `$env:CALENDAR = 'google'; .\serve.ps1`，网页版报一次电量并点「就这样」，Google 日历里出现「Wayfinder 计划」。
- ④ 在 Google 账号里撤销授权，再确认一次：App 提示要重连；重新跑 ② 的最后一步。
- ⑤ 用假数据走一遍复盘（`tests/test_api.py` 里的 `seed_week` 可以照抄）。
- ⑥ 自己写「每个习惯做了几天 / 记录了几天」的 SQL（`day_logs.items` 是 JSON，SQLite 用 `json_each`），和 `week_stats` 的结果对上。

## 第 7 周：搬到 Supabase 的准备（还没装 Docker）

已经备好、但都还没在真的 Postgres 上跑过：

| 文件 | 做什么 |
|---|---|
| `supabase/migrations/20261120000000_init.sql` | 建表（user_id 换成登录账号的 uuid，JSON 换 jsonb）+ 每张表打开 RLS + 「只能看和改自己」 |
| `supabase/tests/database/isolation.test.sql` | 隔离测试：A、B 两个账号互相看不到、改不了、删不了；没登录什么都看不到 |
| `src/server/migrate_pg.py` | 把 SQLite 里一个用户的数据写成 Postgres 的 INSERT（`tests/test_migrate_pg.py` 管：加了新表忘了搬会红） |
| `src/mentor/model.py` 的 `RecordingModel`、`replay` | 循环 ⑤：每次调模型记一条到 `model_calls`（发了什么、回了什么、哪个模型、多少毫秒），能用假模型原样回放 |

两个 SQL 文件用 Postgres 的解析器（pglast）检查过语法；外键、RLS 实际效果要等 `supabase test db`。

后端现在仍然用 SQLite、只有一个本机用户（`USER_ID = 1`）。换成「App 用 Supabase 登录、后端按登录的人取 user_id、数据存 Postgres」要等 Docker 装好再做。

留给你的循环：
- ① 装 Docker（数据目录放 U 盘），`supabase init` 后把上面的 `supabase/` 文件放进去，`supabase start` 能起。装 Docker 会改系统设置，这一步你自己来。
- ② Supabase 的 React Native Auth：本地账号能登录。
- ③ 在迁移文件末尾写 `user_quotes` 的「只能看自己」规则 → `supabase test db` 全绿；故意写错（比如 `using (true)`）→ 看「A 只看到自己的 user_quotes」变红。
- ④ `uv run python -m server.migrate_pg var/app.db <你的 uuid> > var/migrate.sql`，用 psql 导入，挑一天对一下数据。
- ⑤ 挑一条 `model_calls` 记录，用 `replay(记录)` 当模型重跑一次（`tests/test_api.py` 的 `test_every_model_call_is_recorded_and_can_be_replayed` 是样子），结果一样。

## 第 8 周：隐私（同意、导出、删除、按国家的热线）

- 第一次打开先看隐私说明（`src/server/privacy.py`，改了内容就把版本号加 1，老用户下次打开首页会先看到新版），选国家、勾成年，点「同意，开始」才进建档；没同意，`POST /onboarding` 回 409。接口：`GET /me`、`PUT /me`。
- 危机提示按国家显示热线：中国 12356、法国 3114（2026-11-14 核实过）；别的国家或没填就两边都列。号码在 `src/mentor/safety.py` 的 `HOTLINES`。
- 首页「我的数据 →」：换国家、导出（`GET /export`，网页版下载 JSON，手机上走系统分享）、删除（`DELETE /me?confirm=true`，删完回到同意页）。
- 导出和删除覆盖数据库里的每张表（`db.USER_TABLES`）。已经写进 Google 日历的计划、`var/google/` 里的授权令牌不在删除范围里，页面上说明了。
- 「是否成年」只记下来，不拦人（家庆 2026-11-20 定的）。未成年人照常能用，不要求监护人同意。

留给你的循环：
- ① 填 `docs/data-inventory.md` 的数据清单，确认没有字段在存焦虑、家庭、回避的话题。
- ② 自己导出一次，再删除一次，用 `/docs` 或 SQLite 查库，确认查不到。
- ③ 用两周的真实数据看一次复盘，自己提一个想改的参数（比如 `review.py` 的 `PATTERN_DAYS`），改完测试全绿。
- ④ 列一张表：Ollama 连不上、超时、格式错、命中禁用词、危机词、Google 日历授权失效，各走哪条路，每一行对上一个测试的名字。

跑全部测试：`uv run pytest -q`（要先运行过 `加载AI工作空间.ps1`，缓存才落在 U 盘）。
