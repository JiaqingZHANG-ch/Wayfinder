from pathlib import Path

import pytest

from planner.check import check_plan
from planner.model import load_input, to_min
from planner.solve import solve_day

USERS = sorted((Path(__file__).parent.parent / "examples" / "users").glob("*.json"))


@pytest.mark.parametrize("path", USERS, ids=[p.stem for p in USERS])
def test_fake_users_get_a_clean_plan(path):
    inp = load_input(path)
    plan = solve_day(inp)
    assert check_plan(inp, plan) == []
    assert {h.id for h in inp.habits} <= {b.id for b in plan.blocks}


def test_commute_estimated_without_timetable():
    inp = load_input(next(p for p in USERS if p.stem == "学生"))
    by_id = {b.id: b for b in solve_day(inp).blocks}
    # 09:00 上课，走到教室 5 分钟，路上 25 分钟 → 08:30 出门；16:00 下课 + 10 分钟离开，路上 25 分钟
    assert (by_id["bus-out"].start, by_id["bus-out"].end) == (to_min("08:30"), to_min("08:55"))
    assert (by_id["bus-back"].start, by_id["bus-back"].end) == (to_min("16:10"), to_min("16:35"))
