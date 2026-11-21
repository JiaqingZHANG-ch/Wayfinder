"""急迫度：看松弛时间（截止前还能用的天数 − 还需要的天数），不只看截止日。"""
from __future__ import annotations

import math
from datetime import date

from .model import Task


def need_min(task: Task) -> int:
    return math.ceil(task.remaining_min * task.est_factor)


def slack_days(task: Task, today: date, daily_cap: int) -> float:
    if task.deadline is None:
        return math.inf
    return (task.deadline - today).days - need_min(task) / daily_cap


def weight(task: Task, today: date, daily_cap: int) -> int:
    if task.deadline is None:
        return 10
    return round(1000 / max(slack_days(task, today, daily_cap), 0.5))
