import json
import os
from datetime import date

import pytest

from mentor.checkin import Item, closing_line, parse_sentence, schema_for, validate_checkin
from mentor.model import FakeModel, ModelError, make_model

DAY = date(2026, 11, 20)
ITEMS = {"english": Item("英语"), "reading": Item("阅读"), "exam-prep": Item("高数复习", project=True)}
SENTENCE = "英语完成 阅读保底 电量3"
PARSED = {"energy_after_class": 3, "items": {"english": {"status": "done"}, "reading": {"status": "floor"}},
          "note": "", "blocker": "", "tomorrow_task": "", "yesterday_done": None}


def test_valid_buttons_result_is_cleaned():
    out = validate_checkin({"date": "2026-11-20", "items": {"exam-prep": {"status": "done", "vs_plan": "more"}},
                            "note": "  今天读得很顺 ", "extra": 1}, DAY, ITEMS)
    assert out == {"date": "2026-11-20", "energy_after_class": None,
                   "items": {"exam-prep": {"status": "done", "vs_plan": "more"}},
                   "blocker": "", "note": "今天读得很顺", "tomorrow_task": "", "yesterday_done": None}


@pytest.mark.parametrize("obj", [
    [],
    {"date": "2026-11-19"},
    {"energy_after_class": 0}, {"energy_after_class": 6}, {"energy_after_class": True}, {"energy_after_class": "3"},
    {"items": {"french": {"status": "done"}}},
    {"items": {"english": {"status": "finished"}}},
    {"items": {"english": "done"}},
    {"items": {"english": {"status": "done", "vs_plan": "more"}}},  # 只有项目能填 vs_plan
    {"items": {"exam-prep": {"status": "done", "vs_plan": "much"}}},
    {"note": 3},
    {"yesterday_done": "yes"},
])
def test_bad_results_are_rejected(obj):
    with pytest.raises(ValueError):
        validate_checkin(obj, DAY, ITEMS)


def test_parse_example_sentence():
    fake = FakeModel([json.dumps(PARSED)])
    assert parse_sentence(fake, SENTENCE, DAY, ITEMS) == ("ok", {**PARSED, "date": "2026-11-20"})
    call = fake.calls[0]
    assert call["schema"] == schema_for(ITEMS)
    assert call["messages"][-1] == {"role": "user", "content": SENTENCE}


def test_note_kept_only_if_verbatim():
    sentence = "英语完成，今天读得很顺"
    ok = parse_sentence(FakeModel([json.dumps({**PARSED, "note": "今天读得很顺"})]), sentence, DAY, ITEMS)
    assert ok[1]["note"] == "今天读得很顺"
    changed = parse_sentence(FakeModel([json.dumps({**PARSED, "note": "今天读得挺顺利"})]), sentence, DAY, ITEMS)
    assert changed[1]["note"] == ""


@pytest.mark.parametrize("raw", ['{"crisis": true}', '{"items": {}, "note": "我不想活了"}', "我想死"])
def test_crisis_in_model_output_wins_over_format(raw):
    assert parse_sentence(FakeModel([raw]), "随便", DAY, ITEMS) == ("crisis", None)


@pytest.mark.parametrize("raw", ["不是 json", "[]", '{"items": {"french": {"status": "done"}}}', ""])
def test_bad_model_output_means_press_buttons(raw):
    assert parse_sentence(FakeModel([raw]), SENTENCE, DAY, ITEMS) == ("bad", None)


def test_model_down_means_press_buttons():
    assert parse_sentence(FakeModel([]), SENTENCE, DAY, ITEMS) == ("bad", None)


def test_closing_only_quotes_the_user():
    assert closing_line("今天读得很顺") == "「今天读得很顺」"
    assert closing_line("") == "今天记下了"


# 循环 ⑤：装好 Ollama、下好模型后运行  $env:MODEL_TEST='ollama'; uv run pytest tests/test_checkin.py -k real
@pytest.mark.skipif(os.environ.get("MODEL_TEST") != "ollama", reason="要本机 Ollama：设 MODEL_TEST=ollama 再跑")
def test_real_ollama_parses_example_sentence():
    model = make_model({"MODEL": "ollama", "OLLAMA_MODEL": os.environ.get("OLLAMA_MODEL", "")})
    try:
        outcome, result = parse_sentence(model, SENTENCE, DAY, ITEMS)
    except ModelError as e:
        pytest.fail(str(e))
    assert outcome == "ok"
    assert result["energy_after_class"] == 3
    assert result["items"] == PARSED["items"]


def test_prompt_gives_planned_minutes_so_short_sessions_count_as_floor():
    from mentor.checkin import _prompt
    p = _prompt({"english": Item("英语", minutes=30), "exam-prep": Item("高数复习", project=True, minutes=50)})
    assert "english（英语，计划 30 分钟）" in p and "exam-prep（高数复习，项目，计划 50 分钟）" in p
    assert "就是 floor" in p


def test_energy_dropped_when_sentence_never_mentions_it():
    from mentor.model import FakeModel
    reply = '{"energy_after_class": 3, "items": {}, "blocker": "", "note": "", "tomorrow_task": "", "yesterday_done": null}'
    _, r = parse_sentence(FakeModel(replies=[reply]), "今天上完课很累", DAY, ITEMS)
    assert r["energy_after_class"] is None
    _, r = parse_sentence(FakeModel(replies=[reply]), "今天电量3", DAY, ITEMS)
    assert r["energy_after_class"] == 3


def test_energy_words_ignore_computer_and_film():
    from mentor.checkin import ENERGY_WORDS
    assert not ENERGY_WORDS.search("在电脑上背了单词，看了场电影")
    assert all(ENERGY_WORDS.search(t) for t in ("电量3", "今天没电了", "精力还行", "只剩两格"))
