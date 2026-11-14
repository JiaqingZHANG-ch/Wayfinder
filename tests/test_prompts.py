import json
from datetime import date

import pytest

from mentor.prompts import MODES, build_messages, context_block, system_prompt
from mentor.store import Daily, Habit, Message, Store, Weekly

D10, D13, D14 = date(2026, 11, 10), date(2026, 11, 13), date(2026, 11, 14)
OPENING = "（对话开始，请你先开口）"
FINISH = "（用户点了结束，请现在给出结果，done 必须为 true）"


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "mentor.db")


def daily(day, **kw):
    base = dict(minutes=20, did="读了第3章", blocker="晚上被拉去打游戏", tomorrow_task="读第4章")
    return Daily(day=day, **{**base, **kw})


def test_modes():
    assert MODES == ("intake", "daily", "weekly", "free")


@pytest.mark.parametrize("mode", ["intake", "daily", "weekly", "free"])
def test_system_prompt_states_rules_and_contract(mode):
    text = system_prompt(mode)
    for needle in ("json", '"reply"', '"crisis"', '"done"', '"result"',
                   "只加不禁", "一次只问一个问题", "不承诺", "投资", "心理治疗", "恋人"):
        assert needle in text, needle


def test_each_mode_names_its_task_and_result_fields():
    assert "发生了什么让你想改变" in system_prompt("intake")
    for field in ("profile", "habit", "daily_minutes", "first_task"):
        assert field in system_prompt("intake")
    for field in ("minutes", "did", "blocker", "tomorrow_task", "yesterday_done"):
        assert field in system_prompt("daily")
    for field in ("pattern", "adjustment", "habit", "daily_minutes", "observation"):
        assert field in system_prompt("weekly")
    assert "tomorrow_task" not in system_prompt("free")


def test_daily_prompt_asks_about_today_not_yesterday():
    # 上次定的「下一件事」是要在今天做的；实测模型曾问成「昨天做到了吗」，把时间算错了天
    text = system_prompt("daily")
    assert "今天做到没有" in text
    assert "算进今天的分钟数" in text


def test_unknown_mode_raises_value_error():
    with pytest.raises(ValueError):
        system_prompt("chat")


def test_context_block_on_empty_store(store):
    text = context_block(store, D14)
    assert "2026-11-14" in text
    assert "（还没有）" in text


def test_context_block_shows_profile_habit_and_weekly(store):
    store.set_profile("## 处境\n研二，找实习", D10)
    store.set_habit(Habit("读书", 20))
    store.save_weekly(Weekly(D13, "晚上容易断", "挪到晚饭前"))
    text = context_block(store, D14)
    assert "研二，找实习" in text
    assert "读书" in text and "20" in text
    assert "晚上容易断" in text and "挪到晚饭前" in text


def test_context_block_marks_empty_days(store):
    store.save_daily(daily(D10))
    store.save_daily(daily(D14, minutes=35))
    lines = context_block(store, D14).splitlines()
    for day in range(8, 15):
        assert any(line.startswith(f"2026-11-{day:02d}") for line in lines), day
    assert not any(line.startswith("2026-11-07") for line in lines)
    assert "没有记录" in next(line for line in lines if line.startswith("2026-11-11"))
    assert "35" in next(line for line in lines if line.startswith("2026-11-14"))


def test_context_block_includes_last_task_across_gap(store):
    store.save_daily(daily(D10, tomorrow_task="晚饭前读完第3章"))
    text = context_block(store, D14)
    section = text.split("【上次定的那件事】")[1].split("【")[0]
    assert "晚饭前读完第3章" in section
    assert "2026-11-10" in section


def test_build_messages_opening_when_no_history(store):
    msgs = build_messages(store, "daily", D14)
    assert msgs[0]["role"] == "system"
    assert system_prompt("daily") in msgs[0]["content"]
    assert context_block(store, D14) in msgs[0]["content"]
    assert msgs[1:] == [{"role": "user", "content": OPENING}]


def test_build_messages_replays_history_without_opening(store):
    store.add_message(Message(D14, "daily", "assistant", "昨天读了吗？"))
    store.add_message(Message(D14, "daily", "user", "读了一半"))
    msgs = build_messages(store, "daily", D14)
    assert msgs[2] == {"role": "user", "content": "读了一半"}
    # 导师说过的话要按输出约定的 json 形状回放：纯文本回放时 DeepSeek 的 JSON 模式有六成概率只回空格
    # （2026-11-14 实测 6/10 对 0/10）
    assert msgs[1]["role"] == "assistant"
    assert json.loads(msgs[1]["content"]) == {"reply": "昨天读了吗？", "crisis": False, "done": False,
                                              "result": None}
    assert "昨天读了吗？" in msgs[1]["content"]  # 中文不转义，模型读得到原文


def test_build_messages_force_finish_appends_instruction(store):
    store.add_message(Message(D14, "intake", "user", "我25岁"))
    msgs = build_messages(store, "intake", D14, force_finish=True)
    assert msgs[-1] == {"role": "user", "content": FINISH}
    assert msgs[-2] == {"role": "user", "content": "我25岁"}


def test_intake_history_spans_days_daily_history_is_today_only(store):
    store.add_message(Message(D10, "intake", "user", "建档第一天"))
    store.add_message(Message(D14, "intake", "user", "建档第二天"))
    store.add_message(Message(D13, "daily", "user", "昨天的对账"))
    store.add_message(Message(D14, "daily", "user", "今天的对账"))
    intake = [m["content"] for m in build_messages(store, "intake", D14)[1:]]
    today = [m["content"] for m in build_messages(store, "daily", D14)[1:]]
    assert intake == ["建档第一天", "建档第二天"]
    assert today == ["今天的对账"]
