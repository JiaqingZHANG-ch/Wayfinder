"""用 CP-SAT 排一天：固定事件、通勤、三餐、必做四样必须排上。"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import date

from ortools.sat.python import cp_model

from .commute import Commute, pick_commute
from .errors import InputError, PlanInfeasible
from .model import Flex, Habit, Meal, PlanInput, Task, to_hhmm, to_min
from .urgency import need_min, slack_days, weight

SOLVE_SECONDS = 10.0
MAX_PROJECT_BLOCKS = 3  # 网页只有 p1–p3 三个槽
BLOCKS_PER_TASK = 2
EVENING = 18 * 60
FLEX_WEIGHT = 5
NEW_BLOCK_PENALTY = 50
POMODORO_MIN = 30  # 一个番茄：25 分钟专注 + 5 分钟小歇
FOCUS_MIN = 25
ON_BUS_COST = 0.5  # 车上听的习惯只算一半精力
FOCUS_KINDS = ("class", "exam", "meeting")
FREE_TITLE = "自由时间：刷视频、看动漫都行"
FREE_MIN_GAP = 30  # 自由时间至少连续这么久才算


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
        out.append(Block("bus-out", f"去学校：{to_hhmm(c.out.leave_home)} 出门，{to_hhmm(c.out.arrive_campus)} 到学校",
                         c.out.leave_home, c.out.arrive_campus, "life"))
    if c.back:
        out.append(Block("bus-back", f"回家：{to_hhmm(c.back.leave_building)} 离开教学楼，{to_hhmm(c.back.arrive_home)} 到家",
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


def _habit_on_bus(inp: PlanInput, c: Commute, habits: list[Habit]) -> Habit | None:
    """能在通勤路上做的习惯（比如听英语）：出门到进教室整段 ≥ 习惯时长，且在习惯窗口内。"""
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


def event_cost(inp: PlanInput, e) -> float:
    """每门课、每次会可以按 id 单独定消耗系数，没定的按 class。"""
    return inp.energy.cost.get(e.id, inp.energy.cost["class"])


def task_cost(inp: PlanInput, task_id: str) -> float:
    """每个项目可以按任务 id 单独定消耗系数；0 = 热爱的事：不扣精力，做完也不用放松。"""
    return inp.energy.cost.get(task_id, inp.energy.cost["project"])


def fixed_cost(inp: PlanInput, c: Commute) -> float:
    """课、考试、会议和必做习惯一定会花掉的精力（分钟）。"""
    cost = inp.energy.cost
    on_bus = _habit_on_bus(inp, c, inp.habits)
    total = sum((e.end - e.start) * event_cost(inp, e) for e in inp.fixed if e.kind in FOCUS_KINDS)
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
        if t.deadline is None or t.must_today:  # 今天必做的已经硬排进今天，不再提醒截止日
            continue
        days = (t.deadline - inp.day).days
        if days <= 0:
            out.append(f"{t.title}：截止日 {t.deadline:%m-%d} 已到或已过，还差 {need_min(t) / 60:.1f} 小时")
        elif need_min(t) > days * cap:
            out.append(f"{t.title}：到 {t.deadline:%m-%d} 还差 {(need_min(t) - days * cap) / 60:.1f} 小时排不进去，要挤出额外时间")
    return out


def free_blocks(inp: PlanInput, blocks: list[Block]) -> list[Block]:
    """空档（≥ FREE_MIN_GAP）就是自由时间；下一块是回家的车，那段是等车，不算。"""
    out, cur = [], inp.wake + inp.rules.getup_min
    for b in sorted(blocks, key=lambda b: b.start) + [Block("end", "", inp.sleep, inp.sleep, "life")]:
        if b.start - cur >= FREE_MIN_GAP and b.id != "bus-back":
            out.append(Block(f"free-{len(out)}", FREE_TITLE, cur, b.start, "life"))
        cur = max(cur, b.end)
    return out


def _solve(inp: PlanInput, c: Commute, habits: list[Habit], meals: list[Meal],
           tasks: list[Task] = (), flex: list[Flex] = (), relax: bool = False, hard_must: bool = True) -> DayPlan | None:
    m = cp_model.CpModel()
    pad = inp.rules.min_gap_min
    lo, hi = inp.wake, inp.sleep
    work_lo = lo + inp.rules.getup_min
    fixed = [Block(e.id, e.title, e.start, e.end, "class") for e in inp.fixed]
    commute = _commute_blocks(c) + _travel_blocks(inp)
    on_bus = _habit_on_bus(inp, c, habits)
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
    busy, gapped, focus_ivs = [], [], []
    rest = inp.energy.rest_after_focus_min
    tiring = [e for e in inp.fixed if e.kind in FOCUS_KINDS and event_cost(inp, e) > 0]
    focus_starts = sorted(e.start for e in tiring)
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
    for e in tiring:  # 课表自己定的间隔照实际留，最多留 rest
        nxt = min((x for x in focus_starts if x >= e.end), default=e.end + rest)
        focus_ivs.append(m.NewFixedSizeIntervalVar(e.start, e.end + min(rest, nxt - e.end) - e.start, e.id + "-f"))
    extra = []
    if on_bus:
        extra.append(Block(on_bus.id, on_bus.title, c.out.leave_home, c.out.leave_home + on_bus.minutes, "must"))

    movables: list[_Movable] = []

    objective = []

    def add(block: Block, minutes: int, ws: int, we: int, padded: bool, at_home: bool = False, focus: bool = False) -> bool:
        a, z = max(lo if block.kind == "life" else work_lo, ws), min(hi, we) - minutes
        if focus and inp.focus_free_at:  # 刚做完的专注还没放松完：新的专注往后放（课和会照课表，不受这个限制）
            a = max(a, inp.focus_free_at)
        if a > z:
            return False
        s = m.NewIntVar(a, z, block.id)
        busy.append(m.NewIntervalVar(s, minutes, s + minutes, block.id + "-iv"))
        if padded:
            gapped.append(m.NewIntervalVar(s, minutes + pad, s + minutes + pad, block.id + "-g"))
        if focus:
            focus_ivs.append(m.NewIntervalVar(s, minutes + rest, s + minutes + rest, block.id + "-f"))
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
        if not add(Block("habit-block", "", 0, 0, "must"), block_min, work_lo, hi, True, any(h.where == "home" for h in members), True):
            return None
        block_start = movables.pop().start
        blocked = {h.id for h in members}
    else:
        blocked = set()
    for h in habits:
        if h is on_bus or h.id in blocked:
            continue
        if not add(Block(h.id, h.title, 0, 0, "must"), h.minutes, h.window_start, h.window_end, True, h.where == "home", True):
            return None

    # 人在学校的时段：到学校到离开教学楼。
    away = away_spans[0] if c.out and c.back else None
    campus = (c.out.arrive_campus, c.back.leave_building) if c.out and c.back else None
    cap = day_capacity(inp, c)
    spent = round(100 * fixed_cost(inp, c))
    allow = [max(0, round(100 * energy_cap(inp, g)) - spent) for g in (False, True)]
    cost = inp.energy.cost
    gym_p, flex_cost = 0, []
    full_day = class_minutes(inp) >= 360
    presences, proj_cost, must_cost = [], [], []
    optional = []  # (block, start, dur, presence)
    fills = []  # (proj 块, [(效率, 番茄数, 选中变量)])

    period_starts = [0] + [end for end, _ in inp.energy.periods[:-1]]
    periods = [(st, end, eff) for st, (end, eff) in zip(period_starts, inp.energy.periods)]
    for t in tasks:
        if need_min(t) <= 0:
            continue
        hard = t.must_today and hard_must
        if t.where == "campus" and not campus:
            if hard:
                return None
            continue
        w = weight(t, inp.day, cap)
        a, z = (campus if t.where == "campus" else (work_lo, hi))
        a = max(a, work_lo)  # 只重排今晚时 work_lo 是现在，学校的空档也不能排到过去
        if t.heavy and full_day and not t.must_today:  # 满课日难事不排晚上；今天必做的不受这条管
            z = min(z, EVENING)
        decay = inp.energy.pomodoro_decay
        N = len(decay)  # 一块最多几个番茄
        lb_n = 2 if t.heavy and need_min(t) >= 2 * POMODORO_MIN else 1
        if z - a < POMODORO_MIN * lb_n:
            if hard:
                return None
            continue
        # 今天必做的块数要够排完；不占「最多 3 块」的名额
        nb = max(BLOCKS_PER_TASK, -(-need_min(t) // (POMODORO_MIN * N))) if t.must_today else BLOCKS_PER_TASK
        prev, progs, lasts, ps = None, [], [], []
        for k in range(nb):
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
            if t.must_today:  # 用户说的分钟数就是要排的钟点时长，不按时段效率折算
                progs.append(d)
                lasts.append(POMODORO_MIN * p)
            else:
                progs.append(sum(block_progress(periods[j][2], n, decay) * v for (j, n), v in y.items()))
                lasts.append(sum((block_progress(periods[j][2], n, decay) - block_progress(periods[j][2], n - 1, decay)) * v
                                 for (j, n), v in y.items()))
            if prev:  # 第 k 块只在第 k-1 块存在时才用，并且排在它后面：编号和时间顺序一致
                pp, pe = prev
                m.AddImplication(p, pp)
                m.Add(s >= pe).OnlyEnforceIf(p)
            prev = (p, e)
            busy.append(m.NewOptionalIntervalVar(s, d, e, p, f"{t.id}-{k}-iv"))
            gapped.append(m.NewOptionalIntervalVar(s, d + pad, e + pad, p, f"{t.id}-{k}-g"))
            if task_cost(inp, t.id) > 0:
                focus_ivs.append(m.NewOptionalIntervalVar(s, d + rest, e + rest, p, f"{t.id}-{k}-f"))
                if inp.focus_free_at:
                    m.Add(s >= inp.focus_free_at).OnlyEnforceIf(p)
            (must_cost if t.must_today else proj_cost).append(round(100 * task_cost(inp, t.id)) * d)
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
            ps.append(p)
            blk = Block(f"{t.id}-{k}", t.title, 0, 0, "proj", task_id=t.id, why=_why(t, inp, cap))
            optional.append((blk, s, d, p))
            fills.append((blk, [(periods[j][2], n, v) for (j, n), v in y.items()], t.must_today))
        total = sum(progs)
        credited = m.NewIntVar(0, need_min(t), f"{t.id}-credited")  # 超出还差的进度不算分，免得为凑分多排几块
        m.Add(credited <= total)
        objective.append(w * 1440 * credited)
        for p, last in zip(ps, lasts):  # 去掉最后一个番茄就够了：不许多排
            m.Add(total - last <= need_min(t) - 1).OnlyEnforceIf(p)
        if hard:
            m.Add(total >= need_min(t))  # 今天必做：今天全部做完
        if not t.must_today:  # 今天必做的不占「最多 3 块」的名额
            presences += ps

    for f in flex:
        clash = any(e.start < f.window_end and f.window_start < e.end for e in inp.fixed)
        if clash or any(a < f.window_end and f.window_start < z for a, z in away_spans):
            continue  # 窗口里有课或人不在家就不排，不另约
        ws = max(f.window_start, work_lo)
        if f.window_end - ws < f.minutes:
            continue
        p = m.NewBoolVar(f"{f.id}-on")
        s = m.NewIntVar(ws, f.window_end - f.minutes, f"{f.id}-start")
        busy.append(m.NewOptionalIntervalVar(s, f.minutes, s + f.minutes, p, f"{f.id}-iv"))
        gapped.append(m.NewOptionalIntervalVar(s, f.minutes + pad, s + f.minutes + pad, p, f"{f.id}-g"))
        objective.append(FLEX_WEIGHT * 1440 * f.minutes * p)
        if f.id == inp.energy.gym_id:
            gym_p = p
        flex_cost.append(round(100 * cost.get(f.id, 0) * f.minutes) * p)
        d = m.NewConstant(f.minutes)
        optional.append((Block(f.id, f.title, 0, 0, "flex"), s, d, p))

    budget = allow[0] + (allow[1] - allow[0]) * gym_p
    if must_cost:  # 今天必做的项目接着扣，超了上限也照排；剩下的（可能是 0）才给别的项目和健身
        left = m.NewIntVar(0, allow[1], "budget-left")
        m.AddMaxEquality(left, [0, budget - sum(must_cost)])
        budget = left
    m.Add(sum(proj_cost) + sum(flex_cost) <= budget)  # 精力总账：课和必做先扣，剩下的才给项目和健身
    if presences:
        m.Add(sum(presences) <= MAX_PROJECT_BLOCKS)
    if len(home_ivs) > 1:
        m.AddNoOverlap(home_ivs)
    m.AddNoOverlap(gapped)
    free_ivs = []
    if not relax:  # relax 只给 _diagnose 用：去掉放松间隔和自由时间，看是不是它们造成的排不下
        m.AddNoOverlap(focus_ivs)  # 两段专注之间放松 rest 分钟；吃饭、通勤可以落在里面
        # 模型里预留自由时间的空档来保证下限，它们不进输出；输出的自由块由 free_blocks 从空档里算
        floor, prev_end, ds = inp.energy.min_free_min, work_lo, []
        for k in range(-(-floor // FREE_MIN_GAP)):
            p, d, s = m.NewBoolVar(f"free{k}-p"), m.NewIntVar(0, floor, f"free{k}-d"), m.NewIntVar(work_lo, hi, f"free{k}-s")
            m.Add(d >= FREE_MIN_GAP).OnlyEnforceIf(p)
            m.Add(d == 0).OnlyEnforceIf(p.Not())
            e = m.NewIntVar(work_lo, hi, f"free{k}-e")
            m.Add(e == s + d)
            m.Add(s >= prev_end)  # 第 k 段排在第 k-1 段之后，去掉对称解
            free_ivs.append(m.NewOptionalIntervalVar(s, d, e, p, f"free{k}-iv"))
            prev_end = e
            ds.append(d)
        m.Add(sum(ds) >= floor)
        if c.back:  # 等车不算自由时间
            wait = m.NewFixedSizeIntervalVar(c.campus_end, c.back.leave_building - c.campus_end, "wait-bus")
            m.AddNoOverlap(free_ivs + [wait])
    m.AddNoOverlap(busy + free_ivs)
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
    for b, ys, must in fills:
        for eff, n, v in ys:
            if solver.Value(v):
                b.pomodoros, b.progress_min = n, n * POMODORO_MIN if must else block_progress(eff, n, inp.energy.pomodoro_decay)
    for i, b in enumerate(sorted(projects, key=lambda b: b.start)):
        b.slot = f"p{i + 1}"
    used = spent / 100 + sum((b.end - b.start) * (task_cost(inp, b.task_id) if b.kind == "proj" else cost.get(b.id, 0))
                             for b in blocks if b.kind in ("proj", "flex"))
    gym = any(b.id == inp.energy.gym_id for b in blocks)
    return DayPlan(inp.day, sorted(blocks, key=lambda b: b.start), energy_used=used, energy_cap=energy_cap(inp, gym))


def _diagnose(inp: PlanInput, c: Commute) -> str:
    if _solve(inp, c, inp.habits, inp.meals, relax=True) is not None:
        return f"必做和三餐排得下，但留不出专注后的放松间隔和 {inp.energy.min_free_min} 分钟自由时间"
    alone_fail = [h.title for h in inp.habits if _solve(inp, c, [h], [], relax=True) is None]
    if alone_fail:
        return "必做事项排不下：" + "、".join(alone_fail)
    if _solve(inp, c, [], inp.meals, relax=True) is None:
        return "三餐排不下：固定事件把吃饭的时间占满了"
    return "必做事项和三餐加在一起排不下：" + "、".join(h.title for h in inp.habits)


LOW_ENERGY = 2  # 电量不超过这个数：习惯只排保底版（C26）


def _low_energy(inp: PlanInput, skip: set[str] = frozenset()) -> PlanInput:
    """C26 低电量用保底版：电量 ≤2 时，有保底版的习惯换成保底分钟数，标题加「（保底）」。再调一次不会再变。

    习惯省下的精力从总账里一起扣掉：不然会全给项目，累的时候项目反而变长（UI 评审 r5）。skip 里的习惯（已经做过的）不动。
    """
    if inp.energy_level is None or inp.energy_level > LOW_ENERGY:
        return inp
    low = replace(inp, habits=[replace(h, minutes=h.floor_min, title=f"{h.title}（保底）")
                               if h.floor_min < h.minutes and h.id not in skip else h for h in inp.habits])
    c = pick_commute(inp)
    saved = fixed_cost(inp, c) - fixed_cost(low, c)
    return replace(low, energy=replace(inp.energy, base_min=inp.energy.base_min - saved / inp.energy.load))


def solve_day(inp: PlanInput) -> DayPlan:
    inp = _low_energy(inp)
    c = pick_commute(inp)
    conflict = _fixed_conflict(inp, c)
    if conflict:
        raise PlanInfeasible(conflict)
    plan = _solve(inp, c, inp.habits, inp.meals, inp.tasks, inp.flex)
    if plan is None and any(t.must_today for t in inp.tasks):
        # 不强求今天必做的排完再排一次：排得出来就说明是它们放不下，按尽量排后的差额点名
        soft = _solve(inp, c, inp.habits, inp.meals, inp.tasks, inp.flex, hard_must=False)
        short = [f"{t.title}（还差 {n} 分钟）" for t in inp.tasks if t.must_today and soft
                 and (n := need_min(t) - sum(b.progress_min or 0 for b in soft.blocks if b.task_id == t.id)) > 0]
        if short:
            raise PlanInfeasible("今天剩下的时间排不下：" + "、".join(short))
    if plan is None:
        raise PlanInfeasible(_diagnose(inp, c))
    plan.blocks = sorted(plan.blocks + free_blocks(inp, plan.blocks), key=lambda b: b.start)
    plan.warnings = _warnings(inp, day_capacity(inp, c)) + [
        f"{e.title}：路上时间按单程 {inp.rules.other_travel_min} 分钟估算，以实际为准"
        for e in inp.fixed if e.where == "other"]
    if plan.energy_cap - fixed_cost(inp, c) < POMODORO_MIN and not any(b.kind == "proj" for b in plan.blocks):
        plan.warnings.append(f"今天课和必做已经用掉 {fixed_cost(inp, c) / 60:.1f} 小时精力，晚上不排项目")
    return plan


def _block_cost(inp: PlanInput, b: Block) -> float:
    cost = inp.energy.cost
    if b.kind == "proj":
        return (b.end - b.start) * task_cost(inp, b.task_id)
    if b.kind == "must":
        return (b.end - b.start) * cost.get(b.id, cost["habit"])
    return (b.end - b.start) * cost.get(b.id, 0) if b.kind == "flex" else 0


def _cutoff(inp: PlanInput, keep: list[Block], now: int) -> tuple[int, int | None]:
    """重排从哪一分钟开始（现在，或正在做的那块结束），以及新的专注最早几点开始（刚做完的专注块放松完）。"""
    rest = inp.energy.rest_after_focus_min
    cutoff = max([now] + [b.end for b in keep])
    # 和排整天时一样：必做习惯都算专注，项目要花精力才算；健身、吃饭不算
    free_at = max([cutoff] + [b.end + rest for b in keep if b.kind == "must" or (b.kind == "proj" and _block_cost(inp, b) > 0)])
    return cutoff, free_at if free_at > cutoff else None


def replan_from(inp: PlanInput, now: str, done_ids: list[str] = (), before: list[Block] | None = None) -> DayPlan:
    """只重排今晚（C27）：now 之前开始的块原样保留，done_ids 里的事不再排，剩下的从 now 起重排。

    before 是今天已经存着的计划（用户真看到、真做了的）；不给就按同一份输入重排出原计划
    （求解器固定随机种子、单线程，同样输入排出同样的计划）。改了设置时一定要给：按新设置假想出来的上午
    和真实的上午不一样，两边都不要的事就悄悄没了（代码评审 H1）。
    """
    t = to_min(now)
    unknown = set(done_ids) - {x.id for x in [*inp.habits, *inp.meals, *inp.flex, *inp.tasks]}
    if unknown:
        raise InputError(f"输入有误：done_ids 里有不认识的 id：{sorted(unknown)}")
    orig = inp
    if before is None:
        before = solve_day(replace(inp, energy_level=None)).blocks  # 上午照原计划排的，不受刚报的电量影响
    past = [b for b in before if b.start < t and not b.id.startswith("free-")]
    keep = [b for b in past if b.kind != "class" and not b.id.startswith(MOVE_PREFIXES)]
    # 正在做的那块做完再说；专注块做完还要放松，这段只挡新的专注，吃饭、健身照样可以排（和排整天时一样）
    cutoff, focus_free_at = _cutoff(inp, keep, t)
    drop = {b.id for b in keep} | set(done_ids)
    # 和排整天时一样：非生活类的块后面留 min_gap_min，正在做的那块也算（UI 评审 r6：打球曾贴着高数开始）
    work_lo = max([cutoff] + [b.end + inp.rules.min_gap_min for b in keep if b.kind != "life"])
    inp = _low_energy(inp, drop)  # 已经做过的习惯不算「省下」的精力

    progress: dict[str, int] = {}
    for b in keep:
        if b.kind == "proj":
            progress[b.task_id] = progress.get(b.task_id, 0) + (b.progress_min or 0)
    tasks = [replace(x, remaining_min=max(0, x.remaining_min - math.ceil(progress.get(x.id, 0) / x.est_factor)))
             for x in inp.tasks if x.id not in drop]

    start = max(focus_free_at or cutoff, work_lo)  # 必做习惯是专注：要等刚做完的那块放松完才能开始；吃饭不用等
    habit_block = inp.habit_block
    block_on = sum(h.id in habit_block for h in inp.habits) >= 2
    if block_on and sum(h.minutes for h in inp.habits if h.id in habit_block and h.id not in drop) > inp.sleep - start:
        block_on, habit_block = False, []  # 睡前剩的时间放不下整块：拆开按各自的窗口排，放不下的报「来不及」
    # 原计划里成块排的习惯不看自己的窗口；块里只剩一项时求解器会改回看窗口，所以把窗口放宽到整天
    habits = [replace(h, window_start=inp.wake, window_end=inp.sleep) if block_on and h.id in habit_block else h
              for h in inp.habits if h.id not in drop]
    meals = [x for x in inp.meals if x.id not in drop]

    def fits(x, at: int) -> bool:
        return x.window_end - max(x.window_start, at) >= x.minutes

    late = [x.title for x in habits if not fits(x, start)] + [x.title for x in meals if not fits(x, cutoff)]
    habits, meals = [h for h in habits if fits(h, start)], [x for x in meals if fits(x, cutoff)]

    cost = inp.energy.cost
    past_cost = sum(_block_cost(inp, b) for b in keep)
    kept_ids = {b.id for b in keep}
    # 提前做完的必做和健身也花了精力；没保留在计划里的按标准时长记
    past_cost += sum(h.minutes * cost.get(h.id, cost["habit"]) for h in orig.habits if h.id in done_ids and h.id not in kept_ids)
    past_cost += sum(f.minutes * cost.get(f.id, 0) for f in inp.flex if f.id in done_ids and f.id not in kept_ids)
    gym_done = inp.energy.gym_id in kept_ids or inp.energy.gym_id in done_ids
    en = inp.energy
    past_free = sum(min(b.end, t) - b.start for b in before if b.id.startswith("free-") and b.start < t)
    free_left = min(max(0, en.min_free_min - past_free), max(0, inp.sleep - work_lo))
    energy = replace(en, base_min=en.base_min + en.gym_bonus_min * gym_done - past_cost / en.load,
                     min_free_min=free_left if free_left >= FREE_MIN_GAP else 0)
    ids = {h.id for h in habits}
    rest = replace(inp, wake=cutoff, rules=replace(inp.rules, getup_min=work_lo - cutoff), habits=habits, meals=meals,
                   flex=[f for f in inp.flex if f.id not in drop], tasks=tasks, energy=energy,
                   habit_block=[i for i in habit_block if i in ids], focus_free_at=focus_free_at)
    after = solve_day(rest)

    # 过去的课和通勤照原计划留着；新排的只要现在（或正在做的那块结束）之后的
    cut = max([t] + [b.end for b in past])
    new = [b for b in after.blocks if not b.id.startswith("free-") and b.start >= cut]
    used = {b.id for b in past}
    for b in new:
        while b.id in used:  # 同一个项目上午排过 x-0，晚上新排的也叫 x-0：改名免得日历同步认错（重排几次都不重名）
            b.id += "-r"
        used.add(b.id)
    blocks = past + new
    projects = sorted((b for b in blocks if b.kind == "proj"), key=lambda b: b.start)
    for i, b in enumerate(projects):
        b.slot = f"p{i + 1}"  # shortcut: 上午已有项目块时可能出现 p4，网页只显示 p1–p3；做 API 时再定怎么显示
    # 自由时间：过去的照旧，之后的按拼好的计划重新算，编号从头排，不会重复
    old_free = [b for b in before if b.id.startswith("free-") and b.end <= t]
    edge = max([b.end for b in past + old_free], default=0)
    free = old_free + [b for b in free_blocks(inp, blocks) if b.start >= edge]
    for i, b in enumerate(sorted(free, key=lambda b: b.start)):
        b.id = f"free-{i}"
    blocks = sorted(blocks + free, key=lambda b: b.start)
    gym = any(b.id == inp.energy.gym_id for b in blocks)
    warnings = after.warnings + [f"来不及排了：{x}" for x in late]
    return DayPlan(inp.day, blocks, warnings, energy_used=after.energy_used + past_cost, energy_cap=energy_cap(inp, gym))
