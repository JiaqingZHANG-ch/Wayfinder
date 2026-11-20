"""设置表单 ↔ 求解器输入（daily-planner 的 JSON 格式）。表单管：作息、习惯和保底版、每周课表、项目、每件事累不累、提醒。"""
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from mentor.review import MAX_HABITS, new_id

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
# 能量地图三选一 → 每分钟消耗（合并版设计 六之四 第 3 步）：热爱 0、累但回血 0.5、擅长但耗能 1
ENERGY_COST = {"love": 0.0, "recharge": 0.5, "drain": 1.0}
# 没有旧设置时的三餐（新用户）；有旧设置就沿用旧的
DEFAULT_MEALS = [
    {"id": "breakfast", "title": "早饭", "minutes": 20, "window": ["06:30", "10:00"]},
    {"id": "lunch", "title": "午饭", "minutes": 45, "window": ["11:30", "14:00"]},
    {"id": "dinner", "title": "晚饭", "minutes": 45, "window": ["17:30", "20:30"]},
]


Energy = Literal["love", "recharge", "drain"]
WEEKDAYS = "一二三四五六日"


class HabitIn(BaseModel):
    id: str | None = Field(None, description="已有的习惯带上原来的 id，对账和复盘的历史才接得上；新加的不填")
    title: str = Field(min_length=1, max_length=20)
    minutes: int = Field(ge=5, le=180, description="标准版几分钟")
    floor_min: int = Field(ge=1, le=180, description="保底版几分钟（没电时做这么多）")
    energy: Literal["love", "recharge", "drain"] | None = Field(
        None, description="做这件事：热爱 love／累但回血 recharge／擅长但耗能 drain")

    @model_validator(mode="after")
    def floor_not_above_standard(self):
        if self.floor_min > self.minutes:
            raise ValueError("保底版不能比标准版还长")
        return self


class ClassIn(BaseModel):
    """课表里的一节课，每周这一天都有。"""
    title: str = Field(min_length=1, max_length=30)
    weekday: int = Field(ge=0, le=6, description="星期几：0 = 星期一 … 6 = 星期日")
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    where: Literal["campus", "other"] = Field("campus", description="在学校（按通勤算路上时间）或别处")
    energy: Energy | None = None

    @model_validator(mode="after")
    def ends_after_start(self):
        if self.end <= self.start:
            raise ValueError(f"{self.title}：下课时间要晚于上课时间")
        return self


class ProjectIn(BaseModel):
    """一个要往前推的项目（复习、作业、作品）：晚上有精力时排番茄。"""
    id: str | None = Field(None, description="已有的项目带上原来的 id；新加的不填")
    title: str = Field(min_length=1, max_length=30)
    hours_left: float = Field(gt=0, le=500, description="估计还要几小时")
    deadline: date | None = None
    heavy: bool = Field(False, description="费脑子的事：一次至少排一大块")
    energy: Energy | None = None


class RemindersIn(BaseModel):
    after_class: bool = Field(True, description="下课时问电量（时间按当天最后一节课自动算）")
    evening: str | None = Field("21:00", pattern=HHMM, description="晚上对账提醒的时间；null = 不提醒")


class SettingsIn(BaseModel):
    wake: str = Field(pattern=HHMM, description="几点起床")
    sleep: str = Field(pattern=HHMM, description="几点上床")
    habits: list[HabitIn] = Field(min_length=1, max_length=MAX_HABITS, description="新用户从 1 个习惯开始")
    timetable: list[ClassIn] | None = Field(None, max_length=60, description="每周课表；不填 = 不改原来的")
    projects: list[ProjectIn] | None = Field(None, max_length=10, description="项目；不填 = 不改原来的")
    reminders: RemindersIn = Field(default_factory=RemindersIn)

    @model_validator(mode="after")
    def classes_do_not_overlap(self):
        days: dict[int, list[ClassIn]] = {}
        for c in self.timetable or []:
            days.setdefault(c.weekday, []).append(c)
        for wd, cs in days.items():
            cs = sorted(cs, key=lambda c: c.start)
            for a, b in zip(cs, cs[1:]):
                if b.start < a.end:
                    raise ValueError(f"星期{WEEKDAYS[wd]}的「{a.title}」和「{b.title}」时间重叠了")
        return self


def _keep_ids(items: list, old: list[dict], prefix: str) -> list[str]:
    """表单里带了旧 id 且确实存在的就沿用；其余的（新加的、乱填的）发一个新 id。"""
    known, out = {o["id"] for o in old}, []
    for x in items:
        out.append(x.id if x.id in known and x.id not in out else new_id(prefix))
    return out


