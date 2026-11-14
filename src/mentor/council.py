"""智囊团：几个视角各自独立看一个人的情况，再合成一个建议。不依赖界面。

每个视角是一张卡片（cards/*.md），写着一位作者公开著作里的思考工具。视角之间互相看不到对方的意见，
先各自判断、再汇总，免得先开口的把后面的带偏。
"""
import json
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from mentor.model import ModelError, ModelPort
from mentor.prompts import context_block
from mentor.safety import is_crisis
from mentor.store import Council, Opinion, Store

_log = logging.getLogger(__name__)

CARDS_DIR: Path = Path(__file__).parent / "cards"
MIN_OPINIONS = 2
LENS_SECONDS = 100  # 等所有视角的总时限；合成另算（非思考模式，通常几秒）
TRIGGERS = ("intake", "weekly")
_TRIES = 2


@dataclass(frozen=True)
class Card:
    slug: str
    title: str  # 对用户显示的视角名，如「逆向思考视角（源自查理·芒格）」
    domain: str
    text: str


_LENS = """\
你是「成长导师」智囊团里的一个视角。下面是这个视角的卡片。你只用卡片里的思考工具看这个人，\
不借用别的理论，也不冒充卡片里那位作者本人说话。

{card}

来找导师的人大多二十出头，迷茫、焦虑、不知道每天该干什么。你会拿到这个人的档案和最近的记录。\
请独立给出你的看法：你看不到其他视角的意见，也不用猜他们会说什么。

要求：
- 具体。引用档案和记录里的事实、日期、数字和他的原话，不讲大道理。
- 对这个人说话，用「你」。
- 不承诺结果，不做心理诊断，不给投资、借贷、理财建议。
- 建议只给一件小到做得到的事，只加不禁：不要求他戒掉什么。
- 每项不超过 80 字。
- 档案或记录里流露出伤害自己或不想活的意思时，不要分析，在输出里加上 "crisis": true，程序会接手。

只输出一个 json 对象，不要别的文字：
{{"sees": "...", "worry": "...", "advice": "..."}}
- sees：从这个视角看到了什么
- worry：最担心什么
- advice：建议下一步做的一件具体的事
"""

_SYNTH = """\
你是「成长导师」。智囊团的几个视角各自独立看了这个人的情况，他们的意见在下面。请把它们合成一个建议。

要求：
- 只给一个下一步，并且符合：每天只定一件事、从一个习惯开始、只加不禁。
- 视角之间有分歧时，照实写出分歧在哪、各自的理由，不要抹平；没有分歧时 disagreement 写空字符串。
- 具体，对这个人说话用「你」。
- 不承诺结果，不做心理诊断，不给投资、借贷、理财建议。
- conclusion 不超过 200 字，disagreement 不超过 120 字。
- 档案、记录或各视角的意见里流露出伤害自己或不想活的意思时，不要合成，在输出里加上 "crisis": true，程序会接手。

只输出一个 json 对象，不要别的文字：
{"conclusion": "...", "disagreement": "..."}
"""


def load_cards(directory: Path) -> list[Card]:
    cards = []
    for path in sorted(directory.glob("*.md")) if directory.is_dir() else []:
        text = path.read_text(encoding="utf-8").strip()
        lines = [line.strip() for line in text.splitlines()]
        title = next((line[2:].strip() for line in lines if line.startswith("# ")), "")
        domain = next((line[3:].strip() for line in lines if line.startswith(("领域：", "领域:"))), "")
        if not title or not domain:
            raise ValueError(f"卡片 {path.name} 缺少「# 标题」或「领域：」这一行")
        cards.append(Card(path.stem, title, domain, text))
    return cards


def pick_cards(cards: list[Card]) -> list[Card]:
    # shortcut: 领域不超过 3 个时全部上；补齐五个领域时在这里加「先挑最相关的 2–3 个领域」的分诊
    return cards


def _ok(value, limit: int, *, allow_empty: bool = False) -> bool:
    return isinstance(value, str) and len(value) <= limit and (allow_empty or bool(value.strip()))


class _CrisisFlag(Exception):
    """模型标了 crisis，或它的话里出现了危机内容：整场作废，交给程序的固定话术。"""


def _checked(obj, fields: tuple[str, ...]) -> tuple[str, ...]:
    flag = obj.get("crisis")
    if (flag is not None and flag is not False) or any(is_crisis(text) for text in fields):
        raise _CrisisFlag
    return fields


