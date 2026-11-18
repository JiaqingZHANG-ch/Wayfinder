"""独立复查一份方案：任何一条不过，这份方案就不该发出去。"""
from __future__ import annotations

from .model import PlanInput, to_hhmm
from .solve import FOCUS_KINDS, FREE_MIN_GAP, GYM_ID, ON_BUS_COST, POMODORO_MIN, DayPlan

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
    problems += _check_energy(inp, plan)
    return problems


def _check_energy(inp: PlanInput, plan: DayPlan) -> list[str]:
    """精力账、放松间隔、自由时间、番茄块：只看输入和方案，不调求解器的函数。"""
    e, cost, problems = inp.energy, inp.energy.cost, []
    bus = next((b for b in plan.blocks if b.id == "bus-out"), None)
    by_hid = {b.id: b for b in plan.blocks}
    on_bus = {h.id for h in inp.habits if h.can_be_on_bus and bus and h.id in by_hid
              and by_hid[h.id].start < bus.end and bus.start < by_hid[h.id].end}
    proj = [b for b in plan.blocks if b.kind == "proj"]

    fixed = sum(x.end - x.start for x in inp.fixed if x.kind in FOCUS_KINDS) * cost["class"]
    fixed += sum(h.minutes * cost.get(h.id, cost["habit"]) * (ON_BUS_COST if h.id in on_bus else 1) for h in inp.habits)
    optional = sum((b.end - b.start) * cost["project"] for b in proj)
    optional += sum((b.end - b.start) * cost.get(b.id, 0) for b in plan.blocks if b.kind == "flex")
    gym = any(b.id == GYM_ID for b in plan.blocks)
    cap = e.load * (e.base_min + e.gym_bonus_min * gym)
    if optional > max(0, cap - fixed) + 1e-6:
        problems.append(f"精力超了：项目和健身要 {optional:.0f}，上限 {cap:.0f} 减固定 {fixed:.0f} 只剩 {max(0, cap - fixed):.0f}")

    focus = [(b.start, b.end, b.id, False) for b in proj]
    focus += [(b.start, b.end, b.id, False) for b in plan.blocks if b.kind == "must" and b.id not in on_bus]
    focus += [(x.start, x.end, x.id, True) for x in inp.fixed if x.kind in FOCUS_KINDS]
    focus.sort()
    for (s1, e1, i1, f1), (s2, e2, i2, f2) in zip(focus, focus[1:]):
        if f1 and f2:
            continue  # 课表自己定的间隔不查
        if i1 in inp.habit_block and i2 in inp.habit_block and s2 == e1:
            continue  # 习惯块里首尾相接算一段
        if s2 - e1 < e.rest_after_focus_min:
            problems.append(f"没放松：{i1}（到 {to_hhmm(e1)}）和 {i2}（{to_hhmm(s2)} 起）隔不到 {e.rest_after_focus_min} 分钟")

    free = [b.end - b.start for b in plan.blocks if b.id.startswith("free-")]
    if any(d < FREE_MIN_GAP for d in free) or sum(free) < e.min_free_min:
        problems.append(f"自由时间不够：共 {sum(free)} 分钟（每段至少 {FREE_MIN_GAP}，总共至少 {e.min_free_min}）")

    edges = [end for end, _ in e.periods[:-1]]
    for b in proj:
        d = b.end - b.start
        if d % POMODORO_MIN or d > POMODORO_MIN * len(e.pomodoro_decay):
            problems.append(f"{b.title}（{to_hhmm(b.start)}）不是整数个番茄：{d} 分钟")
        if any(b.start < x < b.end for x in edges):
            problems.append(f"{b.title}（{to_hhmm(b.start)}–{to_hhmm(b.end)}）跨时段")
    return problems
