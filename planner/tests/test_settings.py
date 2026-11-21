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


@pytest.mark.parametrize("path", USERS, ids=[p.stem for p in USERS])
@pytest.mark.parametrize("now", ["10:00", "13:00", "17:00", "19:00"])
def test_replan_with_nothing_changed_keeps_the_rest_of_the_day(path, now):
    """设置没变就重排：之后要做的事一样不少（曾经 17:00 重排丢了健身和晚上的项目）。"""
    from planner.solve import replan_from
    inp = load_input(path)
    t = to_min(now)

    def rest(plan):
        return sorted(b.task_id or b.id for b in plan.blocks if b.start >= t and not b.id.startswith("free-"))

    assert rest(replan_from(inp, now)) == rest(solve_day(inp))


def test_replan_still_rests_after_the_focus_block_in_progress():
    """17:00 正在复习（到 17:40）：健身可以紧接着，新的专注要等放松完（17:40 + 30）。"""
    from planner.solve import _block_cost, replan_from
    inp = load_input(Path(__file__).parent.parent / "examples" / "users" / "学生.json")
    plan = replan_from(inp, "17:00")
    doing = next(b for b in plan.blocks if b.kind == "proj" and b.start < to_min("17:00") < b.end)
    later = [b for b in plan.blocks if b.start >= doing.end and _block_cost(inp, b) > 0]
    assert later and min(b.start for b in later) >= doing.end + inp.energy.rest_after_focus_min
    assert check_plan(inp, plan) == []
