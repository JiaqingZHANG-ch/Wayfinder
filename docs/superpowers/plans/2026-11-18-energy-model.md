# 第二步：精力模型 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让求解器在排一天时同时算精力预算、时段效率、番茄节奏、专注后的放松和自由时间下限（约束清单 C14–C19）。

**Architecture:** 仍是 `src/planner/solve.py` 里的一个 CP-SAT 模型，不拆新模块。项目块改成「1–3 个番茄 × 所在时段」的独热布尔变量，进度和精力都从它线性算出；放松间隔是再加一组 NoOverlap；自由时间用几个「预留空档」区间变量保证下限，求解后再从实际空档生成自由时间块。`check.py` 不依赖求解器内部，自己重算一遍。

**Tech Stack:** Python 3.12（uv）、OR-Tools CP-SAT、pytest。跑测试：`uv run pytest -q`。

**Spec:** `docs/superpowers/specs/2026-11-18-energy-design.md`（先通读，尤其 §4.7）；约束清单 `docs/constraints.md`。

## Global Constraints

- 分支 `step2-energy`，不推送。每个任务结束时 `uv run pytest -q` 全绿再提交。
- 所有参数来自输入的 `energy`（默认值见 Task 1），代码里不写死 480、0.8、30、120 这些数。
- 只有两个按 id 的约定：flex 的 id 为 `gym` 才给精力加成；精力系数按 `cost.get(id, 默认)` 查。
- 番茄 = 30 分钟（25 做事 + 5 放松），块长只能是 30/60/90。
- 旧输入（没有 `energy`、`habit_block`）必须照样能读能解。
- 单线程、固定种子、结果可复现（`test_solve_is_deterministic` 不许改松）。
- 不加设计里没有的选项、检查或输出字段。

## 计划里定下的事（设计 §7 留给实现者的，加上设计没说到的）

1. `habit_block` 默认是 `[]`；`examples/2026-11-16.json` 里显式写上三项（Task 4）。里面写了但 `habits` 里没有的 id 直接忽略。
2. 车上听的英语不算专注段（否则 07:41 到站、08:00 上课就违反 30 分钟间隔），精力按 0.5 算。
3. `tentative` 的固定事件不扣精力、不算专注段；`class`/`exam`/`meeting` 都算。
4. flex 的精力系数是 `cost.get(id, 0)`（健身、打电话都是 0）。
5. 块的进度 = `round(25 × 时段效率 × sum(decay[:n]))`，取整到分钟。注意：按这个公式，早上 60 分钟的进度是 92，不是设计 §4.1 举例说的 120（举例没算 5 分钟休息和损耗），以公式为准。
6. 「不能多出一整个番茄」的精确含义：任何一块去掉它最后一个番茄后，任务的总进度必须 < 剩余量。
7. 「今天…不排项目」的提示在可选预算 < 30 分钟（排不下一个番茄）时就出，不只是 ≤ 0 时。
8. 紧急度用的「一天能干多少」= 不算健身的可选预算；< 30 时退回 240。
9. 「等车不算自由时间」落实为：紧挨在 `bus-back` 前面的空档不算。
10. `Rules.heavy_min_block`/`light_min_block`、`Task.min_block`/`max_block` 保留读取（旧 JSON 要能读），求解器不再用。
11. 第一步的「课满 6 小时的日子 heavy 任务不排在 18:00 之后」保留不动。

## Review Focus

1. 旧输入没有 `energy`/`habit_block` → 用默认值正常求解（Task 1 的测试）。
2. `energy.periods` 没覆盖到睡觉时间或不是升序 → `InputError`，不是求解器里崩（Task 1）。
3. 剩余量很小（10 分钟）或固定消耗已超预算（可选预算为 0）→ 不除零、不崩，最多排 1 个番茄 / 不排项目（Task 2、Task 3）。
4. `habit_block` 里的 id 被改名或删掉 → 忽略那一项，其余照常成块（Task 4）。
5. 一天挤到留不出 120 分钟自由时间 → `PlanInfeasible`，消息里说的是自由时间，不是去怪某个习惯（Task 6）。

## 文件

