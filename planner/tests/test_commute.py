from pathlib import Path

import pytest

from planner.commute import pick_commute
from planner.errors import PlanInfeasible
from planner.model import FixedEvent, load_input, to_min

EXAMPLE = Path(__file__).parent.parent / "examples" / "2026-11-16.json"


def test_monday_picks_1751():
    c = pick_commute(load_input(EXAMPLE))
    assert c.back.leave_building == to_min("17:51")
    assert c.out.leave_home == to_min("07:11")


def test_home_day_no_bus():
    inp = load_input(EXAMPLE)
    inp.fixed = []
    c = pick_commute(inp)
    assert c.out is None and c.back is None


def test_no_valid_return_bus():
    inp = load_input(EXAMPLE)
    inp.fixed.append(FixedEvent("late", "晚课", to_min("18:00"), to_min("20:00"), "campus", "class"))
    with pytest.raises(PlanInfeasible, match="没有可坐的回家班次"):
        pick_commute(inp)
