"""输入模型：把 plan_input.json 读成数据类，时间统一换成当天的分钟整数。"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path


def to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


@dataclass
class Rules:
    leave_after_class_min: int = 20
    walk_to_stop_min: int = 10
    min_gap_min: int = 5
    heavy_min_block: int = 120
    light_min_block: int = 30


@dataclass
class FixedEvent:
    id: str
    title: str
    start: int
    end: int
    where: str  # home | campus | other
    kind: str  # class | exam | meeting | tentative


@dataclass
class BusToCampus:
    leave_home: int
    arrive_campus: int


@dataclass
class BusToHome:
    leave_building: int
    arrive_home: int


@dataclass
class Habit:
    id: str
    title: str
    minutes: int
    window_start: int
    window_end: int
    can_be_on_bus: bool = False


@dataclass
class Flex:
    id: str
    title: str
    minutes: int
    window_start: int
    window_end: int


@dataclass
class Meal:
    id: str
    title: str
    minutes: int
    window_start: int
    window_end: int


@dataclass
class Task:
    id: str
    project: str
    title: str
    remaining_min: int
    deadline: date | None
    heavy: bool
    min_block: int
    max_block: int
    where: str  # home | campus | any
    steps: list[str] = field(default_factory=list)
    done_criteria: str = ""
    est_factor: float = 1.0


@dataclass
class PlanInput:
    day: date
    wake: int
    sleep: int
    rules: Rules
    fixed: list[FixedEvent]
    meals: list[Meal]
    habits: list[Habit]
    flex: list[Flex]
    tasks: list[Task]
    bus_to_campus: list[BusToCampus]
    bus_to_home: list[BusToHome]


def _window(d: dict) -> tuple[int, int]:
    return to_min(d["window"][0]), to_min(d["window"][1])


def load_input(path: Path) -> PlanInput:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    rules = Rules(**raw.get("rules", {}))

    def task(t: dict) -> Task:
        heavy = bool(t.get("heavy", False))
        return Task(
            id=t["id"], project=t["project"], title=t["title"],
            remaining_min=int(t["remaining_min"]),
            deadline=date.fromisoformat(t["deadline"]) if t.get("deadline") else None,
            heavy=heavy,
            min_block=int(t.get("min_block", rules.heavy_min_block if heavy else rules.light_min_block)),
            max_block=int(t.get("max_block", 180)),
            where=t.get("where", "any"),
            steps=list(t.get("steps", [])),
            done_criteria=t.get("done_criteria", ""),
            est_factor=float(t.get("est_factor", 1.0)),
        )

    return PlanInput(
        day=date.fromisoformat(raw["day"]),
        wake=to_min(raw["wake"]),
        sleep=to_min(raw["sleep"]),
        rules=rules,
        fixed=[FixedEvent(e["id"], e["title"], to_min(e["start"]), to_min(e["end"]), e["where"], e["kind"])
               for e in raw.get("fixed", [])],
        meals=[Meal(m["id"], m["title"], int(m["minutes"]), *_window(m)) for m in raw.get("meals", [])],
        habits=[Habit(h["id"], h["title"], int(h["minutes"]), *_window(h), bool(h.get("can_be_on_bus", False)))
                for h in raw.get("habits", [])],
        flex=[Flex(f["id"], f["title"], int(f["minutes"]), *_window(f)) for f in raw.get("flex", [])],
        tasks=[task(t) for t in raw.get("tasks", [])],
        bus_to_campus=[BusToCampus(to_min(a), to_min(b)) for a, b in raw.get("bus_to_campus", [])],
        bus_to_home=[BusToHome(to_min(a), to_min(b)) for a, b in raw.get("bus_to_home", [])],
    )
