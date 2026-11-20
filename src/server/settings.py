"""设置表单 ↔ 求解器输入（daily-planner 的 JSON 格式）。表单只管建档要的几样：作息、习惯和保底版、每件事累不累。"""
from typing import Literal

from pydantic import BaseModel, Field, model_validator

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
# 能量地图三选一 → 每分钟消耗（合并版设计 六之四 第 3 步）：热爱 0、累但回血 0.5、擅长但耗能 1
ENERGY_COST = {"love": 0.0, "recharge": 0.5, "drain": 1.0}
# 没有旧设置时的三餐（新用户）；有旧设置就沿用旧的
DEFAULT_MEALS = [
    {"id": "breakfast", "title": "早饭", "minutes": 20, "window": ["06:30", "10:00"]},
    {"id": "lunch", "title": "午饭", "minutes": 45, "window": ["11:30", "14:00"]},
    {"id": "dinner", "title": "晚饭", "minutes": 45, "window": ["17:30", "20:30"]},
]


class HabitIn(BaseModel):
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


class RemindersIn(BaseModel):
    after_class: bool = Field(True, description="下课时问电量（时间按当天最后一节课自动算）")
    evening: str | None = Field("21:00", pattern=HHMM, description="晚上对账提醒的时间；null = 不提醒")


class SettingsIn(BaseModel):
    wake: str = Field(pattern=HHMM, description="几点起床")
    sleep: str = Field(pattern=HHMM, description="几点上床")
    habits: list[HabitIn] = Field(min_length=1, max_length=3, description="新用户从 1 个习惯开始")
    reminders: RemindersIn = Field(default_factory=RemindersIn)


def to_plan_input(s: SettingsIn, base: dict | None) -> dict:
    """把表单写进求解器输入。base 是旧设置：课、项目、三餐、规则等表单不管的部分原样留下。"""
    raw = dict(base or {"meals": DEFAULT_MEALS})
    habits = [{"id": f"habit-{i}", "title": h.title, "minutes": h.minutes, "floor_min": h.floor_min,
               "window": [s.wake, s.sleep]} for i, h in enumerate(s.habits, 1)]
    old_ids = {h["id"] for h in raw.get("habits", [])}
    energy = dict(raw.get("energy", {}))
    cost = {k: v for k, v in energy.get("cost", {}).items() if k not in old_ids}  # 旧习惯的消耗值一起去掉
    cost.update({h["id"]: ENERGY_COST[x.energy] for h, x in zip(habits, s.habits) if x.energy})
    raw.update(wake=s.wake, sleep=s.sleep, habits=habits, energy={**energy, "cost": cost},
               reminders=s.reminders.model_dump())  # 求解器不认这一段，读输入时会忽略
    raw.pop("habit_block", None)  # 连成一块的设置是按旧习惯 id 写的，换了习惯就不再适用
    return raw


def from_plan_input(raw: dict) -> dict:
    """反过来给设置页显示。消耗值不是三档之一（比如旧模板里的）就显示成没选。"""
    cost = raw.get("energy", {}).get("cost", {})
    by_cost = {v: k for k, v in ENERGY_COST.items()}
    return {"wake": raw["wake"], "sleep": raw["sleep"],
            "habits": [{"title": h["title"], "minutes": h["minutes"], "floor_min": h.get("floor_min", h["minutes"]),
                        "energy": by_cost.get(cost.get(h["id"]))} for h in raw.get("habits", [])],
            "reminders": RemindersIn(**raw.get("reminders", {})).model_dump()}
