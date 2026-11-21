"""改了设置（或复盘里点了「好」）时重排今天剩下的部分。

和 planner.replan_from 做的是同一件事，只差一点：「已经过去的」用存着的计划（用户真看到、真做了的），
不是按新设置假想重排出来的上午。用 replan_from 的话，假想上午排在「现在」之前、实际计划里排在之后的事，
两边都不要，就悄悄没了（代码评审 H1）。
shortcut: 抄了 replan_from 的后半段（当时求解器在另一个仓库，不能动）；现在它在 planner/ 里，有空时给 replan_from 加一个 before 参数，删掉这个文件。
"""
import math
from dataclasses import fields, replace

from planner.model import PlanInput, to_min
from planner.solve import (FREE_MIN_GAP, MOVE_PREFIXES, Block, DayPlan, _block_cost, _low_energy, energy_cap,
                           free_blocks, solve_day)

_FIELDS = {f.name for f in fields(Block)}


def _block(b: dict) -> Block:
    return Block(**{**{k: v for k, v in b.items() if k in _FIELDS}, "start": to_min(b["start"]), "end": to_min(b["end"])})


def replan_after(inp: PlanInput, stored: list[dict], now: int) -> DayPlan:
    """stored 是今天存着的计划块，now 是现在（分钟）。现在之前开始的块原样留下（自由时间除外，重新算），
    那些块里排过的习惯、三餐、可选项不再排；项目扣掉已经做了的进度；剩下的从现在（或正在做的那块结束）起重排。"""
    before = [_block(b) for b in stored]
    past = [b for b in before if b.start < now and not b.id.startswith("free-")]
    keep = [b for b in past if b.kind != "class" and not b.id.startswith(MOVE_PREFIXES)]
    inp = _low_energy(inp)
    rest_min = inp.energy.rest_after_focus_min
    cutoff = max([now] + [b.end + (rest_min if _block_cost(inp, b) > 0 else 0) for b in keep])
    drop = {b.id for b in keep}

    progress: dict[str, int] = {}
    for b in keep:
        if b.kind == "proj":
            progress[b.task_id] = progress.get(b.task_id, 0) + (b.progress_min or 0)
    tasks = [replace(x, remaining_min=max(0, x.remaining_min - math.ceil(progress.get(x.id, 0) / x.est_factor)))
             for x in inp.tasks if x.id not in drop]
    block_on = sum(h.id in inp.habit_block for h in inp.habits) >= 2
    habits = [replace(h, window_start=inp.wake, window_end=inp.sleep) if block_on and h.id in inp.habit_block else h
              for h in inp.habits if h.id not in drop]
    meals = [x for x in inp.meals if x.id not in drop]

    def fits(x) -> bool:
        return x.window_end - max(x.window_start, cutoff) >= x.minutes

    late = [x.title for x in habits + meals if not fits(x)]
    habits, meals = [h for h in habits if fits(h)], [x for x in meals if fits(x)]

    past_cost = sum(_block_cost(inp, b) for b in keep)
    en = inp.energy
    gym_done = en.gym_id in drop
    past_free = sum(min(b.end, now) - b.start for b in before if b.id.startswith("free-") and b.start < now)
    free_left = min(max(0, en.min_free_min - past_free), max(0, inp.sleep - cutoff))
    energy = replace(en, base_min=en.base_min + en.gym_bonus_min * gym_done - past_cost / en.load,
                     min_free_min=free_left if free_left >= FREE_MIN_GAP else 0)
    ids = {h.id for h in habits}
    after = solve_day(replace(inp, wake=cutoff, rules=replace(inp.rules, getup_min=0), habits=habits, meals=meals,
                              flex=[f for f in inp.flex if f.id not in drop], tasks=tasks, energy=energy,
                              habit_block=[i for i in inp.habit_block if i in ids]))

    cut = max([now] + [b.end for b in past])
    new = [b for b in after.blocks if not b.id.startswith("free-") and b.start >= cut]
    for b in new:
        if b.id in drop:  # 上午排过 x-0，晚上新排的也叫 x-0：改名免得日历同步认错
            b.id += "-r"
    blocks = past + new
    for i, b in enumerate(sorted((b for b in blocks if b.kind == "proj"), key=lambda b: b.start)):
        b.slot = f"p{i + 1}"
    # 自由时间：过去的照旧，现在之后的按拼好的计划重新算（按新的上床时间），编号从头排，不会重复
    old_free = [b for b in before if b.id.startswith("free-") and b.end <= now]
    edge = max([b.end for b in past + old_free], default=0)
    free = old_free + [b for b in free_blocks(inp, blocks) if b.start >= edge]
    for i, b in enumerate(sorted(free, key=lambda b: b.start)):
        b.id = f"free-{i}"
    gym = any(b.id == en.gym_id for b in blocks)
    return DayPlan(inp.day, sorted(blocks + free, key=lambda b: b.start), after.warnings + [f"来不及排了：{x}" for x in late],
                   energy_used=after.energy_used + past_cost, energy_cap=energy_cap(inp, gym))