| 文件 | 改什么 |
|---|---|
| `src/planner/model.py` | `Energy` 数据类、`PlanInput.energy`、`PlanInput.habit_block`、校验 |
| `src/planner/solve.py` | 番茄块、精力预算、习惯块、放松间隔、自由时间；`Block`/`DayPlan` 加字段；删 `daily_cap` |
| `src/planner/check.py` | 五条新自检 |
| `src/planner/output.py` | 番茄数、进度、精力 |
| `tests/conftest.py`（新） | `home_day`、`light_day` 两个 fixture |
| `tests/test_energy.py`（新） | 这一步的全部新测试 |
| `examples/2026-11-16.json`、`docs/constraints.md` | 加 `habit_block`；C14–C19 改成「已实现」 |

---

### Task 1: 输入模型（`Energy`、`habit_block`）

**Files:** Modify `src/planner/model.py`；Test `tests/test_model.py`

**Interfaces — Produces:**

```python
@dataclass
class Energy:
    base_min: int = 480
    gym_bonus_min: int = 120
    load: float = 0.8
    periods: list[tuple[int, float]] = field(default_factory=lambda: [(720, 2.0), (1080, 1.5), (1440, 1.0)])  # (结束分钟, 效率)
    cost: dict[str, float] = field(default_factory=lambda: {"class": 1.0, "project": 1.0, "habit": 1.0, "calligraphy": 0.5})
    pomodoro_decay: list[float] = field(default_factory=lambda: [1.0, 0.85, 0.7])  # 长度 = 一块最多几个番茄
    rest_after_focus_min: int = 30
    min_free_min: int = 120
# PlanInput 末尾加两个带默认值的字段：
#   energy: Energy = field(default_factory=Energy)
#   habit_block: list[str] = field(default_factory=list)
```

- [ ] **Step 1: 写失败的测试**（`tests/test_model.py`）

```python
def test_energy_defaults_when_absent():
    inp = load_input(EXAMPLE)  # 例子里此时还没有 energy / habit_block
    assert inp.energy.base_min == 480 and inp.energy.load == 0.8
    assert inp.energy.periods == [(720, 2.0), (1080, 1.5), (1440, 1.0)]
    assert inp.habit_block == []

def test_energy_overrides(tmp_path):
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    raw["energy"] = {"base_min": 420, "periods": [["13:00", 2.0], ["24:00", 1.0]], "cost": {"calligraphy": 0.2}}
    raw["habit_block"] = ["reading", "calligraphy"]
    p = tmp_path / "in.json"; p.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    inp = load_input(p)
    assert inp.energy.base_min == 420 and inp.energy.gym_bonus_min == 120
    assert inp.energy.periods == [(780, 2.0), (1440, 1.0)]
    assert inp.energy.cost == {"class": 1.0, "project": 1.0, "habit": 1.0, "calligraphy": 0.2}  # 和默认值合并
    assert inp.habit_block == ["reading", "calligraphy"]

@pytest.mark.parametrize("energy", [
    {"periods": [["12:00", 2.0], ["18:00", 1.5]]},   # 没覆盖到 22:00 睡觉
    {"periods": [["18:00", 2.0], ["12:00", 1.5], ["24:00", 1.0]]},  # 不是升序
    {"load": 0}, {"pomodoro_decay": []},
])
def test_bad_energy_rejected(tmp_path, energy):
    ...  # 同上写文件，raw["energy"] = energy
    with pytest.raises(InputError):
        load_input(p)
```

- [ ] **Step 2:** `uv run pytest tests/test_model.py -q` → 新测试 FAIL（`PlanInput` 没有 `energy`）。
- [ ] **Step 3: 实现。** `_load` 里读 `raw.get("energy", {})`：`periods` 用 `to_min` 换算，`cost` 用 `{**默认, **输入}` 合并，其余键直接覆盖。`_validate` 加：`periods` 的结束时间严格升序且最后一个 ≥ `inp.sleep`；`0 < load <= 1`；`pomodoro_decay` 非空。`Rules.heavy_min_block`、`light_min_block` 旁边加一行注释「第二步起求解器不再用，留着是为了旧输入能读」。
- [ ] **Step 4:** `uv run pytest -q` → 全绿（33+ 个）。
- [ ] **Step 5:** `git commit -m "feat: energy and habit_block input with defaults"`

---

### Task 2: 番茄块、时段效率、进度（C15、C17）

**Files:** Modify `src/planner/solve.py`、`examples/2026-11-16.json`（删掉 `rules` 里的 `heavy_min_block`、`light_min_block`）；Create `tests/conftest.py`、`tests/test_energy.py`；Modify `tests/test_solve_tasks.py`

