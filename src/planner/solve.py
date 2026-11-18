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
POMODORO_MIN = 30  # 一个番茄：25 分钟专注 + 5 分钟小歇
FOCUS_MIN = 25
GYM_ID = "gym"  # 这个 id 的 flex 排上了，当天精力上限加 gym_bonus_min
ON_BUS_COST = 0.5  # 车上听的习惯只算一半精力
FOCUS_KINDS = ("class", "exam", "meeting")


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
    pomodoros: int | None = None  # 只有 proj 块有
    progress_min: int | None = None


def block_progress(eff: float, n: int, decay: list[float]) -> int:
    """一块 n 个番茄的有效进度（分钟）：时段效率 × 专注时长，后面的番茄按 decay 递减。"""
    return round(FOCUS_MIN * eff * sum(decay[:n]))


@dataclass
class DayPlan:
    day: date
    blocks: list[Block]
    warnings: list[str] = field(default_factory=list)
    energy_used: float = 0.0
    energy_cap: float = 0.0


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


def energy_cap(inp: PlanInput, gym: bool) -> float:
    e = inp.energy
    return e.load * (e.base_min + e.gym_bonus_min * gym)


def fixed_cost(inp: PlanInput, c: Commute) -> float:
    """课、考试、会议和必做习惯一定会花掉的精力（分钟）。"""
    cost = inp.energy.cost
    on_bus = _english_on_bus(inp, c, inp.habits)
    total = sum(e.end - e.start for e in inp.fixed if e.kind in FOCUS_KINDS) * cost["class"]
    for h in inp.habits:
        total += h.minutes * cost.get(h.id, cost["habit"]) * (ON_BUS_COST if h is on_bus else 1)
    return total


