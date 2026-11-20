"""晚间对账（合并版设计 六、七）：按钮结果和一句话解析共用一个格式，存进 day_logs 之前都要过这里的校验。"""
import json
from datetime import date
from typing import Literal, NamedTuple

from .model import ModelError, ModelPort
from .safety import model_output_is_crisis
from .tone import quote_is_verbatim

STATUSES = ("done", "floor", "skip")  # 做了／做了保底／今天没做
VS_PLAN = ("less", "same", "more")  # 项目块：比预想少／差不多／多
TEXT_FIELDS = ("blocker", "note", "tomorrow_task")


class Item(NamedTuple):
    title: str
    project: bool = False


def validate_checkin(obj: object, day: date, items: dict[str, Item]) -> dict:
    """检查对账结果，返回只含约定字段的干净副本；不合格就抛 ValueError（消息给用户看）。"""
    if not isinstance(obj, dict):
        raise ValueError("对账结果要是一个对象")
    if obj.get("date", day.isoformat()) != day.isoformat():
        raise ValueError(f"只能记今天（{day.isoformat()}）的账")
    energy = obj.get("energy_after_class")
    if energy is not None and (type(energy) is not int or not 1 <= energy <= 5):
        raise ValueError("电量只能是 1–5 的整数")
    raw_items = obj.get("items", {})
    if not isinstance(raw_items, dict):
        raise ValueError("items 要是一个对象")
    clean_items = {}
    for item_id, v in raw_items.items():
        if item_id not in items:
            raise ValueError(f"今天的计划里没有「{item_id}」")
        if not isinstance(v, dict) or v.get("status") not in STATUSES:
            raise ValueError(f"「{items[item_id].title}」的状态只能是 {'/'.join(STATUSES)}")
        entry = {"status": v["status"]}
        if v.get("vs_plan") is not None:
            if not items[item_id].project or v["vs_plan"] not in VS_PLAN:
                raise ValueError(f"「{items[item_id].title}」的 vs_plan 只有项目能填，只能是 {'/'.join(VS_PLAN)}")
            entry["vs_plan"] = v["vs_plan"]
        clean_items[item_id] = entry
    out = {"date": day.isoformat(), "energy_after_class": energy, "items": clean_items}
    for name in TEXT_FIELDS:
        value = obj.get(name) or ""
        if not isinstance(value, str):
            raise ValueError(f"{name} 要是文字")
        out[name] = value.strip()
    done = obj.get("yesterday_done")
    if done is not None and not isinstance(done, bool):
        raise ValueError("yesterday_done 只能是 true、false 或不填")
    out["yesterday_done"] = done
    return out


def schema_for(items: dict[str, Item]) -> dict:
    """给 Ollama 的 JSON Schema：只允许今天计划里的事项。"""
    def entry(it: Item) -> dict:
        props = {"status": {"enum": list(STATUSES)}}
        if it.project:
            props["vs_plan"] = {"enum": list(VS_PLAN)}
        return {"type": "object", "properties": props, "required": ["status"]}

    return {"type": "object", "required": ["items", "note"], "properties": {
        "energy_after_class": {"type": ["integer", "null"], "minimum": 1, "maximum": 5},
        "items": {"type": "object", "properties": {k: entry(v) for k, v in items.items()},
                  "additionalProperties": False},
        "blocker": {"type": "string"}, "note": {"type": "string"}, "tomorrow_task": {"type": "string"},
        "yesterday_done": {"type": ["boolean", "null"]},
        "crisis": {"type": "boolean"}}}


def _prompt(items: dict[str, Item]) -> str:
    listed = "、".join(f"{k}（{v.title}{'，项目' if v.project else ''}）" for k, v in items.items())
    return (
        "你把用户晚上说的一句话整理成对账记录，只回 JSON。\n"
        f"今天计划里的事项：{listed}。items 的键只能用这些 id，用户没提到的事项不要写。\n"
        "status：done = 做了，floor = 做了保底（做了一点、少做了），skip = 今天没做。\n"
        "项目可以加 vs_plan：less = 比预想少，same = 差不多，more = 比预想多；没说就不写。\n"
        "energy_after_class：用户说的电量（1–5），没说就 null。\n"
        "note：从用户的话里原样摘一句他对今天的感受，一个字都不改；没有就写空字符串。\n"
        "blocker：卡在哪，没说就空字符串。tomorrow_task：明天要做的一件事，没说就空字符串。\n"
        "yesterday_done：用户说昨天那件事做到没有，没说就 null。\n"
        "如果用户的话里有想伤害自己的意思，只回 {\"crisis\": true}。"
    )


Outcome = Literal["ok", "crisis", "bad"]


def parse_sentence(model: ModelPort, sentence: str, day: date,
                   items: dict[str, Item]) -> tuple[Outcome, dict | None]:
    """一句话 → 对账结果。crisis：按危机处理；bad：没解析出来，让用户点按钮补（什么都不存）。"""
    messages = [{"role": "system", "content": _prompt(items)}, {"role": "user", "content": sentence}]
    try:
        raw = model.complete_json(messages, schema=schema_for(items))
    except ModelError:
        return "bad", None
    if model_output_is_crisis(raw):  # 先查危机，再查格式
        return "crisis", None
    try:
        result = validate_checkin({**json.loads(raw), "date": day.isoformat()}, day, items)
    except (ValueError, TypeError, RecursionError):  # TypeError：模型回的不是对象
        return "bad", None
    if not quote_is_verbatim(result["note"], sentence):
        result["note"] = ""  # 模型改了字就不当原话用
    return "ok", result


def closing_line(note: str) -> str:
    """对账结尾：只原样引用用户今晚的一句话；没写就是「今天记下了」。不给建议，不和昨天比。"""
    return f"「{note}」" if note else "今天记下了"
