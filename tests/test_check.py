from pathlib import Path

from planner.check import check_plan
from planner.model import load_input, to_min
from planner.output import to_r2
from planner.solve import solve_day

EXAMPLE = Path(__file__).parent.parent / "examples" / "2026-11-16.json"


def test_check_flags_1735():
    inp = load_input(EXAMPLE)
    plan = solve_day(inp)
    back = next(b for b in plan.blocks if b.id == "bus-back")
    back.start, back.end = to_min("17:35"), to_min("18:01")  # 17:30 下课只隔 5 分钟
    assert any("20" in p for p in check_plan(inp, plan))


def test_check_passes_solver_output():
    inp = load_input(EXAMPLE)
    assert check_plan(inp, solve_day(inp)) == []


def test_to_r2_shape():
    inp = load_input(EXAMPLE)
    out = to_r2(solve_day(inp), inp)
    rows = out["rows"]
    assert rows == sorted(rows, key=lambda r: r[0])
    proj = [r for r in rows if r[3] == "proj"]
    assert proj and proj[0][2] is None
    first = next(r for r in proj if r[4] == "p1")
    assert out["p1"]["task_id"] == first[5]
    assert out["p1"]["s"]  # 带上任务的步骤
