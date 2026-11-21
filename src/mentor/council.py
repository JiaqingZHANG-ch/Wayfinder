"""智囊团：几个视角各自独立看一个人的情况，再合成一个建议。不依赖界面。

每个视角是一张卡片（cards/*.md），写着一位作者公开著作里的思考工具。视角之间互相看不到对方的意见，
先各自判断、再汇总，免得先开口的把后面的带偏。
"""
import json
import logging
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Literal

from mentor.model import ModelError, ModelPort
from mentor.prompts import context_block
from mentor.safety import is_crisis, model_output_is_crisis
from mentor.store import Council, Opinion, Store
from mentor.tone import banned_hits

_log = logging.getLogger(__name__)

CARDS_DIR: Path = Path(__file__).parent / "cards"
MIN_OPINIONS = 2
MAX_DOMAINS = 3  # 一次会最多几个领域发言；卡片的领域不超过这个数就全部上，不用分诊
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
- 不建议退学、辞职、换专业、换工作这类难回头的决定，也不评判他现在的学校或工作值不值得待；他自己提到时，只建议先放慢、不急着定。
- 说他的自责、拖延、压力时用平常的说法（比如「让你更难开始」），不用「伤害自己」「活不下去」这类字眼。
- 每项不超过 80 字。
- 档案或记录里流露出伤害自己或不想活的意思时，不要分析，在输出里加上 "crisis": true，程序会接手。

只输出一个 json 对象，不要别的文字：
{{"sees": "...", "worry": "...", "advice": "..."}}
- sees：从这个视角看到了什么
- worry：最担心什么
- advice：建议下一步做的一件具体的事
"""

_TRIAGE = """\
你是「成长导师」。智囊团有下面几个领域，每个领域后面列着它的视角。你会拿到一个人的档案和最近的记录，\
请挑出此刻最该发言的 2 到 3 个领域，不是每次都让所有人发言。

{domains}

怎么挑：
- 看他现在实际卡在哪、接下来一周最需要哪种帮助，不看哪个领域听起来更重要。
- 依据档案和记录里的事实，不凭猜测。
- 只挑 2 个或 3 个。
- 档案或记录里流露出伤害自己或不想活的意思时，不要挑，在输出里加上 "crisis": true，程序会接手。

只输出一个 json 对象，不要别的文字：
{{"domains": ["领域名", "领域名"]}}
领域名必须和上面列出的一字不差。
"""

_SYNTH = """\
你是「成长导师」。智囊团的几个视角各自独立看了这个人的情况，他们的意见在下面。请把它们合成一个建议。

要求：
- 只给一个下一步，并且符合：每天只定一件事、从一个习惯开始、只加不禁。
- 视角之间有分歧时，照实写出分歧在哪、各自的理由，不要抹平；没有分歧时 disagreement 写空字符串。
- 具体，对这个人说话用「你」。
- 不承诺结果，不做心理诊断，不给投资、借贷、理财建议。
- 不建议退学、辞职、换专业、换工作这类难回头的决定；有视角往这边说时不采纳，只写成「这件事先放慢」。
- 说他的自责、拖延、压力时用平常的说法，不用「伤害自己」「活不下去」这类字眼。
- conclusion 不超过 200 字，disagreement 不超过 120 字。conclusion 只说那一件事和为什么先做它，两三句话。
- 上面这些要求是给你的，照着做就行，不要把「不承诺结果」「只加不禁」这类话写给他看。
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


def pick_cards(cards: list[Card], model: ModelPort, case: str) -> list[Card]:
    """分诊：领域多于 MAX_DOMAINS 个时，让模型挑此刻最相关的 2–3 个领域，只请这些领域的视角发言。"""
    domains = list(dict.fromkeys(card.domain for card in cards))
    if len(domains) <= MAX_DOMAINS:
        return cards
    listing = "\n".join(f"- {d}：{'、'.join(c.title for c in cards if c.domain == d)}" for d in domains)

    def fields(obj) -> tuple[str, ...] | None:
        names = obj.get("domains") if isinstance(obj, dict) else None
        valid = (isinstance(names, list) and 2 <= len(names) <= MAX_DOMAINS
                 and all(isinstance(n, str) and n in domains for n in names) and len(set(names)) == len(names))
        return tuple(names) if valid else None

    picked = _ask(model, [{"role": "system", "content": _TRIAGE.format(domains=listing)},
                          {"role": "user", "content": case}], fields, "分诊", think=False)
    # 挑不出来（连不上、两次都不合约定）就用排在最前的两个领域，会照开
    picked = picked or domains[:2]
    return [card for card in cards if card.domain in picked]


