import json
from datetime import date, datetime, timedelta

import pytest

from mentor.mentor import (MAX_INPUT, MSG_OFFLINE, MSG_TOO_LONG, MSG_UNCLEAR, TurnResult, current_mode,
                           handle_turn, logical_date, weekly_due)
from mentor.model import ModelError
from mentor.prompts import FINISH_NOTE, OPENING_NOTE
from mentor.safety import CRISIS_MESSAGE
from mentor.store import Daily, Habit, Message, Store, Weekly

D10, D13, D14 = date(2026, 11, 10), date(2026, 11, 13), date(2026, 11, 14)
PROFILE = "## 处境\n研二\n\n## 近期观察\n（暂无）"
INTAKE = {"profile": PROFILE, "habit": "读书", "daily_minutes": 20, "first_task": "晚饭前读10页"}
DAILY = {"minutes": 25, "did": "读了第3章", "blocker": "晚上被拉去打游戏", "tomorrow_task": "读第4章",
         "yesterday_done": True}
WEEKLY = {"pattern": "晚上容易断", "adjustment": "挪到晚饭前", "habit": "读书", "daily_minutes": 30,
          "observation": "一个人待着时最容易断"}


def j(reply="嗯", *, done=False, result=None, crisis=False) -> str:
    return json.dumps({"reply": reply, "crisis": crisis, "done": done, "result": result}, ensure_ascii=False)


class FakeModel:
    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def complete_json(self, messages):
        self.calls.append(messages)
        item = self.replies.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "mentor.db")


@pytest.fixture
def ready(store):
    """已建档、有习惯的库。"""
    store.set_profile(PROFILE, D10)
    store.set_habit(Habit("读书", 20))
    return store


def a_daily(day, **kw):
    base = dict(minutes=20, did="读书", blocker="", tomorrow_task="读第2章")
    return Daily(day=day, **{**base, **kw})


# 模式

def test_mode_intake_without_profile(store):
    assert current_mode(store, D14) == "intake"


def test_mode_daily_then_free_after_checkin(ready):
    assert current_mode(ready, D14) == "daily"
    ready.save_daily(a_daily(D14))
    assert current_mode(ready, D14) == "free"
    assert current_mode(ready, D14 + timedelta(days=1)) == "daily"


def test_weekly_due_counts_calendar_days_from_profile_then_from_last_weekly(store):
    assert weekly_due(store, D14) is False  # 还没建档
    store.set_profile(PROFILE, D10)
    assert weekly_due(store, date(2026, 11, 16)) is False
    assert weekly_due(store, date(2026, 11, 17)) is True
    store.save_weekly(Weekly(date(2026, 11, 17), "p", "a"))
    assert weekly_due(store, date(2026, 11, 23)) is False
    assert weekly_due(store, date(2026, 11, 24)) is True


# 建档

def test_intake_done_saves_profile_habit_and_first_task(store):
    out = handle_turn(store, FakeModel(j("档案写好了", done=True, result=INTAKE)), "intake", "就这些", D14)
    assert out == TurnResult("档案写好了", "intake", saved="profile")
    assert store.get_profile() == PROFILE
    assert store.profile_date() == D14
    assert store.get_habit() == Habit("读书", 20)
    assert store.daily_between(D14, D14) == [Daily(D14, 0, "完成建档", "", "晚饭前读10页")]
    assert current_mode(store, D14) == "free"


def test_intake_not_done_saves_nothing_but_keeps_messages(store):
    out = handle_turn(store, FakeModel(j("发生了什么让你想改变？")), "intake", "我25岁", D14)
    assert out == TurnResult("发生了什么让你想改变？", "intake")
    assert store.get_profile() is None
    assert [(m.role, m.content) for m in store.messages("intake")] == [
        ("user", "我25岁"), ("assistant", "发生了什么让你想改变？")]


