# 合并版 App 后端（第 2 周）

## 启动

```powershell
.\serve.ps1
```

然后用浏览器打开 http://127.0.0.1:8000/docs ，每个接口都能点「Try it out」试。

- 数据库：`var/app.db`（不进 git）。想从头来，停掉服务后删掉它。
- 第 4 周做建档之前，第一次启动会拿 daily-planner 的假用户「学生」当设置。换成别的：先设 `$env:PLAN_TEMPLATE = '某个输入文件.json'`。

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

跑全部测试：`uv run pytest -q`（要先运行过 `加载AI工作空间.ps1`，缓存才落在 U 盘）。
