from pathlib import Path

import pytest

from planner.errors import PlanInfeasible
from planner.model import BusToCampus, FixedEvent, load_input, to_min
from planner.solve import solve_day

EXAMPLE = Path(__file__).parent.parent / "examples" / "2026-11-16.json"
HABITS = {"stretch": 20, "reading": 30, "english": 30, "journal": 30}


def core_input():
    inp = load_input(EXAMPLE)
    inp.tasks, inp.flex = [], []
    return inp


def overlaps(a, b):
    return a.start < b.end and b.start < a.end


def test_monday_core_feasible():
    inp = core_input()
    plan = solve_day(inp)
    for hid, minutes in HABITS.items():
        found = [b for b in plan.blocks if b.id == hid]
        assert len(found) == 1, hid
        assert found[0].end - found[0].start == minutes
    busy = sorted((b for b in plan.blocks if b.kind != "life"), key=lambda b: b.start)
    for x, y in zip(busy, busy[1:]):
        if x.id in inp.habit_block and y.id in inp.habit_block:
            continue  # 习惯成块：块内相邻的两项首尾相接
        assert y.start - x.end >= 5, (x.id, y.id)
    assert all(to_min("06:00") <= b.start and b.end <= to_min("22:00") for b in plan.blocks)


def test_commute_has_transition_buffer():
    # 用户 11-16 指出：吃完饭到出门、到家到下一件事都要留转场
    plan = solve_day(core_input())
    bus = [b for b in plan.blocks if b.id.startswith("bus-")]
    others = [b for b in plan.blocks if not b.id.startswith("bus-") and b.id != "english" and b.kind != "class"
              and not b.id.startswith("free-")]
    for x in bus:
        for y in others:
            assert y.end <= x.start - 5 or y.start >= x.end + 5, (x.id, y.id)


def test_english_on_bus_only_if_30():
    plan = solve_day(core_input())
    eng = next(b for b in plan.blocks if b.id == "english")
    out = next(b for b in plan.blocks if b.id == "bus-out")
    assert overlaps(eng, out)

    inp = core_input()
    inp.bus_to_campus = [BusToCampus(to_min("07:35"), to_min("07:50"))]  # 出门到进教室只有 25 分钟
    plan = solve_day(inp)
    eng = next(b for b in plan.blocks if b.id == "english")
    out = next(b for b in plan.blocks if b.id == "bus-out")
    assert not overlaps(eng, out)


def test_overfull_day_reports_habit():
    inp = core_input()
    inp.fixed = [FixedEvent("all-day", "全天活动", to_min("06:00"), to_min("22:00"), "other", "meeting")]
    with pytest.raises(PlanInfeasible, match="拉伸|看书|英语|写日记"):
        solve_day(inp)
