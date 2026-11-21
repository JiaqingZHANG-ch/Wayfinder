"""改了设置（或复盘里点了「好」）时重排今天剩下的部分：「已经过去的」用存着的计划（用户真看到、真做了的）。"""
from dataclasses import fields

from planner.model import PlanInput, to_hhmm, to_min
from planner.solve import Block, DayPlan, replan_from

_FIELDS = {f.name for f in fields(Block)}


def _block(b: dict) -> Block:
    return Block(**{**{k: v for k, v in b.items() if k in _FIELDS}, "start": to_min(b["start"]), "end": to_min(b["end"])})


def replan_after(inp: PlanInput, stored: list[dict], now: int) -> DayPlan:
    """stored 是今天存着的计划块，now 是现在（分钟）。"""
    return replan_from(inp, to_hhmm(now), before=[_block(b) for b in stored])
