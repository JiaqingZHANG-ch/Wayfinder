"""挑去学校和回家的班次；没给班次表就按单程路上时间估。"""
from __future__ import annotations

from dataclasses import dataclass

from .errors import PlanInfeasible
from .model import BusToCampus, BusToHome, PlanInput, to_hhmm


@dataclass
class Commute:
    out: BusToCampus | None
    back: BusToHome | None
    campus_start: int | None
    campus_end: int | None


def pick_commute(inp: PlanInput) -> Commute:
    campus = [e for e in inp.fixed if e.where == "campus"]
    if not campus:
        return Commute(None, None, None, None)
    start = min(e.start for e in campus)
    end = max(e.end for e in campus)
    r = inp.rules

    if not inp.bus_to_campus and not inp.bus_to_home:  # 没有班次表：按路上时间估
        arrive, leave = start - r.arrive_before_min, end + r.leave_after_class_min
        return Commute(BusToCampus(arrive - r.campus_travel_min, arrive),
                       BusToHome(leave, leave + r.campus_travel_min), start, end)

    outs = [b for b in inp.bus_to_campus if b.arrive_campus <= start - r.arrive_before_min]
    if not outs:
        raise PlanInfeasible(f"没有可坐的去学校班次：{to_hhmm(start)} 的课前赶不到")
    backs = [b for b in inp.bus_to_home if b.leave_building >= end + r.leave_after_class_min]
    if not backs:
        raise PlanInfeasible(f"没有可坐的回家班次：{to_hhmm(end)} 下课后没有车")

    return Commute(
        out=max(outs, key=lambda b: b.arrive_campus),
        back=min(backs, key=lambda b: b.leave_building),
        campus_start=start,
        campus_end=end,
    )
