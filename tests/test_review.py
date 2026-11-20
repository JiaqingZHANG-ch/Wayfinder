import json

import pytest

from mentor.model import FakeModel
from mentor.review import (FALLBACK_QUESTION, allowed_numbers, apply_adjustments, fallback_summary, numbers_in,
                           week_stats, write_review)

HABITS = [{"id": "reading", "title": "看书", "minutes": 30, "floor_min": 10},
          {"id": "english", "title": "背单词", "minutes": 20, "floor_min": 10}]
TASKS = [{"id": "exam-prep", "title": "高数期末复习"}]


def log(day: int, reading="done", english="skip", vs="same", note="", blocker=""):
    return {"date": f"2026-11-{day:02d}", "energy_after_class": 3, "blocker": blocker, "note": note,
            "tomorrow_task": "", "yesterday_done": None,
            "items": {"reading": {"status": reading}, "english": {"status": english},
                      "exam-prep": {"status": "done", "vs_plan": vs}}}


WEEK = [log(14, note="今天读得很顺"), log(15, english="done", vs="more"), log(16, reading="floor", vs="more"),
        log(17, reading="skip", vs="more", blocker="太累"), log(18, english="done", blocker="太累"),
        log(20, english="floor", note="背单词只背了十分钟", blocker="太累")]


def test_stats_are_counted_by_code():
    s = week_stats(WEEK, HABITS, TASKS)
    assert s["logged_days"] == 6
    assert s["habits"] == [
        {"id": "reading", "title": "看书", "done_days": 5, "floor_days": 1, "skip_days": 1},
        {"id": "english", "title": "背单词", "done_days": 3, "floor_days": 1, "skip_days": 3}]
    assert s["projects"] == [{"id": "exam-prep", "title": "高数期末复习", "less": 0, "same": 3, "more": 3}]
    assert s["best_day"] == {"date": "2026-11-20", "done_items": 3}  # 一样多取靠后的那天
    assert s["hardest_day"] == {"date": "2026-11-17", "done_items": 1}
    assert s["notes"] == [{"date": "2026-11-14", "note": "今天读得很顺"},
                          {"date": "2026-11-20", "note": "背单词只背了十分钟"}]


def test_patterns_only_from_three_days():
    p = week_stats(WEEK, HABITS, TASKS)["patterns"]
    assert p == ["「背单词」有 3 天没做", "「高数期末复习」有 3 天比预想花得多", "有 3 天卡在「太累」"]
    assert week_stats(WEEK[:2], HABITS, TASKS)["patterns"] == []


def test_empty_week():
    s = week_stats([], HABITS, TASKS)
    assert s["logged_days"] == 0 and s["best_day"] is None and s["hardest_day"] is None
    assert fallback_summary(s) == "这 7 天没有记录。"


def reply(summary, adjustments=(), question="下周哪天最容易被课拖住？"):
    return json.dumps({"summary": summary, "adjustments": list(adjustments), "question": question}, ensure_ascii=False)


GOOD = ("这 7 天记录了 6 天。「看书」做了 5 天，11 月 14 日你写「今天读得很顺」。"
        "「背单词」有 3 天没做，值得留意。")


def test_good_review_passes_through():
    stats = week_stats(WEEK, HABITS, TASKS)
    adj = {"kind": "minutes", "habit_id": "english", "value": 10, "why": "有 3 天没做，先把标准版缩短。"}
    outcome, out = write_review(FakeModel([reply(GOOD, [adj])]), stats, HABITS)
    assert outcome == "ok" and out["summary"] == GOOD and out["adjustments"] == [{**adj, "title": "背单词"}]
    assert out["question"] == "下周哪天最容易被课拖住？"
    # 每个数字都在统计里：这就是「模型不许改数字」的测试
    assert numbers_in(out["summary"]) <= allowed_numbers(stats)


@pytest.mark.parametrize("summary", [
    "这 7 天记录了 9 天。",                      # 改了数字（9 不在统计里）
    "「看书」做了 5 天，完成率 83%。",            # 自己算了新数字
    "11 月 14 日你写「今天读得特别顺」。",        # 引号里不是原话
    "我非常理解你的感受，这周记录了 6 天。",      # 禁用说法
])
def test_bad_summary_is_retried_then_falls_back(summary):
    stats = week_stats(WEEK, HABITS, TASKS)
    model = FakeModel([reply(summary), reply(summary)])
    outcome, out = write_review(model, stats, HABITS)
    assert outcome == "ok" and len(model.calls) == 2
    assert out == {"summary": fallback_summary(stats), "adjustments": [], "question": FALLBACK_QUESTION}
    assert numbers_in(out["summary"]) <= allowed_numbers(stats)