def _ok(value, limit: int, *, allow_empty: bool = False) -> bool:
    return isinstance(value, str) and len(value) <= limit and (allow_empty or bool(value.strip()))


class _CrisisFlag(Exception):
    """模型标了 crisis，或它的输出里任何地方出现了危机字眼：整场作废，交给程序的固定话术。"""


def _lens_fields(obj) -> tuple[str, ...] | None:
    if isinstance(obj, dict) and all(_ok(obj.get(k), 300) for k in ("sees", "worry", "advice")):
        return obj["sees"], obj["worry"], obj["advice"]
    return None


def _synth_fields(obj) -> tuple[str, ...] | None:
    if (isinstance(obj, dict) and _ok(obj.get("conclusion"), 600)
            and _ok(obj.get("disagreement"), 400, allow_empty=True)):
        return obj["conclusion"], obj["disagreement"]
    return None


def _ask(model: ModelPort, messages: list[dict[str, str]], fields: Callable, who: str, *, think: bool):
    """模型的输出是不可信的输入：不合约定最多再试一次；连不上就直接放弃。"""
    for attempt in range(1, _TRIES + 1):
        try:
            raw = model.complete_json(messages, think=think)
        except ModelError as e:
            _log.warning("智囊团：%s 调用失败（%s），放弃这一个", who, e)  # ModelError 的文字里不带密钥
            return None
        if model_output_is_crisis(raw):  # 先看危机，再看格式：不能把它当成「不合约定」丢掉然后照开
            raise _CrisisFlag
        try:
            parsed = fields(json.loads(raw))
        except (ValueError, RecursionError):
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
    if len(cards) < MIN_OPINIONS:
        return None
    case = context_block(store, today, with_council=False)  # 不带上一次的结论，免得被它带着走
    if is_crisis(case):
        return None  # 档案或记录里有伤害自己的话：这类内容只能由固定的求助信息回应，不交给视角去分析
    try:
        chosen = pick_cards(cards, model, case)
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


def _opinions(model: ModelPort, chosen: list[Card], case: str, ask: Callable = _opinion) -> list:
    """并行问每个视角；到时限还没答完的、出了意外的，各自丢掉，不拖累其他视角。"""
    pool = ThreadPoolExecutor(max_workers=len(chosen))
    futures = [pool.submit(ask, model, card, case) for card in chosen]
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


# 深度长谈第 4 次：几个视角看他自己写的三个五年版本（设计 2026-11-21-deep-talk 5.4、10.7）
EMOTION_WORDS = ("压力", "焦虑", "情绪", "难受", "崩溃", "低落", "失眠")
_EMOTION_DOMAIN = "情绪与焦虑"
_VERSION_NAMES = ("照现在的路走下去", "现在这条路走不通了", "不考虑钱和别人怎么看")

_VERSIONS_LENS = """\
你是「成长导师」智囊团里的一个视角。下面是这个视角的卡片。你只用卡片里的思考工具看这个人，\
不借用别的理论，也不冒充卡片里那位作者本人说话。

{card}

这个人自己写了五年后的三个版本：照现在的路走下去；现在这条路走不通了；不考虑钱和别人怎么看。\
你会拿到他的档案和这三个版本。请独立看每一个版本：你看不到其他视角的意见，也不用猜他们会说什么。

要求：
- 每个版本写三句：sees 从这个视角看到了什么；unknown 这个版本最大的未知是什么；test 一个月内能做的最便宜的试验。
- 每句不超过 60 字。具体，引用他写的原话，对他说话用「你」。
- 只用他写的三个版本和上面给的情况，不编他没说过的经历、年数、数字。
- 用『你』称呼他，不要写『用户』。
- 引号里只能放他原话里有的字；不是原话就不要加引号。
- 不排名，不说该选哪个版本，不替他做决定。
- 不承诺结果，不做心理诊断，不给投资、借贷、理财建议。
- 不建议退学、辞职、换专业、换工作这类难回头的决定；试验是一个月内能做完、随时能停的小事。
- 说他的自责、拖延、压力时用平常的说法，不用「伤害自己」「活不下去」这类字眼。
- 档案或三个版本里流露出伤害自己或不想活的意思时，不要分析，在输出里加上 "crisis": true，程序会接手。

只输出一个 json 对象，不要别的文字；versions 按上面三个版本的顺序，正好三项：
{{"versions": [{{"sees": "...", "unknown": "...", "test": "..."}}, {{"sees": "...", "unknown": "...", "test": "..."}}, \
{{"sees": "...", "unknown": "...", "test": "..."}}]}}
"""

