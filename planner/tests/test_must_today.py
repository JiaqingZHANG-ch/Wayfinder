"""must_today：用户说了今天要做的事，一定排进今天；精力只决定排在什么时候。"""
import re
from dataclasses import replace
from pathlib import Path

import pytest

from planner.check import check_plan
from planner.errors import PlanInfeasible
from planner.model import FixedEvent, Task, load_input, to_hhmm, to_min
from planner.solve import replan_from, solve_day

STUDENT = Path(__file__).parent.parent / "examples" / "users" / "学生.json"


def student(**task):
    inp = load_input(STUDENT)
    t = Task("say-1", "写报告", "写报告", 120, inp.day, True, 30, 180, "any", must_today=True)
    inp.tasks.append(replace(t, **task))
    return inp


def progress(plan, tid="say-1"):
    return sum(b.progress_min for b in plan.blocks if b.task_id == tid)


def test_energy_over_cap_still_scheduled():
    inp = student()
    inp.energy.base_min = 300  # 上限 240，课和必做就要 350
    plan = solve_day(inp)
    assert progress(plan) == sum(b.end - b.start for b in plan.blocks if b.task_id == "say-1") == 120  # 按钟点算，不按效率折算
    assert progress(plan, "exam-prep") == 0  # 普通项目照旧受精力上限管
    assert plan.energy_used > plan.energy_cap  # 耗能照样记账
    assert not any("写报告" in w for w in plan.warnings)  # 截止日写的是今天，也不报「截止日已到」
    assert check_plan(inp, plan) == []


def test_full_day_evening_rule_does_not_block():
    inp = student(remaining_min=60)
    # 满课日（6 小时课）：难事不排晚上，精力也被课用光了
    inp.fixed = [FixedEvent("a", "上午课", to_min("09:00"), to_min("12:00"), "campus", "class"),
                 FixedEvent("b", "下午课", to_min("14:00"), to_min("17:00"), "campus", "class")]
    off = solve_day(replace(inp, tasks=[replace(t, must_today=False) for t in inp.tasks]))
    assert progress(off) == 0 and any("晚上不排项目" in w for w in off.warnings)  # 对照：不是今天必做的就不排
    plan = solve_day(inp)
    assert progress(plan) >= 60
    assert all(b.start >= to_min("17:00") for b in plan.blocks if b.task_id == "say-1")
    assert not any("晚上不排项目" in w for w in plan.warnings)


def test_not_enough_time_names_the_task():
    with pytest.raises(PlanInfeasible, match=r"今天剩下的时间排不下：写报告（还差 \d+ 分钟）"):
        solve_day(student(remaining_min=1200))


def test_one_block_when_it_fits():
    # 说「健身一小时」：一块装得下就排成一整块，不拆两段；排不下时才退回拆开（上面满课日那条）
    inp = student(title="健身", remaining_min=60, heavy=False)
    blocks = [b for b in solve_day(inp).blocks if b.task_id == "say-1"]
    assert len(blocks) == 1 and blocks[0].end - blocks[0].start == 60


@pytest.mark.parametrize("said", [45, 5, 47])
def test_said_minutes_not_rounded_up_to_pomodoros(said):
    # 说 45 分钟就排 45 分钟：按 5 分钟取整，不凑成 30 的倍数（普通项目照旧按番茄）
    inp = student(title="健身", remaining_min=said, heavy=False)
    plan = solve_day(inp)
    blocks = [b for b in plan.blocks if b.task_id == "say-1"]
    assert len(blocks) == 1 and blocks[0].end - blocks[0].start == -(-said // 5) * 5 == progress(plan)
    assert all((b.end - b.start) % 30 == 0 for b in plan.blocks if b.kind == "proj" and b.task_id != "say-1")
    assert check_plan(inp, plan) == []


def test_soft_must_schedules_what_fits_and_warns():
    plan = solve_day(student(remaining_min=1200), soft_must=True)
    assert progress(plan) > 0
    assert any(re.fullmatch(r"今天剩下的时间排不下：写报告（还差 \d+ 分钟）", w) for w in plan.warnings)


def test_replan_deducts_clock_minutes_of_started_must_blocks():
    # 已经开始的块被手动拉短过（progress_min 还是旧的）：按钟点扣，剩下的照排
    inp = student(remaining_min=120, heavy=False)
    plan = solve_day(inp)
    b = next(x for x in plan.blocks if x.task_id == "say-1")
    b.end = b.start + 30  # 拉短成 30 分钟，progress_min 还写着原来的
    rest = replan_from(inp, to_hhmm(b.start + 10), before=plan.blocks)
    assert sum(x.end - x.start for x in rest.blocks if x.task_id == "say-1") == 120


@pytest.mark.parametrize("first,kept", [(False, 0), (True, 30)])
def test_first_task_kept_when_must_today_overflows(first, kept):
    # 昨晚定的「明天的一件事」（first）：今天必做的排不下时先保它。不标 first 时它 30 分钟、多开一块有罚分，平局总输给拉长别的事
    inp = student()
    for i, (m, heavy) in enumerate([(60, False), (120, True), (30, False), (90, False)]):
        inp.tasks.append(Task(f"say-{i + 2}", "说的事", f"事{i}", m, inp.day, heavy, 30, 180, "any", must_today=True))
    inp.tasks.append(Task("one", "昨晚定的一件事", "交作业", 30, inp.day, False, 30, 180, "any", must_today=True, first=first))
    plan = solve_day(inp, soft_must=True)
    assert progress(plan, "one") == kept
    assert any("还差" in w for w in plan.warnings)
