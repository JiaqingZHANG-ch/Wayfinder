"""独立复查一份方案：任何一条不过，这份方案就不该发出去。"""
from __future__ import annotations

from .model import PlanInput, to_hhmm
from .solve import DayPlan

SLEEP_MIN = 8 * 60


def _away_spans(plan: DayPlan) -> list[tuple[int, int]]:
    """从方案里的通勤和路上块算出人不在家的时段（不依赖求解器内部）。"""
    by_id = {b.id: b for b in plan.blocks}
    spans = []
    if "bus-out" in by_id and "bus-back" in by_id:
        spans.append((by_id["bus-out"].start, by_id["bus-back"].end))
    for b in plan.blocks:
        if b.id.startswith("to-") and "from-" + b.id[3:] in by_id:
            spans.append((b.start, by_id["from-" + b.id[3:]].end))
    return spans


def check_plan(inp: PlanInput, plan: DayPlan) -> list[str]:
    problems = []
    on_bus = {h.id for h in inp.habits if h.can_be_on_bus}
    blocks = sorted(plan.blocks, key=lambda b: b.start)
    for i, x in enumerate(blocks):
        for y in blocks[i + 1:]:
            if y.start >= x.end:
                break
            pair = {x.id, y.id}
            if "bus-out" in pair and pair & on_bus:
                continue  # 英语在车上听，允许重合
            problems.append(f"时间重叠：{x.title}（{to_hhmm(x.start)}–{to_hhmm(x.end)}）和 {y.title}")

    campus = [e for e in inp.fixed if e.where == "campus"]
    ids = {b.id for b in plan.blocks}
    if campus:
        if "bus-out" not in ids or "bus-back" not in ids:
            problems.append("当天要去学校，但缺去程或回程班次")
        out = next((b for b in plan.blocks if b.id == "bus-out"), None)
        back = next((b for b in plan.blocks if b.id == "bus-back"), None)
        start, end = min(e.start for e in campus), max(e.end for e in campus)
        if out and out.end > start:
            problems.append(f"去程 {to_hhmm(out.end)} 才到，赶不上 {to_hhmm(start)} 的课")
        if back and back.start - end < inp.rules.leave_after_class_min:
            problems.append(f"回家班次 {to_hhmm(back.start)} 离下课 {to_hhmm(end)} 不到 {inp.rules.leave_after_class_min} 分钟")

    home_only = {h.id for h in inp.habits if h.where == "home"}
    home_tasks = {t.id for t in inp.tasks if t.where == "home"}
    for b in plan.blocks:
        if b.id in home_only or b.task_id in home_tasks:
            for a, z in _away_spans(plan):
                if b.start < z and a < b.end:
                    problems.append(f"不在家时排了只能在家做的事：{b.title}（{to_hhmm(b.start)}）")

    for h in inp.habits:
        if h.id not in ids:
            problems.append(f"缺必做事项：{h.title}")

    for b in plan.blocks:
        if b.start < inp.wake or b.end > inp.sleep:
            problems.append(f"{b.title}（{to_hhmm(b.start)}–{to_hhmm(b.end)}）超出了起床到睡觉的时间")
    if inp.wake + 1440 - inp.sleep < SLEEP_MIN:
        problems.append(f"睡觉 {to_hhmm(inp.sleep)} 到起床 {to_hhmm(inp.wake)} 不足 8 小时")
    return problems
