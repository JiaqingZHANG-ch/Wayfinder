"""独立复查一份方案：任何一条不过，这份方案就不该发出去。"""
from __future__ import annotations

from .model import PlanInput, to_hhmm
from .solve import DayPlan

SLEEP_MIN = 8 * 60


def check_plan(inp: PlanInput, plan: DayPlan) -> list[str]:
    problems = []
    blocks = sorted(plan.blocks, key=lambda b: b.start)
    for i, x in enumerate(blocks):
        for y in blocks[i + 1:]:
            if y.start >= x.end:
                break
            if {x.id, y.id} == {"english", "bus-out"}:
                continue  # 英语在车上听，允许重合
            problems.append(f"时间重叠：{x.title}（{to_hhmm(x.start)}–{to_hhmm(x.end)}）和 {y.title}")

    campus = [e for e in inp.fixed if e.where == "campus"]
    ids = {b.id for b in plan.blocks}
    if campus:
        if "bus-out" not in ids or "bus-back" not in ids:
            problems.append("当天要去学校，但缺去程或回程班次")
        back = next((b for b in plan.blocks if b.id == "bus-back"), None)
        end = max(e.end for e in campus)
        if back and back.start - end < inp.rules.leave_after_class_min:
            problems.append(f"回家班次 {to_hhmm(back.start)} 离下课 {to_hhmm(end)} 不到 {inp.rules.leave_after_class_min} 分钟")

    for h in inp.habits:
        if h.id not in ids:
            problems.append(f"缺必做事项：{h.title}")

    last = max((b.end for b in plan.blocks), default=inp.wake)
    if inp.wake + 1440 - last < SLEEP_MIN:
        problems.append(f"睡眠不足 8 小时：最后一件事 {to_hhmm(last)} 才结束")
    return problems