_VERSIONS_SYNTH = """\
你是「成长导师」。智囊团的几个视角各自独立看了这个人写的三个五年版本，他们的意见在下面。请只写出视角之间的分歧。

要求：
- 分歧照实写：哪几个视角在哪一点上看法不同、各自的理由，不要抹平；没有分歧时 disagreement 写空字符串。
- 不给结论，不排名，不说该选哪个版本：选哪个由他自己定。
- 不超过 200 字，对这个人说话用「你」。
- 不承诺结果，不做心理诊断，不给投资、借贷、理财建议；不建议退学、辞职、换专业、换工作。
- 上面这些要求是给你的，照着做就行，不要把它们写给他看。
- 档案、三个版本或各视角的意见里流露出伤害自己或不想活的意思时，不要合成，在输出里加上 "crisis": true，程序会接手。

只输出一个 json 对象，不要别的文字：
{"disagreement": "..."}
"""


_QUOTED = re.compile("「([^」]*)」|'([^']*)'|\"([^\"]*)\"|‘([^’]*)’|“([^”]*)”")


def _unquote_fakes(text: str, source: str) -> str:
    """引号在这个产品里是「他自己的原话」：不在他写的版本或给的情况里出现过的引号段，只去掉引号、留下字。"""
    def fix(m: re.Match) -> str:
        inner = next(g for g in m.groups() if g is not None)
        return m.group(0) if inner in source else inner
    return _QUOTED.sub(fix, text)


def _versions_fields(obj, source: str = "") -> tuple[list[dict]] | None:
    # 提示里说 60 字，这里放宽到 120（同 _lens_fields 的做法），免得多几个字就丢掉一个视角
    vs = obj.get("versions") if isinstance(obj, dict) else None
    keys = ("sees", "unknown", "test")
    if isinstance(vs, list) and len(vs) == 3 and all(
            isinstance(v, dict) and all(isinstance(v.get(k), str) and "用户" not in v[k] for k in keys) for v in vs):
        fixed = [{k: _unquote_fakes(v[k], source) for k in keys} for v in vs]
        if all(_ok(v[k], 120) and not banned_hits(v[k]) for v in fixed for k in keys):
            return (fixed,)
    return None


def _versions_lens(model: ModelPort, card: Card, case: str, source: str = "") -> dict | None:
    got = _ask(model, [{"role": "system", "content": _VERSIONS_LENS.format(card=card.text)},
                       {"role": "user", "content": case}], lambda o: _versions_fields(o, source), card.title, think=True)
    return None if got is None else {"title": card.title, "versions": got[0]}


def _disagreement_fields(obj, source: str = "") -> tuple[str] | None:
    if isinstance(obj, dict) and isinstance(obj.get("disagreement"), str):
        text = _unquote_fakes(obj["disagreement"], source)
        if _ok(text, 400, allow_empty=True) and not banned_hits(text):
            return (text,)
    return None


def run_versions_council(model: ModelPort, cards: list[Card], versions: list[str],
                         context: str) -> tuple[Literal["ok", "crisis", "failed"], dict | None]:
    """看三个版本：每个视角对每个版本给 sees / unknown / test；合成只写分歧，不给结论、不排名。不存任何东西。"""
    if not any(w in v for v in versions for w in EMOTION_WORDS):  # 他自己没提情绪、压力，就不请这个领域
        cards = [c for c in cards if c.domain != _EMOTION_DOMAIN]
    case = f"{context}\n\n【他写的三个版本】\n" + "\n".join(
        f"版本 {i}（{name}）：{v}" for i, (name, v) in enumerate(zip(_VERSION_NAMES, versions), 1))
    if is_crisis(case):
        return "crisis", None
    if len(cards) < MIN_OPINIONS:
        return "failed", None
    try:
        source = context + "\n" + "\n".join(versions)
        lenses = _opinions(model, pick_cards(cards, model, case), case,
                           lambda m, c, k: _versions_lens(m, c, k, source))
        if len(lenses) < MIN_OPINIONS:
            return "failed", None
        said = "\n\n".join(f"{x['title']}\n" + "\n".join(
            f"版本 {i}：看到 {v['sees']}；未知 {v['unknown']}；试验 {v['test']}" for i, v in enumerate(x["versions"], 1))
            for x in lenses)
        got = _ask(model, [{"role": "system", "content": _VERSIONS_SYNTH},
                           {"role": "user", "content": f"{case}\n\n【各视角的意见】\n{said}"}],
                   lambda o: _disagreement_fields(o, source), "合成", think=False)
    except _CrisisFlag:
        return "crisis", None
    # 合成没出来不算失败：各视角的点评已经够看，分歧留空
    return "ok", {"lenses": lenses, "disagreement": got[0] if got else ""}


