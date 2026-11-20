"""每周复盘（合并版设计 六之三）。

数字全部由这里从 day_logs 算好，模型只把它们写成话、提最多 3 条调整；写出来的数字必须都能在统计里找到，
引号里的话必须是用户某天 note 的原文。不合格就重来一次，再不行用程序自己拼的几句事实。不开「××视角」会议。
"""
import json
import re
from collections import Counter
from typing import Literal
from uuid import uuid4

from .model import ModelError, ModelPort
from .safety import model_output_is_crisis
from .tone import RULES, banned_hits, quote_is_verbatim

MAX_ADJUSTMENTS = 3
MAX_HABITS = 3  # 设置里最多 3 个习惯（server/settings.py 用同一个数）
PATTERN_DAYS = 3  # 同一件事出现 3 天以上才说「值得留意」
ADJUST_KINDS = ("minutes", "floor_min", "add_habit")
MAX_QUESTION = 60
FALLBACK_QUESTION = "下周哪一个晚上最可能被打乱？"


def week_stats(logs: list[dict], habits: list[dict], tasks: list[dict]) -> dict:
    """logs：这 7 天的 day_logs；habits / tasks：求解器输入里的。返回复盘要用的全部数字和事实。"""
    def statuses(item_id):
        return [(log["date"], log["items"][item_id]) for log in logs if item_id in log["items"]]

    habit_rows = []
    for h in habits:
        st = statuses(h["id"])
        habit_rows.append({"id": h["id"], "title": h["title"],
                           "done_days": sum(s["status"] in ("done", "floor") for _, s in st),
                           "floor_days": sum(s["status"] == "floor" for _, s in st),
                           "skip_days": sum(s["status"] == "skip" for _, s in st)})
    project_rows = [{"id": t["id"], "title": t["title"],
                     **{v: sum(s.get("vs_plan") == v for _, s in statuses(t["id"])) for v in ("less", "same", "more")}}
                    for t in tasks]
    done = {log["date"]: sum(i["status"] in ("done", "floor") for i in log["items"].values()) for log in logs}
    best = max(done, key=lambda d: (done[d], d)) if len(done) >= 2 else None
    hardest = min(done, key=lambda d: (done[d], d)) if len(done) >= 2 else None
    patterns = [f"「{h['title']}」有 {h['skip_days']} 天没做" for h in habit_rows if h["skip_days"] >= PATTERN_DAYS]
    patterns += [f"「{p['title']}」有 {p[v]} 天{label}" for p in project_rows
                 for v, label in (("more", "比预想花得多"), ("less", "比预想花得少")) if p[v] >= PATTERN_DAYS]
    blockers = Counter(log["blocker"] for log in logs if log["blocker"])
    patterns += [f"有 {n} 天卡在「{b}」" for b, n in blockers.items() if n >= PATTERN_DAYS]
    return {"days": 7, "logged_days": len(logs), "habits": habit_rows, "projects": project_rows,
            "best_day": best and {"date": best, "done_items": done[best]},
            "hardest_day": hardest and {"date": hardest, "done_items": done[hardest]},
            "patterns": patterns,
            "notes": [{"date": log["date"], "note": log["note"]} for log in logs if log["note"]]}


def allowed_numbers(stats: dict) -> set[str]:
    # shortcut: 只查「这个数字统计里有没有」，查不出把 5 天写成 6 天这种张冠李戴；要更严就让模型按占位符写、程序填数
    """统计里出现过的每个数字（包括日期里的年、月、日，和用户原话里的「十分钟」），复盘正文里的数字只能从这里来。"""
    return numbers_in(json.dumps(stats, ensure_ascii=False))


