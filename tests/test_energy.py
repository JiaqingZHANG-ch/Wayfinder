from pathlib import Path

import pytest

from planner.errors import PlanInfeasible
from planner.model import Flex, FixedEvent, load_input, to_hhmm, to_min
from planner.solve import FREE_TITLE, Block, block_progress, free_blocks, solve_day

EXAMPLE = Path(__file__).parent.parent / "examples" / "2026-11-16.json"


def proj(plan):
    return [b for b in plan.blocks if b.kind == "proj"]


def minutes(blocks):
    return sum(b.end - b.start for b in blocks)


def task(inp, tid):
    return next(t for t in inp.tasks if t.id == tid)


def test_block_progress_decay():
    d = [1.0, 0.85, 0.7]
    assert [block_progress(1.0, n, d) for n in (1, 2, 3)] == [25, 46, 64]  # 第 3 个番茄只加 0.7×25
    assert block_progress(2.0, 1, d) == 50 and block_progress(1.5, 3, d) == 96


def test_blocks_are_pomodoros(home_day):
    heavy = {t.id for t in home_day.tasks if t.heavy}
    blocks = proj(solve_day(home_day))
    assert blocks
    for b in blocks:
        assert b.end - b.start in (30, 60, 90) and b.pomodoros == (b.end - b.start) // 30
        assert b.task_id not in heavy or b.pomodoros >= 2
        assert not any(b.start < edge < b.end for edge in (720, 1080))  # 不跨时段
        eff = 2.0 if b.end <= 720 else 1.5 if b.end <= 1080 else 1.0
        assert b.progress_min == block_progress(eff, b.pomodoros, home_day.energy.pomodoro_decay)


def test_hard_task_lands_in_morning(home_day):
    home_day.tasks = [task(home_day, "gnn")]
    assert min(b.start for b in proj(solve_day(home_day))) < to_min("12:00")


def test_no_extra_pomodoro(home_day):  # 剩 60：早上 2 个番茄（92）够了，第 3 个不许排
    home_day.tasks = [task(home_day, "egg-flow")]
    home_day.tasks[0].remaining_min = 60
    assert sum(b.pomodoros for b in proj(solve_day(home_day))) == 2


def test_tiny_remainder(home_day):  # Review Focus 3
    home_day.tasks = [task(home_day, "egg-flow")]
    home_day.tasks[0].remaining_min = 10
    assert sum(b.pomodoros for b in proj(solve_day(home_day))) <= 1


def home_class(inp, start, end):   # 在家上的网课
    inp.fixed = [FixedEvent("net", "网课", to_min(start), to_min(end), "home", "class")]


def test_budget_squeezes_projects(home_day):      # 课 240 + 必做 100 = 340，上限 384 → 只剩 44
    home_class(home_day, "08:00", "12:00")
    plan = solve_day(home_day)
    assert plan.energy_cap == pytest.approx(384) and minutes(proj(plan)) == 30
    assert plan.energy_used == pytest.approx(340 + 30)


def test_gym_adds_budget(home_day):               # 健身 → 上限 480 → 剩 140
    home_class(home_day, "08:00", "12:00")
    home_day.flex = [Flex("gym", "健身", 120, to_min("14:00"), to_min("16:00"))]
    plan = solve_day(home_day)
    assert any(b.id == "gym" for b in plan.blocks) and plan.energy_cap == pytest.approx(480)
    assert 30 < minutes(proj(plan)) <= 140


def test_over_budget_day_keeps_musts():           # 11-16：课和考试 360 + 必做 85 > 384（§4.7 第 1 条）
    inp = load_input(EXAMPLE)
    plan = solve_day(inp)
    assert proj(plan) == [] and any("不排项目" in w for w in plan.warnings)
    assert {h.id for h in inp.habits} <= {b.id for b in plan.blocks}


def test_full_day_no_heavy_evening(home_day):
    home_day.fixed = [FixedEvent("c1", "课1", to_min("08:00"), to_min("12:00"), "home", "class"),
                      FixedEvent("c2", "课2", to_min("13:00"), to_min("15:00"), "home", "class")]
    home_day.energy.base_min = 720
    plan = solve_day(home_day)
    heavy = {t.id for t in home_day.tasks if t.heavy}
    assert proj(plan) and all(b.end <= to_min("18:00") for b in proj(plan) if b.task_id in heavy)


def by_id(plan, i):
    return next(b for b in plan.blocks if b.id == i)


def test_habit_block_contiguous_at_home(home_day):
    home_day.tasks = []                                  # 没有项目时，块往早排
    plan = solve_day(home_day)
    e, r, k = (by_id(plan, i) for i in ("english", "reading", "calligraphy"))
    assert e.end == r.start and r.end == k.start and (e.end - e.start, r.end - r.start, k.end - k.start) == (30, 30, 20)
    assert k.end <= to_min("12:00")                      # 越早越好，窗口不再是各自的


def test_habit_block_shrinks_when_english_on_bus():      # 11-16：英语在车上，块只剩看书 → 练字，落在到家之后
    plan = solve_day(load_input(EXAMPLE))
    r, k = by_id(plan, "reading"), by_id(plan, "calligraphy")
    assert r.end == k.start and r.start >= to_min("18:16")
    assert by_id(plan, "english").start == to_min("07:11")


def test_habit_block_before_home_projects(home_day):     # 用户 11-18：习惯先做完，再做项目（硬约束）
    plan = solve_day(home_day)                           # home_day 带项目任务
    k = by_id(plan, "calligraphy")
    assert proj(plan)
    assert all(b.start >= k.end for b in plan.blocks if b.kind == "proj")


def test_habit_block_unknown_id_ignored(home_day):       # Review Focus 4
    home_day.habit_block = ["english", "nope", "reading"]
    plan = solve_day(home_day)
    assert by_id(plan, "english").end == by_id(plan, "reading").start


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


def test_free_blocks_from_gaps(home_day):
    B = lambda i, a, z, kind="class": Block(i, i, to_min(a), to_min(z), kind)
    got = free_blocks(home_day, [B("c", "08:00", "10:00"), B("bus-back", "10:40", "11:00", "life"),
                                 B("x", "13:00", "14:00", "must"), B("y", "14:20", "15:00", "must")])
    assert [(to_hhmm(b.start), to_hhmm(b.end)) for b in got] == [("06:15", "08:00"), ("11:00", "13:00"), ("15:00", "22:00")]
    assert all(b.kind == "life" and b.title == FREE_TITLE for b in got)


def test_free_time_floor(home_day):
    free = [b for b in solve_day(home_day).blocks if b.id.startswith("free-")]
    assert all(b.end - b.start >= 30 for b in free) and sum(b.end - b.start for b in free) >= 120


def test_no_room_for_free_time_says_so():  # Review Focus 5
    inp = load_input(EXAMPLE)
    inp.energy.min_free_min = 900
    with pytest.raises(PlanInfeasible, match="自由时间"):
        solve_day(inp)