# 季度回顾的「××视角」：每个视角看他这一季整份回顾，回 sees / unknown / test 三句
_QUARTER_LENS = """\
你是「成长导师」智囊团里的一个视角。下面是这个视角的卡片。你只用卡片里的思考工具看这个人，\
不借用别的理论，也不冒充卡片里那位作者本人说话。

{card}

这个人刚做完一次季度回顾：各项打分、接下来 90 天的重点、开始做/停下/继续、目标。\
你会拿到他的档案和这份回顾。请独立看：你看不到其他视角的意见，也不用猜他们会说什么。

要求：
- 写三句：sees 从这个视角看到了什么；unknown 这一季最大的未知是什么；test 一个月内能做的最便宜的试验。
- 每句不超过 60 字。具体，引用他写的原话，对他说话用「你」。
- 只用他写的回顾和上面给的情况，不编他没说过的经历、年数、数字。
- 用『你』称呼他，不要写『用户』。
- 引号里只能放他原话里有的字；不是原话就不要加引号。
- 不排名，不替他做决定，不评价他的重点选得对不对。
- 不承诺结果，不做心理诊断，不给投资、借贷、理财建议。
- 不建议退学、辞职、换专业、换工作这类难回头的决定；试验是一个月内能做完、随时能停的小事。
- 说他的自责、拖延、压力时用平常的说法，不用「伤害自己」「活不下去」这类字眼。
- 档案或回顾里流露出伤害自己或不想活的意思时，不要分析，在输出里加上 "crisis": true，程序会接手。

只输出一个 json 对象，不要别的文字：
{{"sees": "...", "unknown": "...", "test": "..."}}
"""

_QUARTER_SYNTH = """\
你是「成长导师」。智囊团的几个视角各自独立看了这个人这一季的回顾，他们的意见在下面。请只写出视角之间的分歧。

要求：
- 分歧照实写：哪几个视角在哪一点上看法不同、各自的理由，不要抹平；没有分歧时 disagreement 写空字符串。
- 不给结论，不排名，不替他做决定。
- 不超过 200 字，对这个人说话用「你」。
- 不承诺结果，不做心理诊断，不给投资、借贷、理财建议；不建议退学、辞职、换专业、换工作。
- 上面这些要求是给你的，照着做就行，不要把它们写给他看。
- 档案、回顾或各视角的意见里流露出伤害自己或不想活的意思时，不要合成，在输出里加上 "crisis": true，程序会接手。

只输出一个 json 对象，不要别的文字：
{"disagreement": "..."}
"""


def _quarter_fields(obj, source: str = "") -> tuple[dict] | None:
    keys = ("sees", "unknown", "test")
    if isinstance(obj, dict) and all(isinstance(obj.get(k), str) and "用户" not in obj[k] for k in keys):
        fixed = {k: _unquote_fakes(obj[k], source) for k in keys}
        if all(_ok(fixed[k], 120) and not banned_hits(fixed[k]) for k in keys):  # 同 _versions_fields：提示 60 字，这里放宽到 120
            return (fixed,)
    return None


def _quarter_lens(model: ModelPort, card: Card, case: str, source: str = "") -> dict | None:
    got = _ask(model, [{"role": "system", "content": _QUARTER_LENS.format(card=card.text)},
                       {"role": "user", "content": case}], lambda o: _quarter_fields(o, source), card.title, think=True)
    return None if got is None else {"title": card.title, **got[0]}


def run_quarter_council(model: ModelPort, cards: list[Card], record: str,
                        context: str) -> tuple[Literal["ok", "crisis", "failed"], dict | None]:
    """看一份季度回顾：每个视角三句，合成只写分歧，不给结论、不排名。不存任何东西。"""
    if not any(w in record for w in EMOTION_WORDS):  # 他自己没提情绪、压力，就不请这个领域
        cards = [c for c in cards if c.domain != _EMOTION_DOMAIN]
    case = f"{context}\n\n【他这一季的回顾】\n{record}"
    if is_crisis(case):
        return "crisis", None
    if len(cards) < MIN_OPINIONS:
        return "failed", None
    try:
        source = context + "\n" + record
        lenses = _opinions(model, pick_cards(cards, model, case), case,
                           lambda m, c, k: _quarter_lens(m, c, k, source))
        if len(lenses) < MIN_OPINIONS:
            return "failed", None
        said = "\n\n".join(f"{x['title']}\n看到 {x['sees']}；未知 {x['unknown']}；试验 {x['test']}" for x in lenses)
        got = _ask(model, [{"role": "system", "content": _QUARTER_SYNTH},
                           {"role": "user", "content": f"{case}\n\n【各视角的意见】\n{said}"}],
                   lambda o: _disagreement_fields(o, source), "合成", think=False)
    except _CrisisFlag:
        return "crisis", None
    return "ok", {"lenses": lenses, "disagreement": got[0] if got else ""}
