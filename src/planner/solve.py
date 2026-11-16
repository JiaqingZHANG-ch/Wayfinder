"""用 CP-SAT 排一天：固定事件、通勤、三餐、必做四样必须排上。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from ortools.sat.python import cp_model

from .commute import Commute, pick_commute
from .errors import PlanInfeasible
from .model import Habit, Meal, PlanInput, to_hhmm

SOLVE_SECONDS = 10.0


@dataclass
class Block:
    id: str
    title: str
    start: int
    end: int
    kind: str  # life | must | proj | flex | class
    task_id: str | None = None
    slot: str | None = None
    why: str | None = None


@dataclass
class DayPlan:
    day: date
    blocks: list[Block]
    warnings: list[str] = field(default_factory=list)


@dataclass
class _Movable:
    block: Block  # start/end 在求解后填
    start: cp_model.IntVar
    minutes: int


def _commute_blocks(c: Commute) -> list[Block]:
    out = []
    if c.out:
        out.append(Block("bus-out", f"去学校：{to_hhmm(c.out.leave_home)} 出门坐 6B，{to_hhmm(c.out.arrive_campus)} 到 Campus 2",
                         c.out.leave_home, c.out.arrive_campus, "life"))
    if c.back:
        out.append(Block("bus-back", f"回家：{to_hhmm(c.back.leave_building)} 出发坐 6A，{to_hhmm(c.back.arrive_home)} 到家",
                         c.back.leave_building, c.back.arrive_home, "life"))
    return out


def _english_on_bus(inp: PlanInput, c: Commute, habits: list[Habit]) -> Habit | None:
    """英语能在通勤上听：出门到进教室整段 ≥ 习惯时长，且在习惯窗口内。"""
    if not c.out:
        return None
    for h in habits:
        start = c.out.leave_home
        if h.can_be_on_bus and c.campus_start - start >= h.minutes and h.window_start <= start and start + h.minutes <= h.window_end:
            return h
    return None


def _solve(inp: PlanInput, c: Commute, habits: list[Habit], meals: list[Meal]) -> DayPlan | None:
    m = cp_model.CpModel()
    pad = inp.rules.min_gap_min
    lo, hi = inp.wake, inp.sleep
    fixed = [Block(e.id, e.title, e.start, e.end, "class") for e in inp.fixed]
    commute = _commute_blocks(c)
    busy = [m.NewFixedSizeIntervalVar(b.start, b.end - b.start, b.id) for b in fixed]

    on_bus = _english_on_bus(inp, c, habits)
    for b in commute:
        end = b.end
        if on_bus and b.id == "bus-out":
            end = max(b.end, b.start + on_bus.minutes)  # 英语和通勤、课前等待合成一段
        busy.append(m.NewFixedSizeIntervalVar(b.start, end - b.start, b.id))
    extra = []
    if on_bus:
        extra.append(Block(on_bus.id, on_bus.title, c.out.leave_home, c.out.leave_home + on_bus.minutes, "must"))

    movables: list[_Movable] = []

    def add(block: Block, minutes: int, ws: int, we: int, padded: bool) -> bool:
        a, z = max(lo, ws), min(hi, we) - minutes
        if a > z:
            return False
        s = m.NewIntVar(a, z, block.id)
        p = pad if padded else 0
        busy.append(m.NewIntervalVar(s - p, minutes + 2 * p, s + minutes + p, block.id + "-iv"))
        movables.append(_Movable(block, s, minutes))
        return True

    for meal in meals:
        if not add(Block(meal.id, meal.title, 0, 0, "life"), meal.minutes, meal.window_start, meal.window_end, False):
            return None
    for h in habits:
        if h is on_bus:
            continue
        if not add(Block(h.id, h.title, 0, 0, "must"), h.minutes, h.window_start, h.window_end, True):
            return None

    m.AddNoOverlap(busy)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_SECONDS
    if solver.Solve(m) not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    blocks = fixed + commute + extra
    for mv in movables:
        s = solver.Value(mv.start)
        mv.block.start, mv.block.end = s, s + mv.minutes
        blocks.append(mv.block)
    return DayPlan(inp.day, sorted(blocks, key=lambda b: b.start))


def _diagnose(inp: PlanInput, c: Commute) -> str:
    alone_fail = [h.title for h in inp.habits if _solve(inp, c, [h], []) is None]
    if alone_fail:
        return "必做事项排不下：" + "、".join(alone_fail)
    if _solve(inp, c, [], inp.meals) is None:
        return "三餐排不下：固定事件把吃饭的时间占满了"
    return "必做事项和三餐加在一起排不下：" + "、".join(h.title for h in inp.habits)


def solve_day(inp: PlanInput) -> DayPlan:
    c = pick_commute(inp)
    plan = _solve(inp, c, inp.habits, inp.meals)
    if plan is None:
        raise PlanInfeasible(_diagnose(inp, c))
    return plan