def test_force_finish_passes_instruction_to_model(store):
    store.add_message(Message(D14, "intake", "user", "我25岁"))
    model = FakeModel(j("好", done=True, result=INTAKE))
    out = handle_turn(store, model, "intake", None, D14, force_finish=True)
    assert out.saved == "profile"
    assert model.calls[0][-1] == {"role": "user", "content": FINISH_NOTE}
    assert [m.content for m in store.messages("intake") if m.role == "user"] == ["我25岁"]  # 提示语不入库


# 对账

def test_daily_done_saves_row_and_marks_previous_task(ready):
    ready.save_daily(a_daily(D10))  # 4 天前定的事
    out = handle_turn(ready, FakeModel(j("明天读第4章", done=True, result=DAILY)), "daily", "读了", D14)
    assert out.saved == "daily"
    assert ready.daily_between(D14, D14) == [Daily(D14, 25, "读了第3章", "晚上被拉去打游戏", "读第4章")]
    assert ready.daily_between(D10, D10)[0].done is True


def test_daily_first_ever_has_no_previous_to_mark(ready):
    out = handle_turn(ready, FakeModel(j(done=True, result=DAILY)), "daily", "读了", D14)
    assert out.saved == "daily"
    assert [d.day for d in ready.daily_between(D10, D14)] == [D14]


def test_daily_null_yesterday_done_leaves_previous_untouched(ready):
    ready.save_daily(a_daily(D13))
    handle_turn(ready, FakeModel(j(done=True, result={**DAILY, "yesterday_done": None})), "daily", "读了", D14)
    assert ready.daily_between(D13, D13)[0].done is None


def test_daily_twice_same_day_overwrites(ready):
    handle_turn(ready, FakeModel(j(done=True, result=DAILY)), "daily", "读了", D14)
    handle_turn(ready, FakeModel(j(done=True, result={**DAILY, "minutes": 40})), "daily", "又读了", D14)
    assert [d.minutes for d in ready.daily_between(D14, D14)] == [40]


# 复盘

def test_weekly_done_saves_and_appends_observation_under_heading(ready):
    ready.set_profile("## 处境\n研二\n\n## 近期观察\n（暂无）\n\n## 备注\n自己加的", D10)
    out = handle_turn(ready, FakeModel(j(done=True, result=WEEKLY)), "weekly", "好", D14)
    assert out.saved == "weekly"
    assert ready.all_weekly() == [Weekly(D14, "晚上容易断", "挪到晚饭前")]
    assert ready.get_habit() == Habit("读书", 30)
    assert ready.get_profile() == ("## 处境\n研二\n\n## 近期观察\n- 2026-11-14：一个人待着时最容易断"
                                   "\n\n## 备注\n自己加的")


def test_weekly_second_observation_is_appended_after_the_first(ready):
    handle_turn(ready, FakeModel(j(done=True, result=WEEKLY)), "weekly", "好", D14)
    later = date(2026, 11, 21)
    handle_turn(ready, FakeModel(j(done=True, result={**WEEKLY, "observation": "早上更稳"})), "weekly", "好", later)
    assert ready.get_profile().endswith(
        "## 近期观察\n- 2026-11-14：一个人待着时最容易断\n- 2026-11-21：早上更稳")


def test_weekly_adds_heading_when_user_deleted_it(ready):
    ready.set_profile("## 处境\n研二", D10)
    handle_turn(ready, FakeModel(j(done=True, result=WEEKLY)), "weekly", "好", D14)
    assert ready.get_profile() == "## 处境\n研二\n\n## 近期观察\n- 2026-11-14：一个人待着时最容易断"


# 自由对话

def test_free_never_saves_even_if_model_says_done(ready):
    ready.save_daily(a_daily(D14))
    out = handle_turn(ready, FakeModel(j("我在听", done=True, result=DAILY)), "free", "今天有点烦", D14)
    assert out == TurnResult("我在听", "free")
    assert ready.daily_between(D14, D14) == [a_daily(D14)]


# 输入

def test_empty_text_ignored(ready):
    model = FakeModel()
    assert handle_turn(ready, model, "daily", "  \n ", D14) == TurnResult("", "daily")
    assert model.calls == [] and ready.messages("daily", D14) == []


