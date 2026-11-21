import json
from datetime import date

import pytest

from mentor.deep_talk import FALLBACK, invest_suggestions, next_screen, propose, reply, should_invite
from mentor.model import FakeModel


def test_next_screen_walks_in_order():
    assert next_screen({}, 1) == "scores"
    assert next_screen({1: {"scores": {"健康": 4}}}, 1) == "lift"
    assert next_screen({4: {"v1": "a", "v2": "b", "v3": "c"}}, 4) == "council"
    assert next_screen({4: {"v1": "a", "v2": "b", "v3": "c", "council_seen": True}}, 4) == "rate"


@pytest.mark.parametrize("kw,expected", [
    (dict(checked_in=False, energy_level=None), False),
    (dict(checked_in=True, energy_level=2), False),
    (dict(checked_in=True, energy_level=3), True),
    (dict(checked_in=True, energy_level=None), True),
])
def test_should_invite(kw, expected):
    assert should_invite([], today=date(2026, 11, 21), **kw) is expected


def test_no_invite_after_three_snoozes_or_after_a_talk_today():
    snoozed = [{"step": 1, "snoozes": 3, "started_at": None, "finished_at": None}]
    talked = [{"step": 1, "snoozes": 0, "started_at": "2026-11-21T20:00", "finished_at": "2026-11-21T20:08"}]
    for rows in (snoozed, talked):
        assert not should_invite(rows, checked_in=True, energy_level=None, today=date(2026, 11, 21))


def test_snoozes_count_on_the_current_step_only():
    rows = [{"step": 1, "snoozes": 3, "started_at": "2026-11-01T20:00", "finished_at": "2026-11-01T20:08"},
            {"step": 2, "snoozes": 0, "started_at": None, "finished_at": None}]
    assert should_invite(rows, checked_in=True, energy_level=None, today=date(2026, 11, 21))


def test_no_invite_when_all_four_steps_done():
    rows = [{"step": s, "snoozes": 0, "started_at": "2026-11-0%dT20:00" % s, "finished_at": "2026-11-0%dT20:08" % s}
            for s in (1, 2, 3, 4)]
    assert not should_invite(rows, checked_in=True, energy_level=None, today=date(2026, 11, 21))


def test_reply_ok_and_falls_back_on_banned_phrase_twice():
    good = json.dumps({"reply": "听起来是睡眠最先拖了后腿。"})
    assert reply(FakeModel([good]), "q", "a") == ("ok", "听起来是睡眠最先拖了后腿。")
    bad = json.dumps({"reply": "我非常理解你的感受"})
    assert reply(FakeModel([bad, bad]), "q", "a") == ("ok", FALLBACK)
    assert reply(FakeModel([]), "q", "a") == ("ok", FALLBACK)  # 模型连不上


def test_model_crisis_output_is_reported():
    assert reply(FakeModel(['{"crisis": true}']), "q", "a")[0] == "crisis"
    assert propose(FakeModel(['{"crisis": true}']), 1, {})[0] == "crisis"


def test_propose_falls_back_when_model_down():
    worth = "做出一个自己用得上的东西，不再浑浑噩噩地过日子"
    out = propose(FakeModel([]), 2, {2: {"why": "养活自己", "worth": worth}})
    assert out == ("ok", {"direction": worth[:40], "mismatch": False})
    assert propose(FakeModel([]), 1, {}) == ("ok", {"observation": None})
    assert propose(FakeModel([]), 3, {}) == ("ok", {"formula": None})


def test_propose_step4_clamps_goals_and_minutes():
    raw = json.dumps({"mission": "做 AI 应用开发", "goals": ["a", "b", "c", "d"],
                      "prototype": {"title": "每天写一个小功能", "minutes": 999, "floor_min": 0}, "tomorrow": "装好 Expo"})
    _, out = propose(FakeModel([raw]), 4, {4: {"v1": "x", "v2": "y", "v3": "z", "choose": 0}})
    assert len(out["goals"]) == 3
    assert (out["prototype"]["minutes"], out["prototype"]["floor_min"]) == (180, 1)  # 超范围夹到边界
    assert out["tomorrow"] == "装好 Expo"


def test_propose_step4_fallback_uses_chosen_version():
    _, out = propose(FakeModel([]), 4, {4: {"v1": "x", "v2": "y", "v3": "z", "choose": 1}})
    assert out == {"mission": "y", "goals": [], "prototype": None, "tomorrow": None}


def test_invest_health_first_and_skips_existing():
    answers = {1: {"lift": "健康吧，最近老熬夜"}}
    got = invest_suggestions(answers, [{"title": "看书"}])
    assert [g["key"] for g in got] == ["move", "sleep"] and "健康吧，最近老熬夜" in got[0]["why"]


def test_invest_love_puts_skill_first():
    got = invest_suggestions({3: {"loved": ["学法语"]}}, [])
    assert got[0]["key"] == "skill" and "学法语" in got[0]["why"] and got[1]["key"] == "read"
    assert "每天10分钟起步" in got[1]["why"]


def test_invest_empty_when_habits_full():
    assert invest_suggestions({}, [{"title": "a"}, {"title": "b"}, {"title": "c"}]) == []
