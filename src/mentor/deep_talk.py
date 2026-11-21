"""深度长谈的纯逻辑（设计 2026-11-21-deep-talk）：屏幕定义、邀请规则、导师回应、每步的提议、投入建议。

不碰数据库和网络：API 层传进来行和回答，这里只算。问题由程序定，模型只回应一句或提议一小段，且只回 JSON。
"""
import json
import re
from datetime import date
from typing import Literal

from .model import ModelError, ModelPort
from .review import MAX_HABITS
from .safety import model_output_is_crisis
from .tone import RULES, banned_hits

FALLBACK = "这句话我记下了。"
MAX_DIRECTION = 40

STEPS: dict[int, dict] = {
    1: {"name": "现状", "screens": [
        {"id": "scores", "kind": "scores", "items": ["健康", "学习或工作", "玩", "关系"], "options": ["关系"]},
        {"id": "lift", "kind": "open", "question": "这几项里，你最想让哪一项往上走一点？为什么是它？"},
        {"id": "more_time", "kind": "open", "question": "最近最想多花点时间在哪一件事上？"},
    ]},
    2: {"name": "方向", "screens": [
        {"id": "why", "kind": "open", "question": "你现在学的、做的，最终是为了换来什么？说一件具体的事。"},
        {"id": "worth", "kind": "open", "question": "五年后回头看，这几年怎样过算没白过？"},
    ]},
    3: {"name": "能量", "screens": [
        {"id": "flow", "kind": "open", "question": "最近一次做事做到忘了时间，是在做什么？"},
        {"id": "follow", "kind": "follow", "options": ["在哪", "和谁", "用什么"]},
        {"id": "energy", "kind": "energy"},
    ]},
    4: {"name": "三个版本", "screens": [
        {"id": "v1", "kind": "version", "question": "照现在的路走下去", "hint": "五年后的你在做什么、住在哪、每天怎么过？"},
        {"id": "v2", "kind": "version", "question": "现在这条路走不通了", "hint": "你会换哪条路？那条路上的一天是什么样？"},
        {"id": "v3", "kind": "version", "question": "不考虑钱和别人怎么看", "hint": "你会过什么样的日子？"},
        {"id": "council", "kind": "council"},
        {"id": "rate", "kind": "rate", "items": ["资源", "喜欢", "信心", "和自己一致"]},
        {"id": "floor", "kind": "line", "question": "不管选哪条，到什么情况你会停下来换一条？", "hint": "可以跳过"},
        {"id": "choose", "kind": "choose"},
    ]},
}

INVEST: list[dict] = [
    {"key": "read", "title": "看书", "minutes": 30, "floor_min": 10, "when": "睡前"},
    {"key": "move", "title": "运动", "minutes": 30, "floor_min": 10, "when": "下午或傍晚"},
    {"key": "review", "title": "写一段复盘", "minutes": 10, "floor_min": 5, "when": "对账前"},
    {"key": "sleep", "title": "睡前放下手机", "minutes": 20, "floor_min": 10, "when": "睡前"},
    {"key": "skill", "title": "练技能", "minutes": 30, "floor_min": 10, "when": "精力最好的时段"},
]
_SAME_KIND = {"read": ("看书", "读"), "move": ("运动", "健身", "跑", "走"), "review": ("复盘", "日记"),
              "sleep": ("睡", "手机"), "skill": ("练",)}
_HEALTH_WORDS = ("健康", "身体", "运动", "睡")
_LOVE_WORDS = ("学", "课", "练", "语", "写", "读", "编程")


def next_screen(answers: dict[int, dict], step: int) -> str | None:
    """这一步第一个没答的屏 id；council 屏看 council_seen。"""
    got = answers.get(step, {})
    for s in STEPS[step]["screens"]:
        if not (got.get("council_seen") if s["kind"] == "council" else s["id"] in got):
            return s["id"]
    return None


def should_invite(rows: list[dict], *, checked_in: bool, energy_level: int | None, today: date) -> bool:
    if not checked_in or (energy_level is not None and energy_level <= 2):
        return False
    done = {r["step"] for r in rows if r.get("finished_at")}
    current = next((s for s in (1, 2, 3, 4) if s not in done), None)
    if current is None:
        return False
    row = next((r for r in rows if r["step"] == current), None)
    if row and row["snoozes"] >= 3:
        return False
    day = today.isoformat()
    return not any((r.get(k) or "").startswith(day) for r in rows for k in ("started_at", "finished_at"))


def _system(task: str, shape: str) -> str:
    return (f"你是一个安静的成长导师，正在陪用户做一次深度长谈。\n{RULES}\n\n这一轮：{task}"
            f"只回 JSON：{shape}。如果用户的话里有想伤害自己的意思，只回 {{\"crisis\": true}}。")


def _ask(model: ModelPort, system: str, user: str, parse) -> tuple[Literal["ok", "crisis"], object | None]:
    """调模型最多两次。("crisis", None)；("ok", parse 的结果)；模型出错、格式不对、命中禁用说法两次 → ("ok", None)。"""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for _ in range(2):
        try:
            raw = model.complete_json(messages)
        except ModelError:
            break
        if model_output_is_crisis(raw):  # 先查危机，再查格式
            return "crisis", None
        try:
            return "ok", parse(json.loads(raw))
        except (ValueError, KeyError, TypeError, AttributeError, OverflowError):
            continue
    return "ok", None


def _text(v, limit: int, bad: tuple = ()) -> str:
    """非空字符串且没命中禁用说法（或 bad 里的字），截到 limit；否则 ValueError（让 _ask 重试）。"""
    if not isinstance(v, str) or not v.strip() or banned_hits(v) or any(b in v for b in bad):
        raise ValueError
    return v.strip()[:limit]