def test_too_long_rejected_and_not_stored(ready):
    model = FakeModel()
    out = handle_turn(ready, model, "daily", "字" * (MAX_INPUT + 1), D14)
    assert out == TurnResult(MSG_TOO_LONG, "daily", error=True)
    assert model.calls == [] and ready.messages("daily", D14) == []


def test_text_at_the_limit_is_accepted(ready):
    out = handle_turn(ready, FakeModel(j("好")), "daily", "字" * MAX_INPUT, D14)
    assert out.error is False


def test_opening_turn_with_none_text_calls_model(ready):
    model = FakeModel(j("昨天读了吗？"))
    out = handle_turn(ready, model, "daily", None, D14)
    assert out.reply == "昨天读了吗？"
    assert model.calls[0][-1] == {"role": "user", "content": OPENING_NOTE}
    assert [(m.role, m.content) for m in ready.messages("daily", D14)] == [("assistant", "昨天读了吗？")]


# 出错

def test_garbage_json_retries_once_then_unclear(ready):
    model = FakeModel("不是json", '{"reply": 3}')
    out = handle_turn(ready, model, "daily", "读了", D14)
    assert out == TurnResult(MSG_UNCLEAR, "daily", error=True)
    assert len(model.calls) == 2
    assert [m.content for m in ready.messages("daily", D14)] == ["读了"]  # 只留用户那句
    assert ready.daily_between(D14, D14) == []


def test_second_try_valid_is_used(ready):
    out = handle_turn(ready, FakeModel("[]", j("好的")), "daily", "读了", D14)
    assert out == TurnResult("好的", "daily")


@pytest.mark.parametrize("bad", [
    {**DAILY, "minutes": -5},
    {**DAILY, "minutes": True},
    {**DAILY, "minutes": 1441},
    {**DAILY, "minutes": "25"},
    {k: v for k, v in DAILY.items() if k != "tomorrow_task"},
    {**DAILY, "tomorrow_task": "  "},
    {**DAILY, "yesterday_done": "yes"},
    {**DAILY, "did": "字" * 2001},
    None,
    "读了",
])
def test_done_with_bad_result_saves_nothing(ready, bad):
    out = handle_turn(ready, FakeModel(j(done=True, result=bad), j(done=True, result=bad)), "daily", "读了", D14)
    assert out == TurnResult(MSG_UNCLEAR, "daily", error=True)
    assert ready.daily_between(D14, D14) == []


def test_non_boolean_done_is_rejected(ready):
    # 「done」写成字符串时，回话会说「记下了」却什么都没存；必须当作不合约定
    raw = json.dumps({"reply": "记下了", "crisis": False, "done": "true", "result": DAILY}, ensure_ascii=False)
    out = handle_turn(ready, FakeModel(raw, raw), "daily", "读了", D14)
    assert out == TurnResult(MSG_UNCLEAR, "daily", error=True)
    assert ready.daily_between(D14, D14) == []


def test_force_finish_without_done_is_an_error(store):
    store.add_message(Message(D14, "intake", "user", "我25岁"))
    model = FakeModel(j("我们再聊聊"), j("我们再聊聊"))
    out = handle_turn(store, model, "intake", None, D14, force_finish=True)
    assert out == TurnResult(MSG_UNCLEAR, "intake", error=True)
    assert len(model.calls) == 2 and store.get_profile() is None


def test_none_text_after_answered_turn_does_nothing(ready):
    # 另一个页面已经拿到回复后，再点「让导师回应」不该多出一条回话
    ready.add_message(Message(D14, "daily", "user", "读了"))
    ready.add_message(Message(D14, "daily", "assistant", "好"))
    model = FakeModel()
    assert handle_turn(ready, model, "daily", None, D14) == TurnResult("", "daily")
    assert model.calls == [] and len(ready.messages("daily", D14)) == 2


def test_none_text_after_unanswered_user_turn_retries(ready):
    ready.add_message(Message(D14, "daily", "user", "读了"))
    assert handle_turn(ready, FakeModel(j("好")), "daily", None, D14) == TurnResult("好", "daily")