**Interfaces — Produces:**
- `solve.POMODORO_MIN = 30`、`solve.FOCUS_MIN = 25`
- `solve.block_progress(eff: float, n: int, decay: list[float]) -> int`（`round(FOCUS_MIN * eff * sum(decay[:n]))`）
- `Block` 加 `pomodoros: int | None = None`、`progress_min: int | None = None`（只有 proj 块有值）
- fixture `home_day`、`light_day`（返回 `PlanInput`）

- [ ] **Step 1: 建 fixture**（`tests/conftest.py`）

```python
EXAMPLE = Path(__file__).parent.parent / "examples" / "2026-11-16.json"

@pytest.fixture
def home_day():   # 在家的一天：没课、没 flex，四个任务都在
    inp = load_input(EXAMPLE); inp.fixed, inp.flex = [], []; return inp

@pytest.fixture
def light_day():  # 只有早上一节 CM（08:00–10:00），回程 12:51
    inp = load_input(EXAMPLE); inp.fixed = [e for e in inp.fixed if e.id == "cm-parallele"]; return inp
```

- [ ] **Step 2: 写失败的测试**（`tests/test_energy.py`；`proj(plan)` = kind 为 proj 的块，`task(inp, id)` 同 `test_solve_tasks.py`）

```python
def test_block_progress_decay():
    d = [1.0, 0.85, 0.7]
    assert [block_progress(1.0, n, d) for n in (1, 2, 3)] == [25, 46, 64]   # 第 3 个番茄只加 0.7×25
    assert block_progress(2.0, 1, d) == 50 and block_progress(1.5, 3, d) == 96

def test_blocks_are_pomodoros(home_day):
    heavy = {t.id for t in home_day.tasks if t.heavy}
    blocks = proj(solve_day(home_day))
    assert blocks
    for b in blocks:
        assert b.end - b.start in (30, 60, 90) and b.pomodoros == (b.end - b.start) // 30
        assert b.task_id not in heavy or b.pomodoros >= 2
        assert not any(b.start < edge < b.end for edge in (720, 1080))       # 不跨时段
        eff = 2.0 if b.end <= 720 else 1.5 if b.end <= 1080 else 1.0
        assert b.progress_min == block_progress(eff, b.pomodoros, home_day.energy.pomodoro_decay)

def test_hard_task_lands_in_morning(home_day):
    home_day.tasks = [task(home_day, "gnn")]
    assert min(b.start for b in proj(solve_day(home_day))) < to_min("12:00")

def test_no_extra_pomodoro(home_day):     # 剩 60：早上 2 个番茄（92）够了，第 3 个不许排
    home_day.tasks = [task(home_day, "egg-flow")]; home_day.tasks[0].remaining_min = 60
    assert sum(b.pomodoros for b in proj(solve_day(home_day))) == 2

def test_tiny_remainder(home_day):        # Review Focus 3
    home_day.tasks = [task(home_day, "egg-flow")]; home_day.tasks[0].remaining_min = 10
    assert sum(b.pomodoros for b in proj(solve_day(home_day))) <= 1
```

改 `test_heavy_task_remainder_block`（设计 §4.7 第 5 条：不到 60 分钟的 heavy 任务可以只排 1 个番茄；块长不再等于剩余量）：断言换成 `len(gnn) == 1 and minutes(gnn) == 30 and gnn[0].progress_min == 50`。

- [ ] **Step 3:** `uv run pytest tests/test_energy.py tests/test_solve_tasks.py -q` → FAIL。
- [ ] **Step 4: 实现。** 改 `_solve` 里 `for t in tasks` 的循环，每块（`BLOCKS_PER_TASK` 不变）：