def test_second_try_can_succeed():
    stats = week_stats(WEEK, HABITS, TASKS)
    _, out = write_review(FakeModel([reply("记录了 99 天。"), reply(GOOD)]), stats, HABITS)
    assert out["summary"] == GOOD


@pytest.mark.parametrize("adjustments", [
    [{"kind": "minutes", "habit_id": "english", "value": 5, "why": "短一点"}],       # 比保底版还短
    [{"kind": "floor_min", "habit_id": "reading", "value": 40, "why": "长一点"}],    # 保底版比标准版长
    [{"kind": "minutes", "habit_id": "nope", "value": 10, "why": "?"}],             # 没有这个习惯
    [{"kind": "delete_habit", "habit_id": "reading", "value": 1, "why": "?"}],       # 没有这种调整
    [{"kind": "minutes", "habit_id": "english", "value": 15, "why": "x"}] * 4,       # 超过 3 条
])
def test_bad_adjustments_are_not_offered(adjustments):
    _, out = write_review(FakeModel([reply(GOOD, adjustments)] * 2), week_stats(WEEK, HABITS, TASKS), HABITS)
    assert out["adjustments"] == []


def test_bad_question_gets_fixed_one():
    _, out = write_review(FakeModel([reply(GOOD, question="你应该多读书")]), week_stats(WEEK, HABITS, TASKS), HABITS)
    assert out["summary"] == GOOD and out["question"] == FALLBACK_QUESTION


def test_model_down_or_crisis():
    stats = week_stats(WEEK, HABITS, TASKS)
    assert write_review(FakeModel([]), stats, HABITS)[1]["summary"] == fallback_summary(stats)
    assert write_review(FakeModel(['{"crisis": true}']), stats, HABITS) == ("crisis", None)


def test_apply_adjustments_returns_new_input():
    raw = {"wake": "07:00", "sleep": "23:00", "habits": [dict(h) for h in HABITS]}
    new = apply_adjustments(raw, [{"kind": "minutes", "habit_id": "english", "value": 15, "why": ""},
                                  {"kind": "add_habit", "title": "散步", "value": 20, "why": ""}])
    assert raw["habits"][1]["minutes"] == 20  # 原来的不动
    assert new["habits"][1]["minutes"] == 15
    assert new["habits"][2] == {"id": "habit-1", "title": "散步", "minutes": 20, "floor_min": 10,
                                "window": ["07:00", "23:00"]}


def test_blocker_from_patterns_can_be_quoted():
    stats = week_stats(WEEK, HABITS, TASKS)
    _, out = write_review(FakeModel([reply("有 3 天卡在「太累」。")]), stats, HABITS)
    assert out["summary"] == "有 3 天卡在「太累」。"


@pytest.mark.parametrize("summary", [
    "这七天里「看书」做了三十天。",                  # 中文数字也要在统计里（30 不在）
    "「背单词」有八天没做。",
    "「今天读得很顺」（11 月 20 日）。",              # 原话是 11-14 说的，日期标错了
    "你写过「今天读得很顺」。",                       # 原话没标日期
])
def test_chinese_numbers_and_quote_dates_are_checked(summary):
    stats = week_stats(WEEK, HABITS, TASKS)
    _, out = write_review(FakeModel([reply(summary)] * 2), stats, HABITS)
    assert out["summary"] == fallback_summary(stats)


def test_chinese_numbers_from_stats_pass():
    assert numbers_in("「看书」做了五天，十五分钟，二十三次，一起读") == {"5", "15", "23"}
    stats = week_stats(WEEK, HABITS, TASKS)
    ok = "「看书」做了五天，「背单词」有三天没做。2026-11-14 你写「今天读得很顺」。"
    assert write_review(FakeModel([reply(ok)]), stats, HABITS)[1]["summary"] == ok


def test_cannot_add_past_three_habits_in_one_review():
    adds = [{"kind": "add_habit", "title": t, "value": 20, "why": "稳"} for t in ("散步", "拉伸")]
    _, out = write_review(FakeModel([reply(GOOD, adds)] * 2), week_stats(WEEK, HABITS, TASKS), HABITS)
    assert out["adjustments"] == []  # 已经 2 个习惯，一次只能再加 1 个
