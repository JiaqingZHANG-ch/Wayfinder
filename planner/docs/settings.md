# 输入格式（用户设置 + 当天的事）

求解器读一个 JSON 文件，排出一天的计划：

```powershell
uv run python -m planner <输入.json> -o <输出.json>
```

时间都写成 `"HH:MM"`。没写的字段用下面表格里的默认值。示例见 `examples/users/` 里的三个假用户：上班族、学生、晚上很少有空。

## 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `day` | 是 | 哪一天，`"2026-11-24"` |
| `wake`、`sleep` | 是 | 起床、上床时间。所有事都排在这两个时间之间 |
| `energy_level` | 否 | 当天自报电量 1–5。不填就不按电量调整 |
| `rules` | 否 | 作息和通勤规则，见下 |
| `energy` | 否 | 精力预算，见下 |
| `fixed` | 否 | 固定的事：上课、考试、开会、上班、打工 |
| `bus_to_campus`、`bus_to_home` | 否 | 班次表。两样都不填，就按 `campus_travel_min` 估路上时间 |
| `meals` | 否 | 三餐 |
| `habits` | 否 | 每天必做的习惯 |
| `habit_block` | 否 | 要连成一整段做的习惯 id，按顺序排，比如 `["english", "reading"]` |
| `flex` | 否 | 能做就做的事，比如健身、打电话 |
| `tasks` | 否 | 项目（要分几天做完的事） |

## `rules`

| 字段 | 默认 | 说明 |
|---|---|---|
| `min_gap_min` | 5 | 事与事之间留的转场分钟数（C03） |
| `getup_min` | 15 | 起床后多久才开始排事 |
| `leave_after_class_min` | 20 | 最后一节课下课后多久离开教学楼（C02） |
| `arrive_before_min` | 10 | 到学校后走到教室要几分钟；去程要在上课前这么久到（C25） |
| `campus_travel_min` | 30 | 没有班次表时，家到学校的单程分钟数（含步行） |
| `other_travel_min` | 30 | 去「其他地点」（`where: "other"`）的单程分钟数 |
| `min_sleep_min` | 480 | 复查用：睡觉到第二天起床至少多少分钟 |

## `energy`

| 字段 | 默认 | 说明 |
|---|---|---|
| `base_min` | 480 | 一天的精力，按分钟算（C16） |
| `gym_bonus_min` | 120 | 健身排上了，精力加多少 |
| `gym_id` | `"gym"` | 哪个 `flex` 算健身 |
| `load` | 0.8 | 最多用掉精力的几成 |
| `periods` | `[["12:00", 2.0], ["18:00", 1.5], ["24:00", 1.0]]` | 时段效率：到几点为止、效率多少。最后一段要盖过上床时间（C15） |
| `cost` | `{"class": 1, "project": 1, "habit": 1}` | 每小时扣多少精力。键可以是 `class`、`project`、`habit`，也可以是某门课、某个任务、某个习惯的 id。0 = 热爱的事，不扣精力（C24） |
| `pomodoro_decay` | `[1.0, 0.85, 0.7]` | 一块里第 1、2、3 个番茄的效率；长度就是一块最多几个番茄（C17） |
| `rest_after_focus_min` | 30 | 两段专注之间至少放松多久（C18） |
| `min_free_min` | 120 | 每天自由时间至少多少分钟，填 0 表示不要求，否则至少 30（C19） |

## 列表里每一项

**`fixed`**：`id`、`title`、`start`、`end`、`where`（`home` / `campus` / `other`）、`kind`（`class` / `exam` / `meeting` / `tentative`）。

**`meals`、`flex`**：`id`、`title`、`minutes`、`window`（`["开始", "结束"]`，在这个窗口里排）。

**`habits`**：在上面几项之外，还有：
- `floor_min`：保底版分钟数，不填等于 `minutes`。
- `where`：`home` / `campus` / `any`，默认 `any`。
- `can_be_on_bus`：能不能在去学校的路上做，默认 `false`。

**`tasks`**：
- `id`、`project`、`title`；
- `remaining_min`：还差多少分钟；
- `deadline`：可以不填；
- `heavy`：费劲的事，排成大块；
- `where`；
- `steps`、`done_criteria`：给人看的步骤和完成标志；
- `est_factor`：估时放大系数，默认 1.0；
- `must_today`：今天必须做完，默认 `false`。为 `true` 时 `remaining_min` 今天全部排完（按钟点分钟，不按时段效率折算），超出精力上限也照排，块长按 5 分钟取整；排不下就报错并点名，`soft_must` 时改成写进 warnings（C28）。
- `first`：昨晚定的「明天的一件事」，默认 `false`。为 `true` 时权重翻倍：今天必做的排不下时先保它，不让给拉长别的事。

## 只重排今晚

代码里调用 `replan_from(输入, "18:00", ["reading"])`：
- 18:00 之前开始的块原样保留；
- `reading` 已经做完，不再排；
- 其余的事从 18:00 起重新排（C27）。

接口在第 2 周做。
