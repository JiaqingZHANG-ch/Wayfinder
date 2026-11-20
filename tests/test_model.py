import json
from datetime import date
from pathlib import Path

import pytest

from planner.errors import InputError
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


def test_energy_defaults_when_absent(tmp_path):
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    raw.pop("energy", None); raw.pop("habit_block")
    p = tmp_path / "in.json"; p.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    inp = load_input(p)
    assert inp.energy.base_min == 480 and inp.energy.load == 0.8
    assert inp.energy.periods == [(720, 2.0), (1080, 1.5), (1440, 1.0)]
    assert inp.habit_block == []
    assert load_input(EXAMPLE).habit_block == ["english", "reading", "calligraphy"]


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
    {"min_free_min": 90.0}, {"min_free_min": 20}, {"rest_after_focus_min": -5},
])
def test_bad_energy_rejected(tmp_path, energy):
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    raw["energy"] = energy
    p = tmp_path / "in.json"; p.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(InputError):
        load_input(p)


def test_floor_and_energy_level_loaded(tmp_path):
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    raw["habits"][0]["floor_min"] = 10
    raw["energy_level"] = 2
    p = tmp_path / "in.json"; p.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    inp = load_input(p)
    assert inp.habits[0].floor_min == 10 and inp.energy_level == 2
    assert all(h.floor_min == h.minutes for h in inp.habits[1:])  # 不填 = 标准分钟数
    assert load_input(EXAMPLE).energy_level is None


@pytest.mark.parametrize("patch", [
    {"floor_min": 0}, {"floor_min": 999}, {"floor_min": 5.5}, {"energy_level": 0}, {"energy_level": 6},
])
def test_bad_floor_or_energy_level_rejected(tmp_path, patch):
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    if "floor_min" in patch:
        raw["habits"][0]["floor_min"] = patch["floor_min"]
    else:
        raw["energy_level"] = patch["energy_level"]
    p = tmp_path / "in.json"; p.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(InputError):
        load_input(p)


def test_duplicate_habit_block_rejected(tmp_path):
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    raw["habit_block"] = ["reading", "reading"]
    p = tmp_path / "in.json"; p.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(InputError):
        load_input(p)
