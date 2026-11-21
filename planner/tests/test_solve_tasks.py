import time
from datetime import date
from pathlib import Path

from planner.model import load_input, to_min
from planner.commute import pick_commute
from planner.solve import day_capacity, solve_day
from planner.urgency import weight

EXAMPLE = Path(__file__).parent.parent / "examples" / "2026-11-16.json"


def example():
    return load_input(EXAMPLE)


def task(inp, tid):
    return next(t for t in inp.tasks if t.id == tid)


def proj_blocks(plan, tid=None):
    return [b for b in plan.blocks if b.kind == "proj" and (tid is None or b.task_id == tid)]


def minutes(blocks):
    return sum(b.end - b.start for b in blocks)


def test_egg_in_campus_gap(light_day):
    inp = light_day
    plan = solve_day(inp)
    gap = [b for b in proj_blocks(plan) if b.start >= to_min("10:00") and b.end <= to_min("12:51")]
    assert any(b.task_id in ("egg-flow", "cv") for b in gap)
    home_ids = {t.id for t in inp.tasks if t.where == "home"}
    for b in proj_blocks(plan):
        if b.task_id in home_ids:
            assert b.end <= to_min("07:11") or b.start >= to_min("13:14"), b


def test_cv_before_gnn(light_day):
    inp = light_day
    cap = day_capacity(inp, pick_commute(inp))
    assert weight(task(inp, "cv"), inp.day, cap) > weight(task(inp, "gnn"), inp.day, cap)
    plan = solve_day(inp)
    cv, gnn = proj_blocks(plan, "cv"), proj_blocks(plan, "gnn")
    assert minutes(cv) >= minutes(gnn)
    if cv and gnn:
        assert min(b.start for b in cv) < min(b.start for b in gnn)


def test_overload_warns():
    inp = example()
    task(inp, "cv").remaining_min = 3000
    plan = solve_day(inp)
    assert any("CV" in w and "还差" in w for w in plan.warnings)


def test_deadline_passed_warns():
    inp = example()
    task(inp, "cv").deadline = date(2026, 11, 15)
    plan = solve_day(inp)
    assert any("CV" in w for w in plan.warnings)


def test_heavy_task_remainder_block():
    inp = example()
    inp.fixed = []
    inp.tasks = [task(inp, "gnn")]
    inp.tasks[0].remaining_min = 40
    plan = solve_day(inp)
    gnn = proj_blocks(plan, "gnn")
    assert len(gnn) == 1 and minutes(gnn) == 30 and gnn[0].progress_min == 50  # 不到 60 分钟的 heavy 任务只排 1 个番茄


def test_solve_under_10s():
    t0 = time.perf_counter()
    solve_day(example())
    assert time.perf_counter() - t0 < 10
