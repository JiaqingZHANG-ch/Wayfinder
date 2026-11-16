"""用 CP-SAT 排一天：固定事件、通勤、三餐、必做四样必须排上。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from ortools.sat.python import cp_model

from .commute import Commute, pick_commute
from .errors import PlanInfeasible
from .model import Flex, Habit, Meal, PlanInput, Task, to_hhmm
from .urgency import need_min, slack_days, weight

SOLVE_SECONDS = 10.0
MAX_PROJECT_BLOCKS = 3  # 网页只有 p1–p3 三个槽
BLOCKS_PER_TASK = 2
EVENING = 18 * 60
FLEX_WEIGHT = 5
NEW_BLOCK_PENALTY = 50


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


MOVE_PREFIXES = ("bus-", "to-", "from-")  # 换地方的块


def _travel_blocks(inp: PlanInput) -> list[Block]:
    """去「其他地点」的路上：没有班次表，按单程 other_travel_min 估。"""
    t = inp.rules.other_travel_min
    out = []
    for e in inp.fixed:
        if e.where == "other":
            out.append(Block(f"to-{e.id}", f"去{e.title}的路上（按 {t} 分钟估，以实际为准）", e.start - t, e.start, "life"))
            out.append(Block(f"from-{e.id}", f"从{e.title}回来的路上（按 {t} 分钟估）", e.end, e.end + t, "life"))
    return out


def _away_spans(inp: PlanInput, c: Commute) -> list[tuple[int, int]]:
    """人不在家的时段：去学校到回家，以及去其他地点的来回。"""
    spans = [(c.out.leave_home, c.back.arrive_home)] if c.out and c.back else []
    t = inp.rules.other_travel_min
    spans += [(e.start - t, e.end + t) for e in inp.fixed if e.where == "other"]
    return spans


def _fixed_conflict(inp: PlanInput, c: Commute) -> str | None:
    """固定的事（课、会、通勤、路上）彼此撞了：直接说是哪两件，不去怪习惯。"""
    spans = sorted(
        [Block(e.id, e.title, e.start, e.end, "class") for e in inp.fixed if e.kind != "tentative"]
        + _commute_blocks(c) + _travel_blocks(inp),
        key=lambda b: b.start)
    for i, x in enumerate(spans):
        for y in spans[i + 1:]:
            if y.start >= x.end:
                break
            return f"{x.title}（{to_hhmm(x.start)}–{to_hhmm(x.end)}）和 {y.title}（{to_hhmm(y.start)}–{to_hhmm(y.end)}）时间冲突"
    return None


def _english_on_bus(inp: PlanInput, c: Commute, habits: list[Habit]) -> Habit | None:
    """英语能在通勤上听：出门到进教室整段 ≥ 习惯时长，且在习惯窗口内。"""
    if not c.out:
        return None
    for h in habits:
        start = c.out.leave_home
        if h.can_be_on_bus and c.campus_start - start >= h.minutes and h.window_start <= start and start + h.minutes <= h.window_end:
            return h
    return None


def class_minutes(inp: PlanInput) -> int:
    return sum(e.end - e.start for e in inp.fixed if e.kind in ("class", "exam"))


def daily_cap(inp: PlanInput) -> int:
    h = class_minutes(inp)
    return 180 if h >= 360 else 240 if h > 0 else 360


def _why(t: Task, inp: PlanInput, cap: int) -> str:
    if t.deadline is None:
        return f"没有截止日，还差 {need_min(t) / 60:.1f} 小时"
    return f"截止 {t.deadline:%m-%d}，还差 {need_min(t) / 60:.1f} 小时，松弛 {slack_days(t, inp.day, cap):.1f} 天"


def _warnings(inp: PlanInput, cap: int) -> list[str]:
    out = []
    for t in inp.tasks:
        if t.deadline is None:
            continue
        days = (t.deadline - inp.day).days
        if days <= 0:
            out.append(f"{t.title}：截止日 {t.deadline:%m-%d} 已到或已过，还差 {need_min(t) / 60:.1f} 小时")
        elif need_min(t) > days * cap:
            out.append(f"{t.title}：到 {t.deadline:%m-%d} 还差 {(need_min(t) - days * cap) / 60:.1f} 小时排不进去，要挤出额外时间")
    return out


def _solve(inp: PlanInput, c: Commute, habits: list[Habit], meals: list[Meal],
           tasks: list[Task] = (), flex: list[Flex] = ()) -> DayPlan | None:
    m = cp_model.CpModel()
    pad = inp.rules.min_gap_min
    lo, hi = inp.wake, inp.sleep
    work_lo = lo + inp.rules.getup_min
    fixed = [Block(e.id, e.title, e.start, e.end, "class") for e in inp.fixed]
    commute = _commute_blocks(c) + _travel_blocks(inp)
    on_bus = _english_on_bus(inp, c, habits)
    away_spans = _away_spans(inp, c)
    home_ivs = [m.NewFixedSizeIntervalVar(a, z - a, f"away-{i}") for i, (a, z) in enumerate(away_spans)]
    # 两组不重叠：busy 管所有事；gapped 只管非生活类的事，每件结束后留 pad 分钟。
    # 通勤（换地方）在两组里前后都留 pad：吃完饭到出门、到家到下一件事都要缓一下。
    # 固定的事之间本来挨得更近，就按实际间隔留，不让真实课表变成「排不下」。
    spans = []
    for b in fixed + commute:
        end = b.end
        if on_bus and b.id == "bus-out":
            end = max(b.end, b.start + on_bus.minutes)  # 英语和通勤、课前等待合成一段
        spans.append((b.start, end, b.id))
    starts = sorted(s for s, _, _ in spans)
    ends = sorted(e for _, e, _ in spans)
    busy, gapped = [], []
    for s, e, name in spans:
        nxt = min((x for x in starts if x >= e), default=e + pad)
        e2 = e + min(pad, nxt - e)
        if name.startswith(MOVE_PREFIXES):
            prv = max((x for x in ends if x <= s), default=s - pad)
            s2 = s - min(pad, s - prv)
            busy.append(m.NewFixedSizeIntervalVar(s2, e2 - s2, name))
            gapped.append(m.NewFixedSizeIntervalVar(s2, e2 - s2, name + "-g"))
        else:
            busy.append(m.NewFixedSizeIntervalVar(s, e - s, name))
            gapped.append(m.NewFixedSizeIntervalVar(s, e2 - s, name + "-g"))
    extra = []
    if on_bus:
        extra.append(Block(on_bus.id, on_bus.title, c.out.leave_home, c.out.leave_home + on_bus.minutes, "must"))

    movables: list[_Movable] = []

    objective = []

    def add(block: Block, minutes: int, ws: int, we: int, padded: bool, at_home: bool = False) -> bool:
        a, z = max(lo if block.kind == "life" else work_lo, ws), min(hi, we) - minutes
        if a > z:
            return False
        s = m.NewIntVar(a, z, block.id)
        busy.append(m.NewIntervalVar(s, minutes, s + minutes, block.id + "-iv"))
        if padded:
            gapped.append(m.NewIntervalVar(s, minutes + pad, s + minutes + pad, block.id + "-g"))
        if at_home:
            home_ivs.append(m.NewIntervalVar(s, minutes, s + minutes, block.id + "-home"))
        objective.append(-s)  # 同样可行时往早放，结果稳定可复现
        movables.append(_Movable(block, s, minutes))
        return True

    for meal in meals:
        if not add(Block(meal.id, meal.title, 0, 0, "life"), meal.minutes, meal.window_start, meal.window_end, False):
            return None
    for h in habits:
        if h is on_bus:
            continue
        if not add(Block(h.id, h.title, 0, 0, "must"), h.minutes, h.window_start, h.window_end, True, h.where == "home"):
            return None

    # 人在学校的时段：到 Campus 2 到离开教学楼。
    away = away_spans[0] if c.out and c.back else None
    campus = (c.out.arrive_campus, c.back.leave_building) if c.out and c.back else None
    cap = daily_cap(inp)
    full_day = class_minutes(inp) >= 360
    durations, presences = [], []
    optional = []  # (block, start, dur, presence)

    for t in tasks:
        if t.where == "campus" and not campus:
            continue
        ub = min(t.max_block, need_min(t))
        lb = min(t.min_block, ub)
        if ub <= 0:
            continue
        w = weight(t, inp.day, cap)
        a, z = (campus if t.where == "campus" else (work_lo, hi))
        if t.heavy and full_day:
            z = min(z, EVENING)
        if z - a < lb:
            continue
        task_durs, prev = [], None
        for k in range(BLOCKS_PER_TASK):
            p = m.NewBoolVar(f"{t.id}-{k}-on")
            d = m.NewIntVar(0, ub, f"{t.id}-{k}-dur")
            s = m.NewIntVar(a, z - lb, f"{t.id}-{k}-start")
            e = m.NewIntVar(a, z, f"{t.id}-{k}-end")
            m.Add(e == s + d)
            m.Add(d >= lb).OnlyEnforceIf(p)
            m.Add(d == 0).OnlyEnforceIf(~p)
            if prev:  # 第 k 块只在第 k-1 块存在时才用，并且排在它后面：编号和时间顺序一致
                pp, pe = prev
                m.AddImplication(p, pp)
                m.Add(s >= pe).OnlyEnforceIf(p)
            prev = (p, e)
            busy.append(m.NewOptionalIntervalVar(s, d, e, p, f"{t.id}-{k}-iv"))
            gapped.append(m.NewOptionalIntervalVar(s, d + pad, e + pad, p, f"{t.id}-{k}-g"))
            if t.where == "home" and away_spans:
                home_ivs.append(m.NewOptionalIntervalVar(s, d, e, p, f"{t.id}-{k}-home"))
            objective += [w * 1440 * d, -w * s, -NEW_BLOCK_PENALTY * 1440 * p]
            task_durs.append(d)
            presences.append(p)
            optional.append((Block(f"{t.id}-{k}", t.title, 0, 0, "proj", task_id=t.id, why=_why(t, inp, cap)), s, d, p))
        m.Add(sum(task_durs) <= need_min(t))
        durations += task_durs

    for f in flex:
        clash = any(e.start < f.window_end and f.window_start < e.end for e in inp.fixed)
        if clash or any(a < f.window_end and f.window_start < z for a, z in away_spans):
            continue  # 窗口里有课或人不在家就不排，不另约
        if f.window_end - f.window_start < f.minutes:
            continue
        p = m.NewBoolVar(f"{f.id}-on")
        s = m.NewIntVar(f.window_start, f.window_end - f.minutes, f"{f.id}-start")
        busy.append(m.NewOptionalIntervalVar(s, f.minutes, s + f.minutes, p, f"{f.id}-iv"))
        gapped.append(m.NewOptionalIntervalVar(s, f.minutes + pad, s + f.minutes + pad, p, f"{f.id}-g"))
        objective.append(FLEX_WEIGHT * 1440 * f.minutes * p)
        d = m.NewConstant(f.minutes)
        optional.append((Block(f.id, f.title, 0, 0, "flex"), s, d, p))

    if durations:
        m.Add(sum(durations) <= cap)
        m.Add(sum(presences) <= MAX_PROJECT_BLOCKS)
    if len(home_ivs) > 1:
        m.AddNoOverlap(home_ivs)
    m.AddNoOverlap(busy)
    m.AddNoOverlap(gapped)
    if objective:
        m.Maximize(sum(objective))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_SECONDS
    solver.parameters.random_seed = 0
    solver.parameters.num_workers = 1  # 单线程才可复现；一天的模型很小，0.1 秒内解完
    if solver.Solve(m) not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    blocks = fixed + commute + extra
    for mv in movables:
        s = solver.Value(mv.start)
        mv.block.start, mv.block.end = s, s + mv.minutes
        blocks.append(mv.block)
    projects = []
    for b, s, d, p in optional:
        if solver.Value(p):
            b.start = solver.Value(s)
            b.end = b.start + solver.Value(d)
            blocks.append(b)
            if b.kind == "proj":
                projects.append(b)
    for i, b in enumerate(sorted(projects, key=lambda b: b.start)):
        b.slot = f"p{i + 1}"
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
    conflict = _fixed_conflict(inp, c)
    if conflict:
        raise PlanInfeasible(conflict)
    plan = _solve(inp, c, inp.habits, inp.meals, inp.tasks, inp.flex)
    if plan is None:
        raise PlanInfeasible(_diagnose(inp, c))
    plan.warnings = _warnings(inp, daily_cap(inp)) + [
        f"{e.title}：路上时间按单程 {inp.rules.other_travel_min} 分钟估算，以实际为准"
        for e in inp.fixed if e.where == "other"]
    return plan