```python
periods = [(start_j, end_j, eff_j)]            # 由 inp.energy.periods 得到，start_0 = 0
N = len(inp.energy.pomodoro_decay)             # 一块最多几个番茄
lb_n = 2 if t.heavy and need_min(t) >= 60 else 1
y = {(j, k): m.NewBoolVar(...) for j in periods for k in range(lb_n, N + 1)}
m.Add(sum(y.values()) == p)                                    # 存在 ⇔ 恰好选一个（时段, 番茄数）
m.Add(d == POMODORO_MIN * sum(k * v for (j, k), v in y.items()))
for (j, k), v in y.items():
    m.Add(s >= start_j).OnlyEnforceIf(v); m.Add(e <= end_j).OnlyEnforceIf(v)
prog = sum(block_progress(eff_j, k, decay) * v ...)            # 这一块的进度
last = sum((block_progress(eff_j, k, decay) - block_progress(eff_j, k - 1, decay)) * v ...)
# 整个任务（total = 各块 prog 之和）：
for 每一块: m.Add(total - last <= need_min(t) - 1).OnlyEnforceIf(p)
```

  - 删掉 `d >= lb`、`sum(task_durs) <= need_min(t)` 和对 `t.min_block`/`t.max_block` 的使用；跳过条件 `z - a < lb` 里的 `lb` 换成 `POMODORO_MIN * lb_n`。
  - 目标里 `w * 1440 * d` 换成 `w * 1440 * prog`（进度高的时段自然被优先用）；其余两项不动。
  - 求解后给 proj 块填 `pomodoros`、`progress_min`。`sum(durations) <= cap` 这一步先留着。
- [ ] **Step 5:** `uv run pytest -q` → 全绿。`test_egg_in_campus_gap`、`test_cv_before_gnn`、`test_cap_respected` 这一步应该仍然通过；如果有一个因为块长变成 30 的倍数而失败，只改那一条断言并在提交说明里写原因，不许放松规则。
- [ ] **Step 6:** `git commit -m "feat: pomodoro blocks with period efficiency and decay (C15, C17)"`，说明里写：`heavy_min_block`=120 作废。

---

### Task 3: 精力总账，取代 `daily_cap`（C16）

**Files:** Modify `src/planner/solve.py`、`tests/test_energy.py`、`tests/test_solve_tasks.py`、`tests/test_check.py`

**Interfaces — Produces:**
- `solve.GYM_ID = "gym"`、`solve.ON_BUS_COST = 0.5`、`solve.FOCUS_KINDS = ("class", "exam", "meeting")`
- `solve.energy_cap(inp: PlanInput, gym: bool) -> float`：`load × (base_min + gym_bonus_min × gym)`
- `solve.fixed_cost(inp: PlanInput, c: Commute) -> float`：`FOCUS_KINDS` 的固定事件 × `cost["class"]` + 每个习惯 × `cost.get(h.id, cost["habit"])`（车上听的那个 × `ON_BUS_COST`）
- `solve.day_capacity(inp: PlanInput, c: Commute) -> int`：`max(0, energy_cap(inp, False) − fixed_cost)`，< 30 时返回 240
- `DayPlan` 加 `energy_used: float = 0.0`、`energy_cap: float = 0.0`
- 删除 `solve.daily_cap`；`urgency.py` 不改（参数名 `daily_cap` 保留，调用方传 `day_capacity`）

- [ ] **Step 1: 写失败的测试**（`tests/test_energy.py`）

```python
def home_class(inp, start, end):   # 在家上的网课
    inp.fixed = [FixedEvent("net", "网课", to_min(start), to_min(end), "home", "class")]

def test_budget_squeezes_projects(home_day):      # 课 240 + 必做 100 = 340，上限 384 → 只剩 44
    home_class(home_day, "08:00", "12:00")
    plan = solve_day(home_day)
    assert plan.energy_cap == 384 and minutes(proj(plan)) == 30
    assert plan.energy_used == 340 + 30

def test_gym_adds_budget(home_day):               # 健身 → 上限 480 → 剩 140
    home_class(home_day, "08:00", "12:00")
    home_day.flex = [Flex("gym", "健身", 120, to_min("14:00"), to_min("16:00"))]
    plan = solve_day(home_day)
    assert any(b.id == "gym" for b in plan.blocks) and plan.energy_cap == 480
    assert 30 < minutes(proj(plan)) <= 140

def test_over_budget_day_keeps_musts():           # 11-16：课和考试 360 + 必做 85 > 384（§4.7 第 1 条）
    inp = load_input(EXAMPLE)
    plan = solve_day(inp)
    assert proj(plan) == [] and any("不排项目" in w for w in plan.warnings)
    assert {h.id for h in inp.habits} <= {b.id for b in plan.blocks}
```