def _lens_fields(obj) -> tuple[str, ...] | None:
    if isinstance(obj, dict) and all(_ok(obj.get(k), 300) for k in ("sees", "worry", "advice")):
        return _checked(obj, (obj["sees"], obj["worry"], obj["advice"]))
    return None


def _synth_fields(obj) -> tuple[str, ...] | None:
    if (isinstance(obj, dict) and _ok(obj.get("conclusion"), 600)
            and _ok(obj.get("disagreement"), 400, allow_empty=True)):
        return _checked(obj, (obj["conclusion"], obj["disagreement"]))
    return None


def _ask(model: ModelPort, messages: list[dict[str, str]], fields: Callable, who: str, *, think: bool):
    """模型的输出是不可信的输入：不合约定最多再试一次；连不上就直接放弃。"""
    for attempt in range(1, _TRIES + 1):
        try:
            raw = model.complete_json(messages, think=think)
        except ModelError as e:
            _log.warning("智囊团：%s 调用失败（%s），放弃这一个", who, e)  # ModelError 的文字里不带密钥
            return None
        try:
            parsed = fields(json.loads(raw))
        except (ValueError, TypeError):
            parsed = None
        if parsed is not None:
            return parsed
        _log.warning("智囊团：%s 第 %d 次输出不合约定（长度 %d）", who, attempt, len(raw))  # 不记内容，只记长度
    return None


def _opinion(model: ModelPort, card: Card, case: str) -> Opinion | None:
    got = _ask(model, [{"role": "system", "content": _LENS.format(card=card.text)},
                       {"role": "user", "content": case}], _lens_fields, card.title, think=True)
    return None if got is None else Opinion(card.title, *got)


def run_council(store: Store, model: ModelPort, cards: list[Card], today: date, trigger: str) -> Council | None:
    """开一次会。开不成（暂停中、视角不够、模型出错）返回 None，导师照常工作。"""
    if trigger not in TRIGGERS:
        raise ValueError(f"未知的触发时刻：{trigger}")
    if store.is_paused(today) or store.had_crisis(today):
        return None  # 当天触发过危机处理（点了「继续」也算）就不开会
    existing = store.council_on(today, trigger)
    if existing is not None:
        return existing  # 同一天同一时刻只开一次：刷新页面、连点按钮都不重复花钱
    chosen = pick_cards(cards)
    if len(chosen) < MIN_OPINIONS:
        return None
    case = context_block(store, today, with_council=False)  # 不带上一次的结论，免得被它带着走
    if is_crisis(case):
        return None  # 档案或记录里有伤害自己的话：这类内容只能由固定的求助信息回应，不交给视角去分析
    try:
        opinions = _opinions(model, chosen, case)
        if len(opinions) < MIN_OPINIONS:
            return None
        said = "\n\n".join(f"{o.title}\n看到：{o.sees}\n担心：{o.worry}\n建议：{o.advice}" for o in opinions)
        # 视角用思考模式（实测对日期和数字更准，17–43 秒），合成只是归并，用非思考模式（几秒）
        got = _ask(model, [{"role": "system", "content": _SYNTH},
                           {"role": "user", "content": f"{case}\n\n【各视角的意见】\n{said}"}],
                   _synth_fields, "合成", think=False)
    except _CrisisFlag:
        store.log_crisis(today, "智囊团的输出里出现危机内容")  # 暂停带练，页面随后显示固定的求助信息
        return None
    if got is None:
        return None
    council = Council(today, trigger, got[0], got[1], tuple(opinions))
    store.save_council(council)
    return council


def _opinions(model: ModelPort, chosen: list[Card], case: str) -> list[Opinion]:
    """并行问每个视角；到时限还没答完的、出了意外的，各自丢掉，不拖累其他视角。"""
    pool = ThreadPoolExecutor(max_workers=len(chosen))
    futures = [pool.submit(_opinion, model, card, case) for card in chosen]
    done, _ = wait(futures, timeout=LENS_SECONDS)
    pool.shutdown(wait=False, cancel_futures=True)  # 不等慢的：它在后台答完，结果直接丢弃
    opinions = []
    for card, future in zip(chosen, futures):
        if future not in done:
            _log.warning("智囊团：%s 超过 %s 秒没答完，放弃这一个", card.title, LENS_SECONDS)
            continue
        error = future.exception()
        if isinstance(error, _CrisisFlag):
            raise error
        if error is not None:
            _log.warning("智囊团：%s 出了意外（%s），放弃这一个", card.title, type(error).__name__)
        elif future.result() is not None:
            opinions.append(future.result())
    return opinions