def build_messages(stats: dict, habits: list[dict]) -> list[dict[str, str]]:
    habit_list = "、".join(f"{h['id']}（{h['title']}，标准 {h['minutes']} 分钟，保底 {h.get('floor_min', h['minutes'])} 分钟）"
                           for h in habits)
    system = (
        "你是一个安静的成长导师，在帮用户看过去 7 天的记录。\n"
        f"{RULES}\n\n"
        "复盘要求：\n"
        "1. summary：3–5 句。数字一律写阿拉伯数字，只能用下面统计里的，不许自己算新数字，不许改。没做的写「没做」或「没有记录」。\n"
        "2. 做得好的、没做到的，尽量引用用户当天的原话：放在「」里，一字不差，后面标日期；没有原话就只写事实。\n"
        "3. 只有 patterns 里列出的才说「值得留意」。\n"
        f"4. adjustments：最多 {MAX_ADJUSTMENTS} 条，可以是 0 条。每条是下面三种之一，why 用一句话说依据：\n"
        '   {"kind": "minutes", "habit_id": "…", "value": 分钟, "why": "…"}  改标准版时长\n'
        '   {"kind": "floor_min", "habit_id": "…", "value": 分钟, "why": "…"}  改保底版时长\n'
        '   {"kind": "add_habit", "title": "…", "value": 分钟, "why": "…"}  加一个新习惯（只在现有习惯稳定时提）\n'
        f"   现有习惯：{habit_list or '（没有）'}\n"
        f"5. question：留一个问题让用户带进下周想，你不回答它。一句，问具体的事，{MAX_QUESTION} 字以内，以「？」结尾。\n"
        '只回 JSON：{"summary": "……", "adjustments": [...], "question": "……？"}。'
        "如果记录里有想伤害自己的意思，只回 {\"crisis\": true}。"
    )
    return [{"role": "system", "content": system},
            {"role": "user", "content": json.dumps(stats, ensure_ascii=False)}]


def _check_adjustments(raw: object, habits: list[dict]) -> list[dict] | None:
    if not isinstance(raw, list) or len(raw) > MAX_ADJUSTMENTS:
        return None
    ids = {h["id"]: h for h in habits}
    out = []
    for a in raw:  # 不合格的那一条丢掉，其余照给（复盘正文不受影响）
        if not isinstance(a, dict) or a.get("kind") not in ADJUST_KINDS:
            continue
        value, why = a.get("value"), a.get("why")
        if type(value) is not int or not 1 <= value <= 180 or not isinstance(why, str) or banned_hits(why):
            continue
        if a["kind"] == "add_habit":
            title = a.get("title")
            added = sum(x["kind"] == "add_habit" for x in out)
            if not isinstance(title, str) or not 0 < len(title.strip()) <= 20 or len(habits) + added >= MAX_HABITS:
                continue
            out.append({"kind": "add_habit", "title": title.strip(), "value": value, "why": why.strip()})
            continue
        h = ids.get(a.get("habit_id"))
        if h is None:
            continue
        floor, minutes = h.get("floor_min", h["minutes"]), h["minutes"]
        if (a["kind"] == "minutes" and value < floor) or (a["kind"] == "floor_min" and value > minutes):
            continue  # 改了以后保底版不能比标准版长
        out.append({"kind": a["kind"], "habit_id": h["id"], "title": h["title"], "value": value, "why": why.strip()})
    return out


_CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
# 中文数字后面跟着单位才算数字（「一起」「一句」不算）
_CN_NUMBER = re.compile(r"([零〇一二两三四五六七八九十]+)(?=\s*(?:天|次|分钟|小时|条|周|个|件|项))")


def _cn_to_int(s: str) -> int:
    """一到九十九：五、十、十五、二十、二十三。"""
    if "十" not in s:
        return int("".join(str(_CN_DIGITS[c]) for c in s))
    tens, _, ones = s.partition("十")
    return (_CN_DIGITS[tens] if tens else 1) * 10 + (_CN_DIGITS[ones] if ones else 0)


def numbers_in(text: str) -> set[str]:
    """正文里的数字，阿拉伯数字和带单位的中文数字（三天、二十分钟）都算。"""
    return set(re.findall(r"\d+", text)) | {str(_cn_to_int(m)) for m in _CN_NUMBER.findall(text)}


