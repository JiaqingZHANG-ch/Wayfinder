from datetime import date

import pytest

from server.db import Db

DAY = date(2026, 11, 20)


def log(day: str, note: str = "", items=None) -> dict:
    return {"date": day, "energy_after_class": 3, "items": items or {"english": {"status": "done"}},
            "blocker": "", "note": note, "tomorrow_task": "", "yesterday_done": None}


@pytest.fixture
def db(tmp_path):
    d = Db(tmp_path / "app.db")
    d.ensure_user(1)
    d.ensure_user(2)
    return d


def test_settings_round_trip_and_users_apart(db):
    db.set_plan_input(1, {"day": "2026-11-20", "habits": [{"id": "english", "title": "英语"}]})
    db.set_plan_input(1, {"day": "2026-11-21"})
    assert db.plan_input(1) == {"day": "2026-11-21"}
    assert db.plan_input(2) is None
    assert db.user_timezone(1) == "Europe/Paris"


def test_plans_get_versions_and_confirm(db):
    assert db.latest_plan(1, DAY) is None
    assert db.add_plan(1, DAY, {"blocks": []}, None) == 1
    assert db.add_plan(1, DAY, {"blocks": [1]}, 2) == 2
    assert db.add_plan(2, DAY, {"blocks": []}, None) == 1  # 别人的版本号各算各的
    latest = db.latest_plan(1, DAY)
    assert latest["version"] == 2 and latest["plan"] == {"blocks": [1]} and latest["energy_level"] == 2
    assert latest["confirmed_at"] is None
    assert db.confirm_plan(1, DAY, 2)
    assert db.latest_plan(1, DAY)["confirmed_at"] is not None
    assert not db.confirm_plan(1, DAY, 9)
    assert not db.confirm_plan(2, DAY, 2)


def test_logs_overwrite_same_day_and_stay_per_user(db):
    db.save_log(1, log("2026-11-19"))
    db.save_log(1, log("2026-11-20"))
    db.save_log(1, log("2026-11-20", note="第二次"))
    db.save_log(2, log("2026-11-20", note="别人的"))
    got = db.logs_between(1, date(2026, 11, 14), DAY)
    assert [g["date"] for g in got] == ["2026-11-19", "2026-11-20"]
    assert got[1]["note"] == "第二次" and got[1]["items"] == {"english": {"status": "done"}}


def test_quotes_must_be_verbatim_from_that_users_message(db):
    mid = db.add_message(1, DAY, "对账", "user", "英语完成，今天读得很顺。")
    db.add_quote(1, mid, "今天读得很顺", "对账", DAY)
    assert db.quotes(1) == [{"message_id": mid, "text": "今天读得很顺", "used_in": "对账", "day": "2026-11-20"}]
    with pytest.raises(ValueError):
        db.add_quote(1, mid, "今天读得挺顺", "对账", DAY)  # 改了字
    with pytest.raises(ValueError):
        db.add_quote(2, mid, "今天读得很顺", "对账", DAY)  # 不是自己的消息
    reply = db.add_message(1, DAY, "对账", "assistant", "今天读得很顺")
    with pytest.raises(ValueError):
        db.add_quote(1, reply, "今天读得很顺", "对账", DAY)  # 导师说的话不算用户原话
    with pytest.raises(ValueError):
        db.add_quote(1, mid, "今天读得很顺", "闲聊", DAY)
    assert len(db.quotes(1)) == 1 and db.quotes(2) == []


def test_crisis_logged_per_user(db):
    db.log_crisis(1, DAY, "……")
    assert db.crisis_count(1) == 1 and db.crisis_count(2) == 0


def test_loop3_days_with_note(db):
    db.save_log(1, log("2026-11-18", note="今天读得很顺"))
    db.save_log(1, log("2026-11-19"))
    db.save_log(1, log("2026-11-20", note="有点累"))
    db.save_log(2, log("2026-11-20", note="别人的"))
    assert db.days_with_note(1, date(2026, 11, 14), DAY) == ["2026-11-18", "2026-11-20"]
    assert db.days_with_note(1, date(2026, 11, 19), date(2026, 11, 19)) == []