def for_day(raw: dict, day: date) -> dict:
    """某一天的求解器输入：课表里这天星期几的课加进 fixed。"""
    classes = [{"id": c["id"], "title": c["title"], "start": c["start"], "end": c["end"], "where": c["where"],
                "kind": "class"} for c in raw.get("timetable", []) if c["weekday"] == day.weekday()]
    return {**raw, "day": day.isoformat(), "fixed": raw.get("fixed", []) + classes}


def to_plan_input(s: SettingsIn, base: dict | None) -> dict:
    """把表单写进求解器输入。base 是旧设置：课、项目、三餐、规则等表单不管的部分原样留下。"""
    raw = dict(base or {"meals": DEFAULT_MEALS})
    old_habits, old_classes, old_tasks = raw.get("habits", []), raw.get("timetable", []), raw.get("tasks", [])
    habits = [{"id": i, "title": h.title, "minutes": h.minutes, "floor_min": h.floor_min, "window": [s.wake, s.sleep]}
              for i, h in zip(_keep_ids(s.habits, old_habits, "habit"), s.habits)]
    pairs = [(h["id"], x.energy) for h, x in zip(habits, s.habits)]
    changed = {h["id"] for h in old_habits}  # 这几类的旧消耗值都去掉，再按表单重写
    if s.timetable is not None:
        raw["timetable"] = [{"id": f"class-{i}", **c.model_dump(exclude={"energy"})}
                            for i, c in enumerate(s.timetable, 1)]
        changed |= {c["id"] for c in old_classes}
        pairs += [(c["id"], x.energy) for c, x in zip(raw["timetable"], s.timetable)]
    if s.projects is not None:
        old = {t["id"]: t for t in old_tasks}
        def minutes(i, hours):  # 没改小时数就沿用原来的分钟数，不让显示时的取整一次次累积
            o = old.get(i)
            return o["remaining_min"] if o and round(o["remaining_min"] / 60, 2) == hours else max(1, round(hours * 60))

        raw["tasks"] = [{**old.get(i, {}), "id": i, "project": p.title, "title": p.title,
                         "remaining_min": minutes(i, p.hours_left), "heavy": p.heavy,
                         "deadline": p.deadline and p.deadline.isoformat()}
                        for i, p in zip(_keep_ids(s.projects, old_tasks, "proj"), s.projects)]
        changed |= set(old)
        pairs += [(t["id"], x.energy) for t, x in zip(raw["tasks"], s.projects)]
    energy = dict(raw.get("energy", {}))
    cost = {k: v for k, v in energy.get("cost", {}).items() if k not in changed}
    cost.update({i: ENERGY_COST[e] for i, e in pairs if e})
    raw.update(wake=s.wake, sleep=s.sleep, habits=habits, energy={**energy, "cost": cost},
               reminders=s.reminders.model_dump())  # 求解器不认这一段，读输入时会忽略
    if {h["id"] for h in habits} != {h["id"] for h in old_habits}:
        raw.pop("habit_block", None)  # 连成一块的设置是按旧习惯 id 写的，换了习惯就不再适用
    return raw


def from_plan_input(raw: dict) -> dict:
    """反过来给设置页显示。消耗值不是三档之一（比如旧模板里的）就显示成没选。"""
    cost = raw.get("energy", {}).get("cost", {})
    by_cost = {v: k for k, v in ENERGY_COST.items()}
    def en(i):
        return by_cost.get(cost.get(i))

    return {"wake": raw["wake"], "sleep": raw["sleep"],
            "habits": [{"id": h["id"], "title": h["title"], "minutes": h["minutes"],
                        "floor_min": h.get("floor_min", h["minutes"]), "energy": en(h["id"])}
                       for h in raw.get("habits", [])],
            "timetable": [{**{k: c[k] for k in ("title", "weekday", "start", "end", "where")}, "energy": en(c["id"])}
                          for c in raw.get("timetable", [])],
            "projects": [{"id": t["id"], "title": t["title"], "hours_left": round(t["remaining_min"] / 60, 2),
                          "deadline": t.get("deadline"), "heavy": bool(t.get("heavy")), "energy": en(t["id"])}
                         for t in raw.get("tasks", [])],
            "reminders": RemindersIn(**raw.get("reminders", {})).model_dump()}