def test_day_starts_at_four_in_the_morning():
    assert logical_date(datetime(2026, 11, 15, 0, 30)) == D14  # 半夜十二点半对账，记的还是 14 日
    assert logical_date(datetime(2026, 11, 15, 3, 59)) == D14
    assert logical_date(datetime(2026, 11, 15, 4, 0)) == date(2026, 11, 15)


def test_empty_blocker_is_allowed(ready):
    out = handle_turn(ready, FakeModel(j(done=True, result={**DAILY, "blocker": ""})), "daily", "读了", D14)
    assert out.saved == "daily"


def test_bad_intake_and_weekly_results_save_nothing(store):
    bad_intake = {**INTAKE, "daily_minutes": 0}
    out = handle_turn(store, FakeModel(j(done=True, result=bad_intake), j(done=True, result=bad_intake)),
                      "intake", "好", D14)
    assert out.error is True and store.get_profile() is None
    bad_weekly = {k: v for k, v in WEEKLY.items() if k != "observation"}
    out = handle_turn(store, FakeModel(j(done=True, result=bad_weekly), j(done=True, result=bad_weekly)),
                      "weekly", "好", D14)
    assert out.error is True and store.all_weekly() == []


def test_model_error_keeps_user_message(ready):
    out = handle_turn(ready, FakeModel(ModelError("网络错误")), "daily", "读了20分钟", D14)
    assert out == TurnResult(MSG_OFFLINE, "daily", error=True)
    assert [(m.role, m.content) for m in ready.messages("daily", D14)] == [("user", "读了20分钟")]


def test_unknown_mode_raises(ready):
    with pytest.raises(ValueError):
        handle_turn(ready, FakeModel(), "chat", "你好", D14)


# 危机

def test_keyword_crisis_skips_model_and_pauses(ready):
    model = FakeModel()
    out = handle_turn(ready, model, "daily", "我不想活了", D14)
    assert out == TurnResult(CRISIS_MESSAGE, "daily", crisis=True)
    assert model.calls == []
    assert ready.is_paused(D14) is True
    assert [(m.role, m.content) for m in ready.messages("daily", D14)] == [
        ("user", "我不想活了"), ("assistant", CRISIS_MESSAGE)]


def test_model_flag_crisis_shows_fixed_message(ready):
    out = handle_turn(ready, FakeModel(j("别这样想", crisis=True, done=True, result=DAILY)), "daily", "没意思", D14)
    assert out == TurnResult(CRISIS_MESSAGE, "daily", crisis=True)
    assert ready.is_paused(D14) is True
    assert ready.daily_between(D14, D14) == []  # 危机时不保存对账结果
    assert ready.messages("daily", D14)[-1].content == CRISIS_MESSAGE


def test_model_crisis_flag_wins_over_bad_reply(ready):
    model = FakeModel('{"reply": "", "crisis": true}')
    out = handle_turn(ready, model, "daily", "没意思", D14)
    assert out == TurnResult(CRISIS_MESSAGE, "daily", crisis=True)
    assert len(model.calls) == 1 and ready.is_paused(D14) is True


@pytest.mark.parametrize("flag", ['"true"', "1", '"yes"'])
def test_non_boolean_crisis_flag_counts_as_crisis(ready, flag):
    raw = '{"reply": "嗯", "crisis": %s, "done": false, "result": null}' % flag
    assert handle_turn(ready, FakeModel(raw), "daily", "没意思", D14).crisis is True


def test_paused_day_does_not_call_model_until_resumed(ready):
    ready.log_crisis(D14, "x")
    model = FakeModel(j("我们继续"))
    out = handle_turn(ready, model, "daily", "我好多了", D14)
    assert out == TurnResult(CRISIS_MESSAGE, "daily", crisis=True)
    assert model.calls == []
    ready.resume(D14)
    assert handle_turn(ready, model, "daily", "我好多了", D14) == TurnResult("我们继续", "daily")


def test_next_day_is_not_paused(ready):
    ready.log_crisis(D13, "x")
    assert handle_turn(ready, FakeModel(j("早")), "daily", "早", D14) == TurnResult("早", "daily")
