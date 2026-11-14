"""智囊团：几个视角各自独立看一个人的情况，再合成一个建议。不依赖界面。

每个视角是一张卡片（cards/*.md），写着一位作者公开著作里的思考工具。视角之间互相看不到对方的意见，
先各自判断、再汇总，免得先开口的把后面的带偏。
"""
import json
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from mentor.model import ModelError, ModelPort
from mentor.prompts import context_block
from mentor.store import Council, Opinion, Store

CARDS_DIR: Path = Path(__file__).parent / "cards"
MIN_OPINIONS = 2
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


def _lens_fields(obj) -> tuple[str, str, str] | None:
    if isinstance(obj, dict) and all(_ok(obj.get(k), 300) for k in ("sees", "worry", "advice")):
        return obj["sees"], obj["worry"], obj["advice"]
    return None


def _synth_fields(obj) -> tuple[str, str] | None:
    if (isinstance(obj, dict) and _ok(obj.get("conclusion"), 600)
            and _ok(obj.get("disagreement"), 400, allow_empty=True)):
        return obj["conclusion"], obj["disagreement"]
    return None


def _ask(model: ModelPort, messages: list[dict[str, str]], fields: Callable):
    """模型的输出是不可信的输入：不合约定最多再试一次；连不上就直接放弃。"""
    for _ in range(_TRIES):
        try:
            raw = model.complete_json(messages, think=True)
        except ModelError:
            return None
        try:
            parsed = fields(json.loads(raw))
        except (ValueError, TypeError):
            parsed = None
        if parsed is not None:
            return parsed
    return None


def _opinion(model: ModelPort, card: Card, case: str) -> Opinion | None:
    got = _ask(model, [{"role": "system", "content": _LENS.format(card=card.text)},
                       {"role": "user", "content": case}], _lens_fields)
    return None if got is None else Opinion(card.title, *got)


def run_council(store: Store, model: ModelPort, cards: list[Card], today: date, trigger: str) -> Council | None:
    """开一次会。开不成（暂停中、视角不够、模型出错）返回 None，导师照常工作。"""
    if trigger not in TRIGGERS:
        raise ValueError(f"未知的触发时刻：{trigger}")
    if store.is_paused(today):
        return None
    existing = store.council_on(today, trigger)
    if existing is not None:
        return existing  # 同一天同一时刻只开一次：刷新页面、连点按钮都不重复花钱
    chosen = pick_cards(cards)
    if len(chosen) < MIN_OPINIONS:
        return None
    case = context_block(store, today, with_council=False)  # 不带上一次的结论，免得被它带着走
    with ThreadPoolExecutor(max_workers=len(chosen)) as pool:
        opinions = [o for o in pool.map(lambda c: _opinion(model, c, case), chosen) if o is not None]
    if len(opinions) < MIN_OPINIONS:
        return None
    said = "\n\n".join(f"{o.title}\n看到：{o.sees}\n担心：{o.worry}\n建议：{o.advice}" for o in opinions)
    got = _ask(model, [{"role": "system", "content": _SYNTH},
                       {"role": "user", "content": f"{case}\n\n【各视角的意见】\n{said}"}], _synth_fields)
    if got is None:
        return None
    council = Council(today, trigger, got[0], got[1], tuple(opinions))
    store.save_council(council)
    return council