必须跟着改的旧测试（原因：11-16 这天按新规则不排项目）：
  - `test_egg_in_campus_gap`：改用 `light_day`，课间空档换成 `10:00`–`12:51`，在家任务的断言换成 `b.end <= to_min("07:11") or b.start >= to_min("13:14")`。
  - `test_cv_before_gnn`：改用 `light_day`，`daily_cap(inp)` 换成 `day_capacity(inp, pick_commute(inp))`。
  - `test_cap_respected`：删除（被上面三个新测试取代）；「满课日 heavy 不排晚上」的断言移到一个新测试 `test_full_day_no_heavy_evening`：例子把三节课的 `where` 改成 `home` 不行（仍超预算），所以直接断言 11-16 的方案里没有任何 proj 块在 18:00 之后。
  - `test_to_r2_shape`：改用 `light_day`。
  - `test_overload_warns`、`test_deadline_passed_warns`：不用改（容量退回 240，仍会警告），跑一下确认。

- [ ] **Step 2:** `uv run pytest tests/test_energy.py -q` → 三个新测试 FAIL。
- [ ] **Step 3: 实现。** `_solve` 里用整数（×100）：

```python
fixed = round(100 * fixed_cost(inp, c))
allow = [max(0, round(100 * energy_cap(inp, g)) - fixed) for g in (False, True)]
gym = <id 为 GYM_ID 的 flex 的 presence，没有就是 0>
optional = round(100 * cost["project"]) * sum(durations) + sum(round(100 * cost.get(f.id, 0) * f.minutes) * p_f ...)
m.Add(optional <= allow[0] + (allow[1] - allow[0]) * gym)      # 取代 sum(durations) <= cap
```

  返回的 `DayPlan` 填 `energy_cap`（按健身是否排上）和 `energy_used`（固定 + 可选，单位分钟）。`solve_day` 里：可选预算（按实际的健身状态）< 30 时加警告 `f"今天课和必做已经用掉 {fixed_cost / 60:.1f} 小时精力，晚上不排项目"`。`weight`、`_why`、`_warnings` 原来传 `daily_cap(inp)` 的地方都传 `day_capacity(inp, c)`。`class_minutes` 留着（`full_day` 还在用）。
- [ ] **Step 4:** `uv run pytest -q` → 全绿。
- [ ] **Step 5:** `git commit -m "feat: daily energy budget replaces daily_cap (C16)"`，说明里列出改了哪些旧测试和原因。

---

### Task 4: 习惯成块（C14）

**Files:** Modify `src/planner/solve.py`、`examples/2026-11-16.json`（顶层加 `"habit_block": ["english", "reading", "calligraphy"]`）、`tests/test_energy.py`、`tests/test_solve_core.py`、`tests/test_review_fixes.py`

- [ ] **Step 1: 写失败的测试**

```python
def by_id(plan, i): return next(b for b in plan.blocks if b.id == i)

def test_habit_block_contiguous_at_home(home_day):
    plan = solve_day(home_day)
    e, r, k = (by_id(plan, i) for i in ("english", "reading", "calligraphy"))
    assert e.end == r.start and r.end == k.start and (e.end - e.start, r.end - r.start, k.end - k.start) == (30, 30, 20)
    assert k.end <= to_min("12:00")                      # 越早越好，窗口不再是各自的

def test_habit_block_shrinks_when_english_on_bus():      # 11-16：英语在车上，块只剩看书 → 练字，落在到家之后
    plan = solve_day(load_input(EXAMPLE))
    r, k = by_id(plan, "reading"), by_id(plan, "calligraphy")
    assert r.end == k.start and r.start >= to_min("18:16")
    assert by_id(plan, "english").start == to_min("07:11")

def test_habit_block_unknown_id_ignored(home_day):       # Review Focus 4
    home_day.habit_block = ["english", "nope", "reading"]
    plan = solve_day(home_day)
    assert by_id(plan, "english").end == by_id(plan, "reading").start
```

必须跟着改的旧测试：
  - `test_monday_core_feasible`：「非生活类的事之间 ≥ 5 分钟」对块内相邻的两项不成立，循环里跳过 `x.id` 和 `y.id` 都在 `inp.habit_block` 里的一对。
  - `test_home_habit_not_on_campus`：它测的是「不成块的习惯仍守自己的窗口和地点」，在 `change` 里加 `raw.pop("habit_block")`。

