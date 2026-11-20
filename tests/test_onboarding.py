import json

import pytest

from mentor.model import FakeModel
from mentor.onboarding import QUESTIONS, build_messages, run_round
from mentor.tone import FALLBACK, RULES

CONFIRMED = [{"level": "方向", "content": "把法语练到能面试"}]


def test_messages_hold_only_rules_confirmed_profile_and_this_question():
    msgs = build_messages(QUESTIONS[0], "上周六在图书馆读完一本书", CONFIRMED)
    system, user = msgs[0]["content"], msgs[1]["content"]
    assert len(msgs) == 2
    assert RULES in system and "把法语练到能面试" in system
    assert QUESTIONS[0] in user and "上周六在图书馆读完一本书" in user
    assert "direction" not in system  # 不是最后一轮，不让模型写方向


def test_last_round_carries_earlier_answers_and_asks_for_direction():
    msgs = build_messages(QUESTIONS[1], "法语", [], earlier=[(QUESTIONS[0], "在图书馆读书")])
    assert "（还没有）" in msgs[0]["content"] and "direction" in msgs[0]["content"]
    assert "在图书馆读书" in msgs[1]["content"] and "法语" in msgs[1]["content"]


def test_round_returns_reply():
    fake = FakeModel(['{"reply": "图书馆那天你记得很清楚。"}'])
    assert run_round(fake, QUESTIONS[0], "在图书馆读书", []) == ("ok", {"reply": "图书馆那天你记得很清楚。", "direction": None})


def test_last_round_returns_direction():
    fake = FakeModel([json.dumps({"reply": "记下了。", "direction": "多花时间练法语"})])
    out = run_round(fake, QUESTIONS[1], "法语", [], earlier=[(QUESTIONS[0], "读书")])
    assert out == ("ok", {"reply": "记下了。", "direction": "多花时间练法语"})


def test_banned_phrase_retries_once_then_falls_back():
    fake = FakeModel(['{"reply": "你真的很棒！"}', '{"reply": "图书馆那天记下了。"}'])
    assert run_round(fake, QUESTIONS[0], "读书", [])[1]["reply"] == "图书馆那天记下了。"
    fake = FakeModel(['{"reply": "你真的很棒！"}', '{"reply": "加油哦"}'])
    assert run_round(fake, QUESTIONS[0], "读书", [])[1]["reply"] == FALLBACK


@pytest.mark.parametrize("replies", [[], ["不是 json", "[]"], ['{"reply": "好", "direction": ""}'] * 2])
def test_model_trouble_falls_back_to_users_own_words(replies):
    out = run_round(FakeModel(replies), QUESTIONS[1], "  多练法语  ", [], earlier=[(QUESTIONS[0], "读书")])
    assert out == ("ok", {"reply": FALLBACK, "direction": "多练法语"})


@pytest.mark.parametrize("raw", ['{"crisis": true}', '{"reply": "你说你不想活了"}'])
def test_crisis_in_model_output(raw):
    assert run_round(FakeModel([raw]), QUESTIONS[0], "随便", []) == ("crisis", None)
