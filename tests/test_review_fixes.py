"""整体审查找到的问题：每条先复现，再修。"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from planner.check import check_plan
from planner.errors import InputError, PlanInfeasible
from planner.model import load_input, to_min
from planner.solve import Block, solve_day

ROOT = Path(__file__).parent.parent
EXAMPLE = ROOT / "examples" / "2026-11-16.json"


def variant(tmp_path, change):
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    change(raw)
    p = tmp_path / "in.json"
    p.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    return p


def habit(raw, hid):
    return next(h for h in raw["habits"] if h["id"] == hid)


def test_other_event_gets_travel(tmp_path):  # C1
    def change(raw):
        raw["fixed"] = [{"id": "doctor", "title": "看医生", "start": "10:00", "end": "11:00", "where": "other", "kind": "meeting"}]
    inp = load_input(variant(tmp_path, change))
    plan = solve_day(inp)
    for b in plan.blocks:
        if b.kind != "life" and b.id != "doctor":
            assert b.end <= to_min("09:30") or b.start >= to_min("11:30"), b
    assert any("看医生" in w for w in plan.warnings)


def test_home_habit_not_on_campus(tmp_path):  # I1：练字只能在家，窗口却全在人在学校的时段
    def change(raw):
        habit(raw, "calligraphy").update(window=["13:00", "15:30"], where="home")
    with pytest.raises(PlanInfeasible, match="练字"):
        solve_day(load_input(variant(tmp_path, change)))


def test_enum_typo_rejected(tmp_path):  # I2
    def change(raw):
        raw["fixed"][0]["where"] = "Campus"
    with pytest.raises(InputError):
        load_input(variant(tmp_path, change))


def test_check_exempts_bus_habit_by_flag(tmp_path):  # I3
    def change(raw):
        habit(raw, "english")["id"] = "eng"
    inp = load_input(variant(tmp_path, change))
    assert check_plan(inp, solve_day(inp)) == []


def test_fixed_overlap_message_names_events(tmp_path):  # I4
    def change(raw):
        raw["fixed"].append({"id": "call-prof", "title": "线上会议", "start": "18:00", "end": "18:30", "where": "home", "kind": "meeting"})
    with pytest.raises(PlanInfeasible, match="线上会议"):
        solve_day(load_input(variant(tmp_path, change)))


def test_no_work_at_wake_minute(tmp_path):  # I5
    def change(raw):
        for e in raw["fixed"]:
            e["where"] = "home"  # 网课在家上：项目会尽量往早排（审查时复现出 06:00 开工）
    plan = solve_day(load_input(variant(tmp_path, change)))
    assert all(b.start >= to_min("06:15") for b in plan.blocks if b.kind != "life")


def test_check_flags_home_task_while_away():  # I6
    inp = load_input(EXAMPLE)
    plan = solve_day(inp)
    plan.blocks.append(Block("egg-edits-9", "EGG 按 Rudy 的意见改展示", to_min("13:00"), to_min("14:00"), "proj", task_id="egg-edits"))
    assert any("不在家" in p for p in check_plan(inp, plan))


def test_solve_is_deterministic():  # I7
    runs = {tuple((b.id, b.start, b.end) for b in solve_day(load_input(EXAMPLE)).blocks) for _ in range(8)}
    assert len(runs) == 1


def test_first_block_of_task_comes_first(tmp_path):  # I7
    def change(raw):
        raw["fixed"] = []
        raw["tasks"] = [t for t in raw["tasks"] if t["id"] == "gnn"]
    plan = solve_day(load_input(variant(tmp_path, change)))
    gnn = sorted((b for b in plan.blocks if b.task_id == "gnn"), key=lambda b: b.start)
    assert [b.id for b in gnn] == [f"gnn-{i}" for i in range(len(gnn))]


def test_cli_bad_input_is_readable(tmp_path):  # I8
    def change(raw):
        raw["fixed"][0]["start"] = "8h00"
    p = variant(tmp_path, change)
    r = subprocess.run([sys.executable, "-m", "planner", str(p), "-o", str(tmp_path / "o.json")],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 3
    assert "输入有误" in r.stderr and "Traceback" not in r.stderr