def test_profiles_are_proposed_then_confirmed(db):
    pid = db.propose_profile(1, "方向", "想把法语练到能面试", "建档")
    assert db.profiles(1, confirmed=True) == []
    assert [p["content"] for p in db.profiles(1, confirmed=False)] == ["想把法语练到能面试"]
    assert not db.confirm_profile(2, pid)  # 别人确认不了
    assert db.confirm_profile(1, pid, content="把法语练到能用法语面试")  # 确认前可以改字
    got = db.profiles(1, confirmed=True)
    assert got[0]["content"] == "把法语练到能用法语面试" and got[0]["confirmed_at"] is not None
    assert db.profiles(1, confirmed=False) == [] and db.profiles(2, confirmed=True) == []
    for bad in [("焦虑", "x", "建档"), ("方向", "  ", "建档"), ("方向", "x", "聊天")]:
        with pytest.raises(ValueError):
            db.propose_profile(1, *bad)
    with pytest.raises(ValueError):
        db.confirm_profile(1, pid, content=" ")


def test_messages_by_mode(db):
    db.add_message(1, DAY, "建档", "user", "答一")
    db.add_message(1, DAY, "对账", "user", "别的")
    db.add_message(2, DAY, "建档", "user", "别人的")
    assert [m["content"] for m in db.messages(1, "建档")] == ["答一"]


def test_loop6_stalest_profile(db):
    import sqlite3
    a = db.propose_profile(1, "方向", "旧的", "建档")
    b = db.propose_profile(1, "目标", "新一点的", "建档")
    db.propose_profile(1, "目标", "还没确认的", "建档")
    db.confirm_profile(1, a)
    db.confirm_profile(1, b)
    with sqlite3.connect(db._path) as c:  # 把确认时间改到过去
        c.execute("UPDATE profiles SET confirmed_at = '2026-10-01T10:00:00+00:00' WHERE id = ?", (a,))
        c.execute("UPDATE profiles SET confirmed_at = '2026-11-01T10:00:00+00:00' WHERE id = ?", (b,))
    assert db.stalest_profile(1, DAY)["id"] == a
    assert db.stalest_profile(1, date(2026, 10, 10)) is None  # 都不到 14 天
    assert db.stalest_profile(2, DAY) is None

def test_export_and_delete_cover_every_table(tmp_path):
    import sqlite3
    from contextlib import closing

    from server.db import USER_TABLES
    Db(tmp_path / "x.db")
    with closing(sqlite3.connect(tmp_path / "x.db")) as c:
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert tables == set(USER_TABLES)  # 加了新表要加进 USER_TABLES，导出和删除才带得上


def test_deep_talk_upsert_and_read(tmp_path):
    db = Db(tmp_path / "app.db"); db.ensure_user(1)
    assert db.deep_talk_round(1) == 1 and db.deep_talk_rows(1, 1) == []
    db.upsert_deep_talk(1, 1, 1, answers={"scores": {"健康": 4}}, started_at="2026-11-21T20:00")
    db.upsert_deep_talk(1, 1, 1, finished_at="2026-11-21T20:08")
    row = db.deep_talk_rows(1, 1)[0]
    assert row["answers"] == {"scores": {"健康": 4}} and row["finished_at"] == "2026-11-21T20:08"
    with pytest.raises(ValueError):
        db.upsert_deep_talk(1, 1, 1, user_id=2)


def test_deep_talks_are_exported_and_deleted(tmp_path):
    db = Db(tmp_path / "app.db"); db.ensure_user(1)
    db.upsert_deep_talk(1, 1, 2, answers={"why": "换一份能养活自己的工作"})
    assert db.export(1)["deep_talks"][0]["answers"]["why"] == "换一份能养活自己的工作"
    db.delete_user(1)
    assert db.deep_talk_rows(1, 1) == []
