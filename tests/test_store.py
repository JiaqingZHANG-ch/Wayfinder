from datetime import date, timedelta

import pytest

from mentor.store import Council, Daily, Habit, Message, Opinion, Store, Weekly

D10, D14, D20 = date(2026, 11, 10), date(2026, 11, 14), date(2026, 11, 20)


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "var" / "mentor.db")


def daily(day, **kw):
    base = dict(minutes=20, did="读了第3章", blocker="", tomorrow_task="读第4章")
    return Daily(day=day, **{**base, **kw})


def test_profile_roundtrip_and_date(store):
    assert store.get_profile() is None
    assert store.profile_date() is None
    store.set_profile("甲", D14)
    assert store.get_profile() == "甲"
    assert store.profile_date() == D14
    store.set_profile("乙", D20)
    assert store.get_profile() == "乙"
    assert store.profile_date() == D14  # 建档完成日只记第一次


def test_habit_roundtrip(store):
    assert store.get_habit() is None
    store.set_habit(Habit("读书", 20))
    store.set_habit(Habit("练字", 15))
    assert store.get_habit() == Habit("练字", 15)


def test_messages_filter_by_mode_and_day(store):
    store.add_message(Message(D10, "intake", "user", "第一天"))
    store.add_message(Message(D14, "intake", "assistant", "第二天"))
    store.add_message(Message(D14, "daily", "user", "对账"))
    assert [m.content for m in store.messages("intake")] == ["第一天", "第二天"]
    assert store.messages("daily", D14) == [Message(D14, "daily", "user", "对账")]
    assert store.messages("daily", D10) == []


def test_save_daily_overwrites_same_day(store):
    store.save_daily(daily(D14, minutes=10))
    store.save_daily(daily(D14, minutes=35, tomorrow_task="练字"))
    rows = store.daily_between(D10, D20)
    assert rows == [daily(D14, minutes=35, tomorrow_task="练字")]


def test_daily_between_is_inclusive_and_ascending(store):
    for d in (D20, D10, D14):
        store.save_daily(daily(d))
    assert [r.day for r in store.daily_between(D10, D14)] == [D10, D14]


def test_last_daily_before_skips_gaps(store):
    store.save_daily(daily(D10, tomorrow_task="早起"))
    store.save_daily(daily(D14))
    assert store.last_daily_before(D14).day == D10
    assert store.last_daily_before(D14).tomorrow_task == "早起"
    assert store.last_daily_before(D10) is None


def test_set_done_and_update_daily(store):
    store.save_daily(daily(D14))
    assert store.daily_between(D14, D14)[0].done is None
    store.set_done(D14, True)
    assert store.daily_between(D14, D14)[0].done is True
    store.update_daily(D14, minutes=45, tomorrow_task="跑步", done=False)
    row = store.daily_between(D14, D14)[0]
    assert (row.minutes, row.tomorrow_task, row.done) == (45, "跑步", False)
    assert row.did == "读了第3章"  # 没让改的字段不动
    store.update_daily(D14, minutes=45, tomorrow_task="跑步", done=None)
    assert store.daily_between(D14, D14)[0].done is None


def test_weekly_newest_first(store):
    assert store.all_weekly() == []
    store.save_weekly(Weekly(D14, "晚上容易断", "挪到晚饭前"))
    store.save_weekly(Weekly(D20, "稳了", "加到30分钟"))
    assert [w.day for w in store.all_weekly()] == [D20, D14]


def test_crisis_pauses_until_resumed(store):
    assert store.is_paused(D14) is False
    store.log_crisis(D14, "x")
    assert store.is_paused(D14) is True
    assert store.is_paused(D14 + timedelta(days=1)) is False
    store.resume(D14)
    assert store.is_paused(D14) is False


def test_had_crisis_remembers_the_day_even_after_resume(store):
    assert store.had_crisis(D14) is False
    store.log_crisis(D14, "x")
    store.resume(D14)
    assert store.is_paused(D14) is False
    assert store.had_crisis(D14) is True
    assert store.had_crisis(D20) is False


def test_flags(store):
    assert store.get_flag("first_use_ack") is False
    store.set_flag("first_use_ack")
    assert store.get_flag("first_use_ack") is True


def council(day, trigger="intake", conclusion="先把读书挪到晚饭前"):
    return Council(day, trigger, conclusion, "一个说先减量，一个说先换时间",
                   (Opinion("认知偏差视角（源自卡尼曼）", "看到a", "担心b", "建议c"),
                    Opinion("微习惯视角（源自福格）", "他说：\"别'放弃'\"\n第二行 🙂", "担心e", "建议f")))


def test_council_roundtrip_keeps_opinion_order_and_text(store):
    assert store.latest_council() is None
    assert store.council_on(D14, "intake") is None
    store.save_council(council(D14))
    assert store.latest_council() == council(D14)
    assert [o.title for o in store.latest_council().opinions] == ["认知偏差视角（源自卡尼曼）", "微习惯视角（源自福格）"]


def test_latest_council_is_the_last_saved(store):
    store.save_council(council(D20, "weekly", "后存的日期更早也算最新"))
    store.save_council(council(D14, "intake", "最后存的"))
    assert store.latest_council().conclusion == "最后存的"


def test_council_on_filters_by_day_and_trigger(store):
    store.save_council(council(D14, "intake"))
    store.save_council(council(D14, "weekly", "周"))
    assert store.council_on(D14, "weekly").conclusion == "周"
    assert store.council_on(D14, "intake").trigger == "intake"
    assert store.council_on(D20, "intake") is None


def test_data_survives_reopen(tmp_path):
    path = tmp_path / "mentor.db"
    first = Store(path)
    first.set_profile("甲", D14)
    first.save_daily(daily(D14))
    again = Store(path)
    assert again.get_profile() == "甲"
    assert again.daily_between(D14, D14) == [daily(D14)]


def test_text_with_quotes_newlines_emoji_stored_intact(store):
    text = "他说：\"别'放弃'\"\n第二行；DROP TABLE daily; -- 🙂"
    store.add_message(Message(D14, "free", "user", text))
    store.save_daily(daily(D14, did=text))
    assert store.messages("free", D14)[0].content == text
    assert store.daily_between(D14, D14)[0].did == text