- [ ] **Step 2:** `uv run pytest tests/test_energy.py -q` → FAIL。
- [ ] **Step 3: 实现。** `_solve` 里：`members` = `inp.habit_block` 里按顺序、存在于参数 `habits`、且不是 `on_bus` 的习惯。`len(members) >= 2` 时把它们从逐个习惯的循环里拿掉，改成调一次 `add(...)`：时长是各项之和，窗口 `(work_lo, hi)`，`padded=True`，任一成员 `where == "home"` 就 `at_home=True`；排不下同样 `return None`。求解后把这一段按顺序切成各成员自己的 `Block`（id、title、kind="must" 不变），首尾相接。只剩 0 或 1 个成员时走原来的逐个路径（用它自己的窗口）。
- [ ] **Step 4:** `uv run pytest -q` → 全绿。
- [ ] **Step 5:** `git commit -m "feat: english-reading-calligraphy as one habit block (C14)"`

---

### Task 5: 两段专注之间放松 30 分钟（C18）

**Files:** Modify `src/planner/solve.py`、`tests/test_energy.py`

- [ ] **Step 1: 写失败的测试**

```python
def focus(plan, inp):   # 项目块和必做；车上听的英语不算
    bus = next((b for b in plan.blocks if b.id == "bus-out"), None)
    return sorted((b for b in plan.blocks if b.kind in ("proj", "must") and not (bus and b.start < bus.end and bus.start < b.end)),
                  key=lambda b: b.start)

def test_rest_between_focus(home_day):
    f = focus(solve_day(home_day), home_day)
    assert len(f) >= 5
    for x, y in zip(f, f[1:]):
        if not (x.id in home_day.habit_block and y.id in home_day.habit_block):
            assert y.start - x.end >= 30, (x.id, y.id)

def test_rest_around_class(home_day):
    home_class(home_day, "09:00", "10:00")
    for b in focus(solve_day(home_day), home_day):
        assert b.end <= to_min("08:30") or b.start >= to_min("10:30"), b.id
```

（课和课之间不检查：11-16 的 10:00 下课、10:15 考试仍然可解，已有测试覆盖。）

- [ ] **Step 2:** `uv run pytest tests/test_energy.py -q` → 两个新测试 FAIL。
- [ ] **Step 3: 实现。** 仿照现有的 `gapped`，再建一组 `focus_ivs`，`rest = inp.energy.rest_after_focus_min`：
  - `FOCUS_KINDS` 的固定事件：区间 `(start, end + min(rest, 下一个这类固定事件的开始 − end))`（课表自己定的间隔照实际留）。
  - 习惯块、单独的习惯、每个项目块：区间 `(s, 时长 + rest)`（项目块用 Optional）。给 `add(...)` 加一个 `focus: bool = False` 参数即可。
  - 车上听的英语、三餐、通勤、flex 都不进这一组。
  - `m.AddNoOverlap(focus_ivs)`。
- [ ] **Step 4:** `uv run pytest -q` → 全绿。
- [ ] **Step 5:** `git commit -m "feat: 30 min rest between focus segments (C18)"`

---

### Task 6: 自由时间下限和自由时间块（C19）

**Files:** Modify `src/planner/solve.py`、`tests/test_energy.py`、`tests/test_solve_core.py`

**Interfaces — Produces:**
- `solve.FREE_TITLE = "自由时间：刷视频、看动漫都行"`、`solve.FREE_MIN_GAP = 30`
- `solve.free_blocks(inp: PlanInput, blocks: list[Block]) -> list[Block]`：在 `[wake + getup_min, sleep]` 里，把相邻两块之间 ≥ 30 分钟的空档（含头尾）变成 `Block(f"free-{i}", FREE_TITLE, a, z, "life")`；下一块是 `bus-back` 的空档不算。
- `_solve(..., relax: bool = False)`：`relax=True` 时不加放松间隔和自由时间两类约束（只给 `_diagnose` 用）。

- [ ] **Step 1: 写失败的测试**