def day_capacity(inp: PlanInput, c: Commute) -> int:
    """给紧迫度算松弛用的每天可用分钟：没算出像样的数就退回 240。"""
    cap = int(max(0, energy_cap(inp, False) - fixed_cost(inp, c)))
    return cap if cap >= POMODORO_MIN else 240


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
    by_hid = {h.id: h for h in habits if h is not on_bus}
    members = [by_hid[i] for i in inp.habit_block if i in by_hid]
    block_start, block_min = None, sum(h.minutes for h in members)
    if len(members) >= 2:  # 习惯成块：一整段，不分开排；只剩 0–1 项就走各自的窗口
        if not add(Block("habit-block", "", 0, 0, "must"), block_min, work_lo, hi, True, any(h.where == "home" for h in members)):
            return None
        block_start = movables.pop().start
        blocked = {h.id for h in members}
    else:
        blocked = set()
    for h in habits:
        if h is on_bus or h.id in blocked:
            continue
        if not add(Block(h.id, h.title, 0, 0, "must"), h.minutes, h.window_start, h.window_end, True, h.where == "home"):
            return None

    # 人在学校的时段：到 Campus 2 到离开教学楼。
    away = away_spans[0] if c.out and c.back else None
    campus = (c.out.arrive_campus, c.back.leave_building) if c.out and c.back else None
    cap = day_capacity(inp, c)
    spent = round(100 * fixed_cost(inp, c))
    allow = [max(0, round(100 * energy_cap(inp, g)) - spent) for g in (False, True)]
    cost = inp.energy.cost
    gym_p, flex_cost = 0, []
    full_day = class_minutes(inp) >= 360
    durations, presences = [], []
    optional = []  # (block, start, dur, presence)
    fills = []  # (proj 块, [(效率, 番茄数, 选中变量)])

    for t in tasks:
        if t.where == "campus" and not campus:
            continue
        if need_min(t) <= 0:
            continue
        w = weight(t, inp.day, cap)
        a, z = (campus if t.where == "campus" else (work_lo, hi))
        if t.heavy and full_day:
            z = min(z, EVENING)
        decay = inp.energy.pomodoro_decay
        N = len(decay)  # 一块最多几个番茄
        lb_n = 2 if t.heavy and need_min(t) >= 60 else 1
        if z - a < POMODORO_MIN * lb_n:
            continue
        starts = [0] + [end for end, _ in inp.energy.periods[:-1]]
        periods = [(st, end, eff) for st, (end, eff) in zip(starts, inp.energy.periods)]
        prev, progs, lasts = None, [], []
        for k in range(BLOCKS_PER_TASK):
            p = m.NewBoolVar(f"{t.id}-{k}-on")
            d = m.NewIntVar(0, POMODORO_MIN * N, f"{t.id}-{k}-dur")
            s = m.NewIntVar(a, z - POMODORO_MIN * lb_n, f"{t.id}-{k}-start")
            e = m.NewIntVar(a, z, f"{t.id}-{k}-end")
            m.Add(e == s + d)
            # 每块恰好落在一个时段、含 n 个番茄；不跨时段
            y = {(j, n): m.NewBoolVar(f"{t.id}-{k}-y{j}-{n}") for j in range(len(periods)) for n in range(lb_n, N + 1)}
            m.Add(sum(y.values()) == p)
            m.Add(d == POMODORO_MIN * sum(n * v for (j, n), v in y.items()))
            for (j, n), v in y.items():
                m.Add(s >= periods[j][0]).OnlyEnforceIf(v)
                m.Add(e <= periods[j][1]).OnlyEnforceIf(v)
            prog = sum(block_progress(periods[j][2], n, decay) * v for (j, n), v in y.items())
            lasts.append(sum((block_progress(periods[j][2], n, decay) - block_progress(periods[j][2], n - 1, decay)) * v
                             for (j, n), v in y.items()))
            progs.append(prog)
            if prev:  # 第 k 块只在第 k-1 块存在时才用，并且排在它后面：编号和时间顺序一致
                pp, pe = prev
                m.AddImplication(p, pp)
                m.Add(s >= pe).OnlyEnforceIf(p)
            prev = (p, e)
            busy.append(m.NewOptionalIntervalVar(s, d, e, p, f"{t.id}-{k}-iv"))
            gapped.append(m.NewOptionalIntervalVar(s, d + pad, e + pad, p, f"{t.id}-{k}-g"))
            if t.where != "campus" and block_start is not None:  # 在家的项目等习惯块做完；落在学校空档里的不受限
                in_gap = m.NewBoolVar(f"{t.id}-{k}-gap")
                if campus and t.where == "any":
                    m.Add(s >= campus[0]).OnlyEnforceIf(in_gap)
                    m.Add(e <= campus[1]).OnlyEnforceIf(in_gap)
                else:
                    m.Add(in_gap == 0)
                m.Add(s >= block_start + block_min).OnlyEnforceIf([p, in_gap.Not()])
            if t.where == "home" and away_spans:
                home_ivs.append(m.NewOptionalIntervalVar(s, d, e, p, f"{t.id}-{k}-home"))
            objective += [-w * s, -NEW_BLOCK_PENALTY * 1440 * p]
            durations.append(d)
            presences.append(p)
            blk = Block(f"{t.id}-{k}", t.title, 0, 0, "proj", task_id=t.id, why=_why(t, inp, cap))
            optional.append((blk, s, d, p))
            fills.append((blk, [(periods[j][2], n, v) for (j, n), v in y.items()]))
        total = sum(progs)
        credited = m.NewIntVar(0, need_min(t), f"{t.id}-credited")  # 超出还差的进度不算分，免得为凑分多排几块
        m.Add(credited <= total)
        objective.append(w * 1440 * credited)
        for p, last in zip(presences[-BLOCKS_PER_TASK:], lasts):  # 去掉最后一个番茄就够了：不许多排
            m.Add(total - last <= need_min(t) - 1).OnlyEnforceIf(p)

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
        if f.id == GYM_ID:
            gym_p = p
        flex_cost.append(round(100 * cost.get(f.id, 0) * f.minutes) * p)
        d = m.NewConstant(f.minutes)
        optional.append((Block(f.id, f.title, 0, 0, "flex"), s, d, p))

    m.Add(round(100 * cost["project"]) * sum(durations) + sum(flex_cost)
          <= allow[0] + (allow[1] - allow[0]) * gym_p)  # 精力总账：课和必做先扣，剩下的才给项目和健身
    if durations:
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
    if block_start is not None:  # 按顺序切成各成员自己的块，首尾相接
        t0 = solver.Value(block_start)
        for h in members:
            blocks.append(Block(h.id, h.title, t0, t0 + h.minutes, "must"))
            t0 += h.minutes
    projects = []
    for b, s, d, p in optional:
        if solver.Value(p):
            b.start = solver.Value(s)
            b.end = b.start + solver.Value(d)
            blocks.append(b)
            if b.kind == "proj":
                projects.append(b)
    for b, ys in fills:
        for eff, n, v in ys:
            if solver.Value(v):
                b.pomodoros, b.progress_min = n, block_progress(eff, n, inp.energy.pomodoro_decay)
    for i, b in enumerate(sorted(projects, key=lambda b: b.start)):
        b.slot = f"p{i + 1}"
    used = spent / 100 + sum((b.end - b.start) * (cost["project"] if b.kind == "proj" else cost.get(b.id, 0))
                             for b in blocks if b.kind in ("proj", "flex"))
    gym = any(b.id == GYM_ID for b in blocks)
    return DayPlan(inp.day, sorted(blocks, key=lambda b: b.start), energy_used=used, energy_cap=energy_cap(inp, gym))


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
    plan.warnings = _warnings(inp, day_capacity(inp, c)) + [
        f"{e.title}：路上时间按单程 {inp.rules.other_travel_min} 分钟估算，以实际为准"
        for e in inp.fixed if e.where == "other"]
    if plan.energy_cap - fixed_cost(inp, c) < POMODORO_MIN:
        plan.warnings.append(f"今天课和必做已经用掉 {fixed_cost(inp, c) / 60:.1f} 小时精力，晚上不排项目")
    return plan
