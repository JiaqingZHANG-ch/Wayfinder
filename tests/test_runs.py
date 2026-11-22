"""做事陪跑的纯函数：往后推、截短、专注时长、块和番茄提醒（server/runs.py）。"""
from datetime import datetime, timedelta, timezone

from planner.model import to_min
from server.runs import clashes, cut_at, extend, focus_seconds, paused_seconds, run_reminders

SLEEP = to_min("22:00")
A = {"id": "a", "title": "看书", "start": "15:00", "end": "16:00", "kind": "must"}
B = {"id": "b", "title": "写报告", "start": "16:00", "end": "17:00", "kind": "proj", "task_id": "r"}
F = {"id": "free-1", "title": "自由时间", "start": "17:00", "end": "18:00", "kind": "life"}
C = {"id": "dinner", "title": "晚饭", "start": "18:00", "end": "18:45", "kind": "life"}
K = {"id": "cls", "title": "课", "start": "19:00", "end": "20:00", "kind": "class"}
TZ = timezone(timedelta(hours=1))


def at(hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime(2026, 11, 20, h, m, tzinfo=TZ)


def iso(hhmm: str) -> str:
    return at(hhmm).isoformat()


def by_id(blocks):
    return {b["id"]: (b["start"], b["end"]) for b in blocks}


def test_push_ripples_and_trims_free():
    out, ok = extend([A, B, F, C, K], "a", 10, SLEEP, True)
    assert ok
    assert by_id(out) == {"a": ("15:00", "16:10"), "b": ("16:10", "17:10"), "free-1": ("17:10", "18:00"),
                          "dinner": ("18:00", "18:45"), "cls": ("19:00", "20:00")}
    assert all(b.get("pinned") is None for b in out) and [b["id"] for b in out] == ["a", "b", "free-1", "dinner", "cls"]


def test_push_drops_short_free():
    out, ok = extend([A, B, {**F, "end": "17:35"}, C], "a", 10, SLEEP, True)
    assert ok and "free-1" not in by_id(out)


def test_push_blocked_by_class_keeps_others():
    out, ok = extend([A, B, {**K, "start": "17:05", "end": "18:00"}], "a", 10, SLEEP, True)
    assert not ok
    assert by_id(out)["a"] == ("15:00", "16:10") and by_id(out)["b"] == ("16:00", "17:00")
    assert clashes(out, "a") == ["a", "b"]


def test_extension_capped_at_class():
    out, ok = extend([A, {**K, "start": "16:05", "end": "17:00"}], "a", 10, SLEEP, True)
    assert not ok and by_id(out)["a"] == ("15:00", "16:05")


def test_push_past_sleep_fails():
    a = {**A, "start": "20:00", "end": "21:00"}
    x = {"id": "x", "title": "练字", "start": "21:00", "end": "21:55", "kind": "must"}
    out, ok = extend([a, x], "a", 10, SLEEP, True)
    assert not ok and by_id(out)["x"] == ("21:00", "21:55")


def test_pinned_is_immovable():
    out, ok = extend([A, {**B, "pinned": True}], "a", 10, SLEEP, True)
    assert not ok and by_id(out) == {"a": ("15:00", "16:00"), "b": ("16:00", "17:00")}


def test_no_ripple_only_extends():
    out, ok = extend([A, B], "a", 20, SLEEP, False)
    assert not ok and by_id(out) == {"a": ("15:00", "16:20"), "b": ("16:00", "17:00")}


def test_cut_at():
    assert by_id(cut_at([A], "a", to_min("15:31"))) == {"a": ("15:00", "15:35")}
    assert cut_at([A], "a", to_min("15:58")) is None  # 取整到 16:00，不早于原结束
    assert cut_at([A], "a", to_min("15:04")) is None  # 只剩 5 分钟


def test_focus_and_paused_seconds():
    run = {"started_at": iso("15:00"), "pauses": [[iso("15:20"), iso("15:26")], [iso("15:40"), None]], "done_at": None}
    assert paused_seconds(run, at("15:50")) == 960
    assert focus_seconds(run, at("15:50")) == 2040


def started(b):
    return at(b["start"])


def test_block_reminders_only_future_operable_not_done():
    out = run_reminders([A, B, K], {}, {"a", "b"}, at("15:30"), started)
    blocks = [r for r in out if r["kind"] == "block"]
    assert blocks == [{"kind": "block", "at": "16:00", "title": "到点了：写报告", "body": "16:00–17:00", "url": "/"}]


def test_pomodoro_reminders_skip_pauses():
    run = {"started_at": iso("15:00"), "pauses": [[iso("15:10"), iso("15:15")]], "done_at": None}
    out = [(r["at"], r["title"]) for r in run_reminders([A], {"a": run}, {"a"}, at("15:20"), started) if r["kind"] == "pomodoro"]
    assert out == [("15:30", "休息 5 分钟"), ("15:35", "回来接着做"), ("16:00", "休息 5 分钟")]
    paused = {**run, "pauses": [*run["pauses"], [iso("15:18"), None]]}
    assert not [r for r in run_reminders([A], {"a": paused}, {"a"}, at("15:20"), started) if r["kind"] == "pomodoro"]


def test_no_pomodoro_reminders_before_start():
    # 每块点「开始」才计时：正在进行、还没点开始的块不响番茄（只有到点提醒，它已经响过了）
    assert run_reminders([A], {}, {"a"}, at("15:20"), started) == []


def test_pomodoro_count_ignores_pause_extension():
    # 看书本来 15:00–16:00（2 个番茄），停了 10 分钟、继续时延长到 16:10：专注还是 60 分钟，仍是 2 个，最后一个不提醒回来
    run = {"started_at": iso("15:00"), "pauses": [[iso("15:10"), iso("15:20")]], "done_at": None,
           "planned_start": "15:00", "planned_end": "16:00"}  # 真实的记录都带第一次点按钮时的计划起止
    out = [(r["at"], r["title"]) for r in run_reminders([{**A, "end": "16:10"}], {"a": run}, {"a"}, at("15:21"), started)
           if r["kind"] == "pomodoro"]
    assert out == [("15:35", "休息 5 分钟"), ("15:40", "回来接着做"), ("16:05", "休息 5 分钟")]


def test_pomodoro_count_uses_planned_span_after_rounded_extension():
    # 评审发现：停 7 分钟、继续时按 5 分钟取整延长了 10 分钟；番茄个数要按原来的 15:00–16:30（3 个）算
    run = {"started_at": iso("15:00"), "pauses": [[iso("15:10"), iso("15:17")]], "done_at": None,
           "planned_start": "15:00", "planned_end": "16:30"}
    out = [(r["at"], r["title"]) for r in run_reminders([{**A, "end": "16:40"}], {"a": run}, {"a"}, at("15:20"), started)
           if r["kind"] == "pomodoro"]
    assert out[-1] == ("16:32", "休息 5 分钟") and len(out) == 5  # 3 次小歇 + 2 次回来


def test_no_pomodoro_reminder_after_block_end():
    # 评审发现：继续时被课截住，块结束在 09:00，却还在 09:45（上课时）提醒休息
    a = {**A, "start": "08:00", "end": "09:00"}
    run = {"started_at": iso("08:00"), "pauses": [[iso("08:10"), iso("08:50")]], "done_at": None,
           "planned_start": "08:00", "planned_end": "08:20"}
    out = [r for r in run_reminders([a], {"a": run}, {"a"}, at("08:51"), started) if r["kind"] == "pomodoro"]
    assert all(r["at"] <= "09:00" for r in out)