```python
def test_free_blocks_from_gaps(home_day):
    B = lambda i, a, z, kind="class": Block(i, i, to_min(a), to_min(z), kind)
    got = free_blocks(home_day, [B("c", "08:00", "10:00"), B("bus-back", "10:40", "11:00", "life"),
                                 B("x", "13:00", "14:00", "must"), B("y", "14:20", "15:00", "must")])
    assert [(to_hhmm(b.start), to_hhmm(b.end)) for b in got] == [("06:15", "08:00"), ("11:00", "13:00"), ("15:00", "22:00")]
    assert all(b.kind == "life" and b.title == FREE_TITLE for b in got)

def test_free_time_floor(home_day):
    free = [b for b in solve_day(home_day).blocks if b.id.startswith("free-")]
    assert all(b.end - b.start >= 30 for b in free) and sum(b.end - b.start for b in free) >= 120

def test_no_room_for_free_time_says_so():            # Review Focus 5
    inp = load_input(EXAMPLE); inp.energy.min_free_min = 900
    with pytest.raises(PlanInfeasible, match="自由时间"):
        solve_day(inp)
```

必须跟着改的旧测试：`test_commute_has_transition_buffer` 的 `others` 里排除 `b.id.startswith("free-")`（自由时间块可以贴着通勤，它本来就是空档）。

- [ ] **Step 2:** `uv run pytest tests/test_energy.py -q` → FAIL。
- [ ] **Step 3: 实现。**
  - 模型里预留空档（保证下限；它们不进输出）：

```python
K = -(-inp.energy.min_free_min // FREE_MIN_GAP)                 # 最多拆成几段
for k in range(K):
    p, d, s = BoolVar, IntVar(0, min_free_min), IntVar(work_lo, hi)
    m.Add(d >= FREE_MIN_GAP).OnlyEnforceIf(p); m.Add(d == 0).OnlyEnforceIf(~p)
    m.Add(s + d <= hi); 第 k 段排在第 k-1 段之后（去对称）
    free_ivs.append(m.NewOptionalIntervalVar(s, d, s + d, p, ...))
m.Add(sum(ds) >= inp.energy.min_free_min)
m.AddNoOverlap(busy + free_ivs)                                 # 取代原来的 AddNoOverlap(busy)
if c.back: m.AddNoOverlap(free_ivs + [固定区间(c.campus_end, c.back.leave_building)])   # 等车不算
```

  - `solve_day` 里求解成功后 `plan.blocks = sorted(plan.blocks + free_blocks(inp, plan.blocks), key=start)`。
  - `_diagnose` 开头加：`if _solve(inp, c, inp.habits, inp.meals, relax=True) is not None: return f"必做和三餐排得下，但留不出专注后的放松间隔和 {inp.energy.min_free_min} 分钟自由时间"`。
- [ ] **Step 4:** `uv run pytest -q` → 全绿。再看一眼耗时：`uv run pytest tests/test_solve_tasks.py::test_solve_under_10s tests/test_review_fixes.py::test_solve_is_deterministic -q --durations=5`。单次求解超过 2 秒就先查是不是没求到 OPTIMAL；确实需要才调 `SOLVE_SECONDS`，并写进提交说明（设计 §7）。
- [ ] **Step 5:** `git commit -m "feat: daily free-time floor and free-time blocks (C19)"`

---

### Task 7: `check_plan` 的五条新自检

**Files:** Modify `src/planner/check.py`、`tests/test_energy.py`、`tests/test_check.py`

`check.py` 自己从 `inp` 和 `plan.blocks` 重算，不调 `solve.py` 的 `fixed_cost`/`free_blocks`（常量 `FOCUS_KINDS`、`GYM_ID`、`ON_BUS_COST`、`POMODORO_MIN` 可以引用）。

- [ ] **Step 1: 写失败的测试**（每条都是：先求解，再把方案或输入改坏）

```python
def bad(home_day, mutate):
    plan = solve_day(home_day); mutate(plan, proj(plan)[0]); return check_plan(home_day, plan)

def test_check_energy(home_day):
    plan = solve_day(home_day); home_day.energy.base_min = 100      # 上限变成 80，可选部分超了
    assert any("精力" in p for p in check_plan(home_day, plan))

def test_check_free_time(home_day):
    plan = solve_day(home_day); home_day.energy.min_free_min = 2000
    assert any("自由时间" in p for p in check_plan(home_day, plan))

def test_check_block_not_pomodoro(home_day):
    assert any("番茄" in p for p in bad(home_day, lambda plan, b: setattr(b, "end", b.end - 10)))

def test_check_block_crosses_period(home_day):
    def m(plan, b): b.start, b.end = to_min("11:30"), to_min("12:30")
    assert any("跨时段" in p for p in bad(home_day, m))

def test_check_rest(home_day):
    def m(plan, b):
        k = by_id(plan, "calligraphy"); b.start, b.end = k.end + 10, k.end + 10 + (b.end - b.start)
    assert any("放松" in p for p in bad(home_day, m))

def test_check_passes_new_days(home_day, light_day):
    for inp in (home_day, light_day):
        assert check_plan(inp, solve_day(inp)) == []
```

