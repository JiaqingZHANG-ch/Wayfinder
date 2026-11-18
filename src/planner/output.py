"""把方案转成网页 R2[日期] 的格式。给人看的措辞（head、done、步骤怎么分）由 Claude 之后补。"""
from __future__ import annotations

from .model import PlanInput, to_hhmm
from .solve import DayPlan


def to_r2(plan: DayPlan, inp: PlanInput) -> dict:
    tasks = {t.id: t for t in inp.tasks}
    out: dict = {"day": plan.day.isoformat(), "rows": [], "why": [], "warnings": list(plan.warnings),
                 "energy": {"used": round(plan.energy_used), "cap": round(plan.energy_cap)}}
    for b in sorted(plan.blocks, key=lambda b: b.start):
        text = None if b.kind == "proj" else b.title
        out["rows"].append([to_hhmm(b.start), to_hhmm(b.end), text, b.kind, b.slot, b.task_id])
        if b.kind == "proj" and b.slot:
            t = tasks[b.task_id]
            out[b.slot] = {"h": f"{t.title} · 番茄 ×{b.pomodoros}（25+5）", "s": list(t.steps), "task_id": t.id,
                           "pomodoros": b.pomodoros, "progress_min": b.progress_min}
            out["why"].append(f"{b.slot} {t.title}：{b.why}")
    return out