def reply(model: ModelPort, question: str, answer: str) -> tuple[Literal["ok", "crisis"], str]:
    system = _system("只用一句话回应他的回答，不提新问题，不给建议。只说一句，不提问，不给建议，用『你』称呼他。", '{"reply": "……"}')
    status, out = _ask(model, system, f"问题「{question}」，他答：{answer}", lambda o: _text(o["reply"], 200, ("？", "?")))
    return ("crisis", "") if status == "crisis" else ("ok", out or FALLBACK)


def _dump(answers: dict, step: int) -> str:
    return "\n".join(f"第 {s} 步（{STEPS[s]['name']}）：{json.dumps(answers[s], ensure_ascii=False)}"
                     for s in sorted(answers) if s <= step) or "（没有回答）"


# 模型常把时长写进名字（「每天写 App 30分钟」），时间线上就成了「… 30分钟 · 30 分钟」
# 单个「分」不算：「考研数学 150 分」是分数
_MINUTES = re.compile(r"[\s，,（(]*(\d+|半|一|两|二|三|五|十|十五|二十|三十|四十|四十五)\s*(分钟|min|小时|个小时)[)）]?\s*$")


def _no_minutes(title: str) -> str:
    return _MINUTES.sub("", title).strip() or title


def propose(model: ModelPort, step: int, answers: dict) -> tuple[Literal["ok", "crisis"], dict]:
    def _you(v, limit):
        return _text(v, limit, ("用户",))

    rule = "用『你』称呼他，不要写『用户』。只用他说过的内容，不加新东西；不建议退学、辞职、换专业、换工作。"
    if step == 1:
        system = _system(f"用一句话（60 字以内）写下你从他的回答里看到的一点现状。{rule}", '{"observation": "……"}')
        parse, fallback = (lambda o: {"observation": _you(o["observation"], 60)}), {"observation": None}
    elif step == 2:
        system = _system(f"用一句话（{MAX_DIRECTION} 字以内）写出他自己说的方向；"
                         f"再判断他说的「为了什么」和「怎样算没白过」是否对不上。{rule}",
                         '{"direction": "……", "mismatch": false}')
        worth = str(answers.get(2, {}).get("worth", ""))[:MAX_DIRECTION]

        def parse(o):
            return {"direction": _you(o["direction"], MAX_DIRECTION), "mismatch": o["mismatch"] is True}
        fallback = {"direction": worth, "mismatch": False}
    elif step == 3:
        system = _system(f"用一句话（40 字以内）写出什么情形下他最有劲。{rule}", '{"formula": "……"}')
        parse, fallback = (lambda o: {"formula": _you(o["formula"], 40)}), {"formula": None}
    else:
        system = _system(
            f"他选了一个版本，据此写：使命一句（{MAX_DIRECTION} 字以内）；目标最多 3 条（每条 30 字以内）；"
            f"一个每天能做的小习惯（名字 20 字以内、名字里不写分钟数、分钟数 5 到 180、保底分钟数）；明天的一件事。{rule}",
            '{"mission": "……", "goals": ["……"], "prototype": {"title": "……", "minutes": 30, "floor_min": 10}, '
            '"tomorrow": "……"}')

        def parse(o):
            if not isinstance(o["goals"], list):
                raise ValueError
            goals = [_you(g, 30) for g in o["goals"][:3]]
            p, proto = o.get("prototype"), None
            if isinstance(p, dict):
                minutes = min(max(int(p["minutes"]), 5), 180)
                proto = {"title": _no_minutes(_you(p["title"], 20)), "minutes": minutes,
                         "floor_min": min(max(int(p["floor_min"]), 1), minutes)}
            tomorrow = o.get("tomorrow")
            return {"mission": _you(o["mission"], MAX_DIRECTION), "goals": goals, "prototype": proto,
                    "tomorrow": _you(tomorrow, 60) if tomorrow else None}
        a4 = answers.get(4, {})
        choose = a4.get("choose")
        picked = a4.get(f"v{choose + 1}", "") if type(choose) is int and 0 <= choose <= 2 else ""
        fallback = {"mission": str(picked).strip()[:MAX_DIRECTION], "goals": [], "prototype": None, "tomorrow": None}
    status, out = _ask(model, system, _dump(answers, step), parse)
    return ("crisis", {}) if status == "crisis" else ("ok", out or fallback)


def invest_suggestions(answers: dict[int, dict], habits: list[dict]) -> list[dict]:
    """最多 2 条「把时间投在哪」的建议；why 由程序写，不让模型编。"""
    if len(habits) >= MAX_HABITS:
        return []
    have = " ".join(h["title"] for h in habits)
    lift = str(answers.get(1, {}).get("lift", ""))
    loved = next((t for t in answers.get(3, {}).get("loved", []) if any(w in t for w in _LOVE_WORDS)), None)
    why: dict[str, str] = {}
    if any(w in lift for w in _HEALTH_WORDS):
        why["move"] = why["sleep"] = f"你说想让「{lift[:12]}」往上走一点"
    if loved:
        why["skill"] = f"你说做「{loved}」的时候最有劲"
    items = [i for i in INVEST if not any(w in have for w in _SAME_KIND[i["key"]])]
    items.sort(key=lambda i: i["key"] not in why)  # 稳定排序：有理由的提到最前，其余保持默认顺序
    return [{**i, "why": why.get(i["key"]) or f"{i['title']}每天{i['floor_min']}分钟起步，花得少、回报长"}
            for i in items[:2]]
