from datetime import date
from pathlib import Path

from planner.model import load_input, to_hhmm, to_min

EXAMPLE = Path(__file__).parent.parent / "examples" / "2026-11-16.json"


def test_to_min_roundtrip():
    assert to_min("17:51") == 1071
    assert to_hhmm(1071) == "17:51"


def test_load_example():
    inp = load_input(EXAMPLE)
    assert inp.day == date(2026, 11, 16)
    exams = [e for e in inp.fixed if e.kind == "exam"]
    assert [(e.start, e.end) for e in exams] == [(to_min("10:15"), to_min("12:15"))]
    leaves = {b.leave_building for b in inp.bus_to_home}
    assert {1055, 1071} <= leaves
    assert inp.rules.leave_after_class_min == 20
