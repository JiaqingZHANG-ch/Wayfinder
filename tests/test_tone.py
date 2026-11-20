import pytest

from mentor.tone import BANNED, FALLBACK, banned_hits, quote_is_verbatim, speak

# 坏示范：模型可能说出来、但不该给用户看的话。每句都必须被拦下。
BAD = [
    "我非常理解你的感受，今天确实很累。",
    "你已经做得很好了！",
    "作为一个 AI，我没法替你决定。",
    "希望这对你有帮助～",
    "你应该早点睡。",
    "今天又失败了也没关系。",
    "你今天比昨天多读了 10 分钟。",
    "以下是今晚的安排：",
    # 循环 ⑦：家庆在这里加 3 条坏示范。先跑一次看哪条没被拦（变红），再去 tone.py 的 BANNED 里补说法（变绿）。
]

GOOD = [
    "这句话我记下了。",
    "今天英语做了，看书做了保底。",
    "明天的一件事：读第 4 章。",
    "今天记下了。",
    "你说「今天读得很顺」。",
]


@pytest.mark.parametrize("text", BAD)
def test_bad_examples_are_caught(text):
    assert banned_hits(text)


@pytest.mark.parametrize("text", GOOD)
def test_good_examples_pass(text):
    assert banned_hits(text) == []


def test_every_banned_phrase_catches_itself_and_its_replacement_is_clean():
    for phrase, replacement, kind in BANNED:
        assert phrase in banned_hits(phrase)
        assert banned_hits(replacement) == [], f"「{phrase}」的替换说法自己就命中了禁用词"
        assert kind in {"客套腔", "机器人腔", "评判"}
    assert len(BANNED) >= 30
    assert banned_hits(FALLBACK) == []


def test_speak_retries_once_then_falls_back():
    replies = iter(["你真的很棒！", "今天做了英语。"])
    assert speak(lambda: next(replies)) == "今天做了英语。"
    calls = []
    assert speak(lambda: calls.append(1) or "加油哦") == FALLBACK
    assert len(calls) == 2  # 只重来一次


@pytest.mark.parametrize("quote, message, ok", [
    ("今天读得很顺", "英语完成，今天读得很顺。", True),
    ("英语完成，今天读得很顺。", "英语完成，今天读得很顺。", True),
    ("今天读得挺顺", "英语完成，今天读得很顺。", False),   # 改了一个字
    ("英语完成 今天读得很顺", "英语完成，今天读得很顺。", False),  # 标点换了也不算
    ("读得很顺，英语完成", "英语完成，今天读得很顺。", False),    # 拼接、调换顺序
    ("", "英语完成", False),
    ("   ", "英语 完成", False),
])
def test_quote_is_verbatim(quote, message, ok):
    assert quote_is_verbatim(quote, message) is ok
