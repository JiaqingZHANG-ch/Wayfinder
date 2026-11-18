"""输入模型：把 plan_input.json 读成数据类，时间统一换成当天的分钟整数。"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .errors import InputError

FIXED_WHERE = {"home", "campus", "other"}
KINDS = {"class", "exam", "meeting", "tentative"}
PLACE = {"home", "campus", "any"}


def to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


@dataclass
class Energy:
    base_min: int = 480
    gym_bonus_min: int = 120
    load: float = 0.8
    periods: list[tuple[int, float]] = field(default_factory=lambda: [(720, 2.0), (1080, 1.5), (1440, 1.0)])  # (结束分钟, 效率)
    cost: dict[str, float] = field(default_factory=lambda: {"class": 1.0, "project": 1.0, "habit": 1.0, "calligraphy": 0.5})
    pomodoro_decay: list[float] = field(default_factory=lambda: [1.0, 0.85, 0.7])  # 长度 = 一块最多几个番茄
    rest_after_focus_min: int = 30
    min_free_min: int = 120


@dataclass
class Rules:
    leave_after_class_min: int = 20
    walk_to_stop_min: int = 10
    min_gap_min: int = 5
    # 第二步起求解器不再用，留着是为了旧输入能读
    heavy_min_block: int = 120
    light_min_block: int = 30
    getup_min: int = 15  # 起床后先洗漱，不贴着闹钟开工
    other_travel_min: int = 30  # 去「其他地点」的单程估计


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
    where: str = "any"  # home | campus | any（练字只能在家）


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
    energy: Energy = field(default_factory=Energy)
    habit_block: list[str] = field(default_factory=list)


def _window(d: dict) -> tuple[int, int]:
    return to_min(d["window"][0]), to_min(d["window"][1])


def load_input(path: Path) -> PlanInput:
    """读输入并检查；任何格式或取值错误都变成 InputError（消息以「输入有误」开头）。"""
    try:
        inp = _load(json.loads(Path(path).read_text(encoding="utf-8")))
    except InputError:
        raise
    except (KeyError, TypeError, ValueError, IndexError) as e:
        raise InputError(f"输入有误：{type(e).__name__}: {e}") from e
    _validate(inp)
    return inp


def _validate(inp: PlanInput) -> None:
    def need(ok: bool, msg: str) -> None:
        if not ok:
            raise InputError("输入有误：" + msg)

    need(inp.wake < inp.sleep, "起床时间要早于睡觉时间")
    for e in inp.fixed:
        need(e.where in FIXED_WHERE, f"{e.title} 的 where 只能是 {sorted(FIXED_WHERE)}，现在是 {e.where!r}")
        need(e.kind in KINDS, f"{e.title} 的 kind 只能是 {sorted(KINDS)}，现在是 {e.kind!r}")
        need(e.start < e.end, f"{e.title} 的开始要早于结束")
    for x in [*inp.meals, *inp.habits, *inp.flex]:
        need(x.minutes > 0, f"{x.title} 的时长要大于 0")
        need(x.window_start < x.window_end, f"{x.title} 的时间窗口开始要早于结束")
    for h in inp.habits:
        need(h.where in PLACE, f"{h.title} 的 where 只能是 {sorted(PLACE)}，现在是 {h.where!r}")
    ids = [t.id for t in inp.tasks]
    need(len(ids) == len(set(ids)), "任务 id 有重复")
    for t in inp.tasks:
        need(t.where in PLACE, f"{t.title} 的 where 只能是 {sorted(PLACE)}，现在是 {t.where!r}")
        need(t.remaining_min >= 0, f"{t.title} 的剩余时间不能是负数")
    en = inp.energy
    ends = [end for end, _ in en.periods]
    need(bool(ends) and ends == sorted(set(ends)) and ends[-1] >= inp.sleep,
         "energy.periods 的结束时间要严格升序，且最后一个要覆盖到睡觉时间")
    need(0 < en.load <= 1, f"energy.load 要在 (0, 1] 之间，现在是 {en.load}")
    need(bool(en.pomodoro_decay), "energy.pomodoro_decay 不能是空的")
    for k, v in en.cost.items():
        need(type(v) in (int, float) and v >= 0, f"energy.cost.{k} 要是不小于 0 的数，现在是 {v!r}")
    from .solve import FREE_MIN_GAP  # 局部导入：solve 依赖 model
    for name in ("min_free_min", "rest_after_focus_min"):
        v = getattr(en, name)
        need(type(v) is int and v >= 0, f"energy.{name} 要是非负整数，现在是 {v!r}")
    need(en.min_free_min == 0 or en.min_free_min >= FREE_MIN_GAP, f"energy.min_free_min 要是 0 或至少 {FREE_MIN_GAP}")
    need(len(inp.habit_block) == len(set(inp.habit_block)), "habit_block 有重复的 id")


def _load(raw: dict) -> PlanInput:
    rules = Rules(**raw.get("rules", {}))
    ej = dict(raw.get("energy", {}))
    if "periods" in ej:
        ej["periods"] = [(to_min(end), float(eff)) for end, eff in ej["periods"]]
    ej["cost"] = {**Energy().cost, **ej.get("cost", {})}
    energy = Energy(**ej)

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
        habits=[Habit(h["id"], h["title"], int(h["minutes"]), *_window(h), bool(h.get("can_be_on_bus", False)),
                      h.get("where", "any"))
                for h in raw.get("habits", [])],
        flex=[Flex(f["id"], f["title"], int(f["minutes"]), *_window(f)) for f in raw.get("flex", [])],
        tasks=[task(t) for t in raw.get("tasks", [])],
        bus_to_campus=[BusToCampus(to_min(a), to_min(b)) for a, b in raw.get("bus_to_campus", [])],
        bus_to_home=[BusToHome(to_min(a), to_min(b)) for a, b in raw.get("bus_to_home", [])],
        energy=energy,
        habit_block=list(raw.get("habit_block", [])),
    )
