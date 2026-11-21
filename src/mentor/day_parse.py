"""说一句话排今天：把用户说的今天要做的事拆成事项。模型只管拆，不估时长（没说的由程序查记忆或按精力档给默认值）。"""
import json
import re
from collections.abc import Callable
from typing import Literal

from planner.model import to_min

from .model import ModelError, ModelPort
from .review import new_id
from .safety import model_output_is_crisis
from .tone import banned_hits

EFFORTS = ("light", "normal", "heavy")
DEFAULT_MIN = {"light": 30, "normal": 60, "heavy": 90}  # 没说时长、也没有上次记录时用
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
Outcome = Literal["ok", "crisis", "bad"]


def memory_key(title: str) -> str:
    """记时长用的键：去掉空格和数字，「读论文 2」和「读论文」是同一件事。"""
    return re.sub(r"[\s\d]", "", title)


def schema() -> dict:
    # 全部必填：qwen3 会丢掉选填字段（见 checkin.schema_for）；不知道的填 null
    hhmm = {"type": ["string", "null"], "pattern": HHMM}
    item = {"type": "object", "required": ["title", "kind", "start", "end", "minutes", "effort"], "properties": {
        "title": {"type": "string"}, "kind": {"enum": ["fixed", "task"]}, "start": hhmm, "end": hhmm,
        "minutes": {"type": ["integer", "null"]}, "effort": {"enum": list(EFFORTS)}}}
    return {"type": "object", "required": ["items"],
            "properties": {"items": {"type": "array", "items": item}, "crisis": {"type": "boolean"}}}


PROMPT = (
    "你把用户说的「今天要做的事」拆成事项，只回 JSON：{\"items\": [...]}。\n"
    "每项都要有这些字段：title（1–30 字的短名字）、kind、start、end、minutes、effort。\n"
    "kind：fixed = 用户说了具体几点的事（「9 点到 11 点上课」「下午三点开组会」「10 点面试」），"
    "start 写 HH:MM（24 小时制），说了结束时间就写 end，没说 end 写 null；"
    "task = 没说具体几点、要找时间做的事（「下午」「晚上」不算具体几点），start 和 end 写 null。\n"
    "minutes：用户明说了要做多久（「一小时」= 60）就写分钟数，没说就写 null，不要自己猜。\n"
    "effort：light = 轻松的事，normal = 一般，heavy = 费脑力、要专心的事。\n"
    "用户没提到的事不要加。如果用户的话里有想伤害自己的意思，只回 {\"crisis\": true}。"
)


def _clean(obj: object, remembered: Callable[[str], int | None]) -> dict:
    """一项：校验并补全，不合格抛 ValueError。"""
    if not isinstance(obj, dict):
        raise ValueError("事项要是对象")
    title, kind, effort, minutes = (obj.get(k) for k in ("title", "kind", "effort", "minutes"))
    title = title.strip() if isinstance(title, str) else ""
    if not 1 <= len(title) <= 30 or banned_hits(title):
        raise ValueError("名字不合格")
    if kind not in ("fixed", "task") or effort not in EFFORTS:
        raise ValueError("kind 或 effort 不对")
    start, end = obj.get("start"), obj.get("end")
    ok = [isinstance(t, str) and bool(re.match(HHMM, t)) for t in (start, end)]
    if kind == "fixed" and all(ok):
        if to_min(start) >= to_min(end):
            raise ValueError("固定事项的开始要早于结束")
        minutes, source = to_min(end) - to_min(start), "说的"
    elif kind == "fixed" and not ok[0]:
        raise ValueError("固定事项要有合法的开始时间")
    else:
        # task 不要时间；fixed 只说了几点开始（「三点开组会」）：结束按时长补，时长和 task 一样来
        start, end = (start if kind == "fixed" else None), None
        if minutes is not None:
            if type(minutes) is not int:
                raise ValueError("minutes 要是整数")
            source = "说的"
        elif (minutes := remembered(memory_key(title))) is not None:
            source = "上次"
        else:
            minutes, source = DEFAULT_MIN[effort], "估的"
    if not 5 <= minutes <= 480:
        raise ValueError("时长要在 5–480 分钟")
    if kind == "fixed" and end is None:
        e = to_min(start) + minutes
        if e > 24 * 60 - 1:
            raise ValueError("结束时间过了半夜")
        end = f"{e // 60:02d}:{e % 60:02d}"
    return {"id": new_id("item"), "title": title, "kind": kind, "start": start, "end": end, "minutes": minutes,
            "effort": effort, "estimated": source == "估的", "source": source}


def parse_day(model: ModelPort, sentence: str, remembered: Callable[[str], int | None]
              ) -> tuple[Outcome, list[dict] | None]:
    """一句话 → 事项。crisis：按危机处理；bad：重试一次仍没解析出来（什么都不存）。"""
    messages = [{"role": "system", "content": PROMPT}, {"role": "user", "content": sentence}]
    for _ in range(2):
        try:
            raw = model.complete_json(messages, schema=schema())
        except ModelError:
            break
        if model_output_is_crisis(raw):  # 先查危机，再查格式
            return "crisis", None
        try:
            items = [_clean(x, remembered) for x in json.loads(raw)["items"]]
        except (ValueError, KeyError, TypeError, RecursionError):
            continue
        if items:
            return "ok", items
    return "bad", None