def _date_near(text: str, start: int, end: int, day: str) -> bool:
    """引号前后 20 个字以内写了这一天：2026-11-14、11-14 或 11 月 14 日。"""
    window = re.sub(r"\s+", "", text[max(0, start - 20):end + 20])
    _, m, d = day.split("-")
    return any(f in window for f in (day, f"{m}-{d}", f"{int(m)}月{int(d)}日", f"{m}月{d}日"))


def _summary_ok(text: object, stats: dict) -> bool:
    if not isinstance(text, str) or not text.strip() or banned_hits(text):
        return False
    if not numbers_in(text) <= allowed_numbers(stats):
        return False
    if any(x["id"] in text for x in stats["habits"] + stats["projects"]):  # 写成了 english、habit-1 这种内部 id
        return False
    names = {h["title"] for h in stats["habits"]} | {p["title"] for p in stats["projects"]}
    for m in re.finditer(r"「([^」]*)」", text):
        q = m.group(1)
        if q in names or any(quote_is_verbatim(q, p) for p in stats["patterns"]):  # 规律里带着用户写的卡点原话
            continue
        # 用户的原话：要一字不差，而且旁边标的日期得是说这句话的那天
        if not any(quote_is_verbatim(q, n["note"]) and _date_near(text, m.start(), m.end(), n["date"])
                   for n in stats["notes"]):
            return False
    return True


def _question_ok(q: object) -> bool:
    return (isinstance(q, str) and 0 < len(q.strip()) <= MAX_QUESTION and q.strip()[-1] in "？?"
            and not banned_hits(q))


def fallback_summary(stats: dict) -> str:
    """模型写不好时，程序自己拼的几句事实。"""
    if not stats["logged_days"]:
        return "这 7 天没有记录。"
    parts = [f"这 {stats['days']} 天记录了 {stats['logged_days']} 天。"]
    parts += [f"「{h['title']}」做了 {h['done_days']} 天。" for h in stats["habits"]]
    parts += [f"值得留意：{p}。" for p in stats["patterns"]]
    return "".join(parts)


def write_review(model: ModelPort, stats: dict, habits: list[dict]
                 ) -> tuple[Literal["ok", "crisis"], dict | None]:
    """返回 ("ok", {"summary", "adjustments", "question"}) 或 ("crisis", None)。"""
    messages = build_messages(stats, habits)
    for _ in range(2):
        try:
            raw = model.complete_json(messages)
        except ModelError:
            break
        if model_output_is_crisis(raw):
            return "crisis", None
        try:
            obj = json.loads(raw)
            summary, adjustments = obj["summary"], _check_adjustments(obj.get("adjustments", []), habits)
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
        if adjustments is not None and _summary_ok(summary, stats):
            q = obj.get("question")
            return "ok", {"summary": summary.strip(), "adjustments": adjustments,
                          "question": q.strip() if _question_ok(q) else FALLBACK_QUESTION}
    return "ok", {"summary": fallback_summary(stats), "adjustments": [], "question": FALLBACK_QUESTION}


def new_id(prefix: str) -> str:
    """新习惯／项目的 id。随机后缀：删掉的 id 不会再发给新加的，旧记录不会算到别的事头上。"""
    return f"{prefix}-{uuid4().hex[:8]}"


def apply_adjustments(raw: dict, adjustments: list[dict]) -> dict:
    """把用户点了「好」的调整写进求解器输入，返回新的一份（原来的不动）。"""
    raw = json.loads(json.dumps(raw))
    habits = raw.setdefault("habits", [])
    for a in adjustments:
        if a["kind"] == "add_habit":
            habits.append({"id": new_id("habit"), "title": a["title"], "minutes": a["value"], "floor_min": min(10, a["value"]),
                           "window": [raw["wake"], raw["sleep"]]})
            continue
        for h in habits:
            if h["id"] == a["habit_id"]:
                h[a["kind"]] = a["value"]
                h.setdefault("floor_min", h["minutes"])
    return raw
