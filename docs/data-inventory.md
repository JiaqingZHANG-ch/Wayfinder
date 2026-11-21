# Wayfinder 数据清单（第 8 周循环 ①：家庆来填）

看完 GDPR 开发者入门后，每一行填四格。填完请 Claude 点评。

- **用途**：为什么要存它；不存会少什么功能。
- **存在哪**：现在是 `var/app.db`（SQLite，本机）；第 7 周以后是 Supabase 的 Postgres。
- **发给谁**：本机 Ollama、DeepSeek、Google 日历，或者谁都不发。代码里查 `make_model`、`server/calendar.py` 的 `events_for`。
- **留多久**：现在都是一直留到用户删除。想想有没有该自动删的（比如 `model_calls`）。

最后一项检查：确认没有哪个字段在存「焦虑」「家庭」「回避的话题」这类标签。

| 表 | 主要字段 | 用途 | 存在哪 | 发给谁 | 留多久 |
|---|---|---|---|---|---|
| users | 时区、国家、是否成年 | | | | |
| consents | 同意了哪一版隐私说明、什么时候 | | | | |
| settings | 作息、习惯、保底版、能量地图、提醒时间 | | | | |
| day_plans | 每天每一版计划、电量、是否确认、是否写进日历 | | | | |
| day_logs | 每个事项做没做、卡在哪、一句话、明天的事 | | | | |
| messages | 建档和对账里用户说的话、导师的回答 | | | | |
| user_quotes | 被引用的原话、出自哪条消息 | | | | |
| profiles | 方向、目标等档案，是否确认 | | | | |
| deep_talks | 深度长谈每一步的回答、智囊团的看法、推迟次数、开始和完成时间 | | | | |
| weekly_reviews | 复盘统计、正文、调整和回答、带进下周的问题 | | | | |
| model_calls | 每次发给模型的全部内容、模型的回答、用时 | | | | |
| crisis_events | 触发危机提示的那段话、日期 | | | | |
| `var/google/` 里的文件 | Google 授权令牌、日历 id（不在数据库里） | | | | |

导出（`GET /export`）和删除（`DELETE /me`）覆盖上面数据库里的每张表；`tests/test_db.py` 的 `test_export_and_delete_cover_every_table` 管着：加了新表忘了登记会红。`var/google/` 的令牌不在删除范围内，删账号时要不要一起删，也请想一下。