- [ ] **Step 2:** `uv run pytest tests/test_energy.py -q` → 前五个 FAIL。
- [ ] **Step 3: 实现**（每条一句中文问题描述，含上面的关键词）：
  1. **精力**：固定消耗（按 Task 3 的规则，车上英语 = 和 `bus-out` 重叠的 `can_be_on_bus` 习惯）、可选消耗（proj 时长 + flex）、上限（方案里有 `gym` 块就加成）。可选 > `max(0, 上限 − 固定)` 就报。
  2. **放松**：专注块 = proj、must（车上英语除外）、`FOCUS_KINDS` 的固定事件。按开始时间相邻的两块间隔 < `rest_after_focus_min` 就报；两块都是固定事件、或都在 `habit_block` 里且首尾相接的不报。
  3. **自由时间**：`free-` 开头的块每个 ≥ 30，总和 ≥ `min_free_min`（它们没和别的块重叠由已有的重叠检查保证）。
  4. **番茄**：proj 块的时长不是 30 的倍数，或超过 `30 × len(pomodoro_decay)`。
  5. **跨时段**：proj 块跨过任何一个 `energy.periods` 的分界。
- [ ] **Step 4:** `uv run pytest -q` → 全绿（`test_check_passes_solver_output` 仍通过）。
- [ ] **Step 5:** `git commit -m "feat: self-checks for energy, rest, free time and pomodoro blocks"`

---

### Task 8: 输出、约束清单、收尾

**Files:** Modify `src/planner/output.py`、`tests/test_check.py`、`docs/constraints.md`、`README*.md`（只在提到 `daily_cap`/`heavy_min_block` 的地方）

- [ ] **Step 1: 写失败的测试**（`tests/test_check.py`）

```python
def test_to_r2_energy_fields(light_day):
    plan = solve_day(light_day); out = to_r2(plan, light_day)
    b = next(b for b in plan.blocks if b.slot == "p1")
    assert out["p1"]["h"].endswith(f"番茄 ×{b.pomodoros}（25+5）")
    assert out["p1"]["pomodoros"] == b.pomodoros and out["p1"]["progress_min"] == b.progress_min
    assert out["energy"] == {"used": round(plan.energy_used), "cap": round(plan.energy_cap)}
    assert any(r[2] and r[2].startswith("自由时间") and r[3] == "life" for r in out["rows"])
```

- [ ] **Step 2:** 运行 → FAIL。
- [ ] **Step 3: 实现** `to_r2`：`"h": f"{t.title} · 番茄 ×{b.pomodoros}（25+5）"`，槽里加 `pomodoros`、`progress_min`，顶层加 `energy`。自由时间块本来就会作为 life 行输出，不用另写。
- [ ] **Step 4:** `uv run pytest -q` → 全绿。再跑一次真实例子：`uv run python -m planner examples/2026-11-16.json -o <临时目录>/out.json`，退出码 0，人工看一眼：没有项目块、有「不排项目」的提示、看书 → 练字在到家之后、有自由时间行。
- [ ] **Step 5: 文档。** `docs/constraints.md`：C14–C19 的状态改成「已实现」。`grep -n "daily_cap\|heavy_min_block\|180/240/360" README*.md`，有就按新规则改那几行。
- [ ] **Step 6:** `git commit -m "feat: pomodoro count, progress and energy in output; mark C14–C19 done"`

---

## 完成标准

- `uv run pytest -q` 全绿；设计 §6 的每一条都能指到 `tests/test_energy.py` 里的一个测试。
- 11-16 的例子：CLI 退出码 0，自检通过，不排项目并有提示。
- `home_day`：块长全是 30/60/90，专注之间 ≥ 30 分钟，自由时间 ≥ 120 分钟，习惯三项连成一块。
- 没有推送；每个任务一个提交，改了旧测试的提交在说明里写了原因。
