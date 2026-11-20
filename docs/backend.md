# Wayfinder 开发说明（第 2 周起）

## 启动

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
| `src/server/api.py` | 五个接口：`/today` `/energy` `/plan/confirm` `/checkin` `/week` |
| `src/server/db.py` | 建表（每张都带 `user_id`）和读写 |
| `src/mentor/tone.py` | 说话规则、禁用说法、`quote_is_verbatim` |
| `src/mentor/checkin.py` | 对账格式校验、一句话解析 |
| `src/mentor/model.py` | 模型出口 `make_model`：fake / ollama / deepseek |

## 第 2 周留给你的循环

- ② 给 `GET /today` 加一个字段：在 `api.py` 的 `out()` 里加，`/docs` 里看到它。
- ③ 在 `db.py` 的 `days_with_note` 里写一条 SELECT，删掉 `tests/test_db.py` 里 `test_loop3_days_with_note` 上面的 skip，跑到变绿。
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
- ① 加「设置」页（`mobile/src/app/settings.tsx`）并从首页能跳过去；内容可以先用 `getSettings()` 读出来显示。
- ② 在 `onboarding.tsx` 的表单里加能量地图三选一（搜「循环 ②」），提交后用 `/docs` 的 `GET /settings` 看 `energy` 对了。
- ③ 画「点击 → 接口 → 求解器 → 数据库 → 页面」，在 `api.py` 的某个接口里加一行 `print`，终端能看到。
- ④ 报一次「电量 2」。注意：晚上只剩保底版要等第 1 周循环 4（C26 保底版），你先写测试，AI 再实现。
- ⑤ 在 Python 里打印一轮 `build_messages(...)` 的结果，逐段说出每段为什么在里面。
- ⑥ 在 `db.py` 的 `stalest_profile` 写查询，删掉 `tests/test_db.py` 里 `test_loop6_stalest_profile` 的 skip，变绿。

跑全部测试：`uv run pytest -q`（要先运行过 `加载AI工作空间.ps1`，缓存才落在 U 盘）。
