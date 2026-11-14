"""导师核心：判断这次该聊什么，处理一轮对话，校验并保存模型给的结果。不依赖界面。"""
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from mentor.model import ModelError, ModelPort
from mentor.prompts import MODES, build_messages, history
from mentor.safety import CRISIS_MESSAGE, is_crisis
from mentor.store import Daily, Habit, Message, Store, Weekly

MAX_INPUT = 4000
MSG_UNCLEAR = "我没记清，再说一次好吗？"
MSG_OFFLINE = "我现在连不上模型服务，你刚才说的已经存下了，稍后再试。"
MSG_TOO_LONG = "这段话太长了，我一次只能读 4000 字以内，分几次说好吗？"

_OBSERVATION_HEAD = "## 近期观察"


@dataclass(frozen=True)
class TurnResult:
    reply: str
    mode: str
    saved: str | None = None  # "profile" | "daily" | "weekly"
    crisis: bool = False
    error: bool = False


@dataclass(frozen=True)
class _Parsed:
    reply: str
    crisis: bool
    result: dict | None  # 只有 done 且校验通过时才有


DAY_STARTS_AT = 4  # 凌晨 4 点前算前一天：半夜十二点后对账，记的还是「今天」


def logical_date(now: datetime) -> date:
    return (now - timedelta(hours=DAY_STARTS_AT)).date()


def current_mode(store: Store, today: date) -> str:
    if store.get_profile() is None:
        return "intake"
    return "free" if store.daily_between(today, today) else "daily"


def weekly_due(store: Store, today: date) -> bool:
    weekly = store.all_weekly()
    since = weekly[0].day if weekly else store.profile_date()
    return since is not None and (today - since).days >= 7


def _text(value, limit: int = 2000, *, allow_empty: bool = False) -> bool:
    return isinstance(value, str) and len(value) <= limit and (allow_empty or bool(value.strip()))


def _minutes(value, lowest: int = 0) -> bool:
    return type(value) is int and lowest <= value <= 1440  # type() 把 True/False 挡在外面


def _valid_result(mode: str, r) -> bool:
    if not isinstance(r, dict):
        return False
    if mode == "intake":
        return (_text(r.get("profile"), 6000) and _text(r.get("habit")) and _minutes(r.get("daily_minutes"), 1)
                and _text(r.get("first_task")))
    if mode == "daily":
        yesterday = r.get("yesterday_done")
        return (_minutes(r.get("minutes")) and _text(r.get("did")) and _text(r.get("blocker"), allow_empty=True)
                and _text(r.get("tomorrow_task")) and (yesterday is None or type(yesterday) is bool))
    return (_text(r.get("pattern")) and _text(r.get("adjustment")) and _text(r.get("habit"))
            and _minutes(r.get("daily_minutes"), 1) and _text(r.get("observation")))


def _parse(raw: str, mode: str, *, must_finish: bool = False) -> _Parsed | None:
    """模型的输出是不可信的输入：不合约定就返回 None，由调用方重试或放弃。"""
    try:
        obj = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    flag = obj.get("crisis")
    if flag is not None and flag is not False:  # 先看危机标记：写成 "true"、1，或回话为空，都按危机处理
        return _Parsed("", True, None)
    done = obj.get("done")
    if not _text(obj.get("reply")) or (done is not None and type(done) is not bool):
        return None
    if mode == "free":
        return _Parsed(obj["reply"], False, None)
    if not done:
        return None if must_finish else _Parsed(obj["reply"], False, None)  # 点了「结束并生成」就必须给结果
    if not _valid_result(mode, obj.get("result")):
        return None
    return _Parsed(obj["reply"], False, obj["result"])


def _add_observation(profile: str, today: date, text: str) -> str:
    line = f"- {today.isoformat()}：{text}"
    if _OBSERVATION_HEAD not in profile:
        return f"{profile.rstrip()}\n\n{_OBSERVATION_HEAD}\n{line}"
    before, after = profile.split(_OBSERVATION_HEAD, 1)
    cut = after.find("\n## ")
    body, rest = (after, "") if cut == -1 else (after[:cut], after[cut:])
    body = body.replace("（暂无）", "").strip()
    return before + _OBSERVATION_HEAD + "\n" + (body + "\n" if body else "") + line + ("\n" + rest if rest else "")


def _save(store: Store, mode: str, today: date, r: dict) -> str:
    if mode == "intake":
        store.set_profile(r["profile"], today)
        store.set_habit(Habit(r["habit"], r["daily_minutes"]))
        # 建档当天记一条 0 分钟的记录，带着明天的第一件事；这样当天不再对账，第二天有事可问
        store.save_daily(Daily(today, 0, "完成建档", "", r["first_task"]))
        return "profile"
    if mode == "daily":
        previous = store.last_daily_before(today)
        if previous is not None and r.get("yesterday_done") is not None:
            store.set_done(previous.day, r["yesterday_done"])
        store.save_daily(Daily(today, r["minutes"], r["did"], r["blocker"], r["tomorrow_task"]))
        return "daily"
    store.save_weekly(Weekly(today, r["pattern"], r["adjustment"]))
    store.set_habit(Habit(r["habit"], r["daily_minutes"]))
    store.set_profile(_add_observation(store.get_profile() or "", today, r["observation"]), today)
    return "weekly"


def _crisis(store: Store, mode: str, today: date, text: str) -> TurnResult:
    store.log_crisis(today, text)
    store.add_message(Message(today, mode, "assistant", CRISIS_MESSAGE))
    return TurnResult(CRISIS_MESSAGE, mode, crisis=True)


def handle_turn(store: Store, model: ModelPort, mode: str, text: str | None, today: date,
                *, force_finish: bool = False) -> TurnResult:
    """text=None 表示用户没说话：对话刚开始请导师先开口，或用户点了「结束并生成」。"""
    if mode not in MODES:
        raise ValueError(f"未知的模式：{mode}")
    if text is not None:
        if not text.strip():
            return TurnResult("", mode)
        if len(text) > MAX_INPUT:
            return TurnResult(MSG_TOO_LONG, mode, error=True)
    if store.is_paused(today):
        return TurnResult(CRISIS_MESSAGE, mode, crisis=True)
    if text is None and not force_finish:
        shown = history(store, mode, today)
        if shown and shown[-1].role == "assistant":
            return TurnResult("", mode)  # 上一句已经有回应了（比如另一个页面刚拿到），不再多回一条
    if text is not None:
        store.add_message(Message(today, mode, "user", text))  # 先存再调模型：断网也不丢用户打的字
        if is_crisis(text):
            return _crisis(store, mode, today, text)
    messages = build_messages(store, mode, today, force_finish=force_finish)
    parsed = None
    for _ in range(2):
        try:
            raw = model.complete_json(messages)
        except ModelError:
            return TurnResult(MSG_OFFLINE, mode, error=True)
        parsed = _parse(raw, mode, must_finish=force_finish)
        if parsed is not None:
            break
    if parsed is None:
        return TurnResult(MSG_UNCLEAR, mode, error=True)
    if parsed.crisis:
        return _crisis(store, mode, today, text or "")
    store.add_message(Message(today, mode, "assistant", parsed.reply))
    saved = _save(store, mode, today, parsed.result) if parsed.result is not None else None
    return TurnResult(parsed.reply, mode, saved=saved)
