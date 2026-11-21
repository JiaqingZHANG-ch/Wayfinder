from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from mentor.model import FakeModel
from server.api import create_app
from server.db import Db
from test_deep_talk_api import CARDS, RATE, STEP4, STEPS_1_3, TEMPLATE, VERSIONS, finish_step4, walk


@pytest.fixture
def setup(tmp_path):
    db, model, today = Db(tmp_path / "app.db"), FakeModel(), [date(2026, 11, 20)]  # today 可以改：模拟过了几天
    clock = lambda tz: datetime(today[0].year, today[0].month, today[0].day, 21, 0, tzinfo=tz)
    return TestClient(create_app(db, model, template=TEMPLATE, now=clock, cards=CARDS)), db, model, today


def lenses(k):  # 每个视角、每个版本的 unknown 都不一样，才分得出取的是哪一个
    return {"lenses": [{"title": t, "versions": [{"sees": "s", "unknown": f"{t}说版本{i}的未知", "test": "t"} for i in range(3)]}
                       for t in ("甲", "乙", "丙", "丁")], "disagreement": "d"}


def with_obstacles(client, db, model, choose):
    walk(client, STEPS_1_3 + VERSIONS + [(4, "council", True), (4, "rate", RATE)])
    db.upsert_deep_talk(1, 1, 4, council=lenses(0), council_status="done")
    model.replies.append(STEP4)
    return walk(client, [(4, "choose", choose)])


def accept_prototype(client):
    client.post("/deep-talk/confirm", json={"kind": "habit", "key": "prototype", "accept": True})


def test_obstacles_are_unknowns_of_chosen_version(setup):
    client, db, model, _ = setup
    s = with_obstacles(client, db, model, 1)
    got = [p["content"] for p in s["proposals"]["profiles"] if p["level"] == "障碍"]
    assert got == ["甲说版本1的未知", "乙说版本1的未知", "丙说版本1的未知"]  # 最多 3 条，原文不改
    assert all(p["source"] == "深度长谈" for p in db.profiles(1, confirmed=False))


def test_no_obstacles_without_choice_or_council(setup):
    client, db, model, _ = setup
    s = with_obstacles(client, db, model, None)
    assert [p for p in s["proposals"]["profiles"] if p["level"] == "障碍"] == []
    assert [p for p in db.profiles(1, confirmed=False) if p["level"] == "障碍"] == []


def test_no_obstacles_when_council_missing(setup):
    client, db, model, _ = setup
    finish_step4(client, model)  # 选了版本，但智囊团没跑过
    assert [p for p in db.profiles(1, confirmed=False) if p["level"] == "障碍"] == []


def test_letter_ask_once(setup):
    client, _, model, _ = setup
    assert client.get("/deep-talk").json()["letter_ask"] is False
    assert finish_step4(client, model)["letter_ask"] is True
    r = client.post("/letters", json={"days": 30, "text": "  给三十天后的我  "})
    assert r.status_code == 200 and client.get("/deep-talk").json()["letter_ask"] is False


def test_letter_decline_stops_asking(setup):
    client, _, model, _ = setup
    finish_step4(client, model)
    assert client.post("/letters/decline").json()["letter_ask"] is False
    assert client.get("/letters").json() == {"letters": []}


def test_letter_validation_and_crisis(setup):
    client, db, model, _ = setup
    finish_step4(client, model)
    assert client.post("/letters", json={"days": 7, "text": "x"}).status_code == 422
    assert client.post("/letters", json={"days": 30, "text": "   "}).status_code == 422
    assert client.post("/letters", json={"days": 30, "text": "字" * 5000}).status_code == 422
    r = client.post("/letters", json={"days": 30, "text": "我不想活了"}).json()
    assert r["crisis"] is True and db.letters(1) == [] and db.crisis_count(1) == 1
    assert client.get("/deep-talk").json()["letter_ask"] is True  # 危机时什么都不记


def test_sealed_then_open_with_numbers(setup):
    client, db, model, today = setup
    finish_step4(client, model)
    accept_prototype(client)
    habit = next(h for h in db.plan_input(1)["habits"] if h["title"] == "写一段代码")["id"]
    client.post("/letters", json={"days": 30, "text": "加油"})
    [sealed] = client.get("/letters").json()["letters"]
    assert sealed == {"id": 1, "written_on": "2026-11-20", "due": "2026-12-20", "days": 30, "status": "sealed"}
    for day, status in [("2026-11-21", "done"), ("2026-11-22", "floor"), ("2026-11-23", "skip"), ("2026-12-20", "done")]:
        db.save_log(1, {"date": day, "energy_after_class": None, "items": {habit: {"status": status}}, "blocker": "",
                        "note": "", "tomorrow_task": "", "yesterday_done": None})
    today[0] = date(2026, 12, 20)
    [letter] = client.get("/letters").json()["letters"]
    assert letter["status"] == "open" and letter["text"] == "加油" and letter["prototype"] == "写一段代码"
    assert (letter["logged_days"], letter["done_days"], letter["span_days"]) == (4, 3, 30)


def test_open_letter_without_habit_has_null_done_days(setup):
    client, db, model, today = setup
    finish_step4(client, model)  # 没接受原型习惯
    client.post("/letters", json={"days": 30, "text": "信"})
    today[0] = date(2026, 12, 25)
    [letter] = client.get("/letters").json()["letters"]
    assert letter["prototype"] is None and letter["done_days"] is None and letter["logged_days"] == 0


def test_reminder_until_due_day(setup):
    client, _, model, today = setup
    finish_step4(client, model)
    client.post("/letters", json={"days": 30, "text": "信"})
    later = client.get("/today").json()["later_reminders"]
    [r] = [x for x in later if x["kind"] == "letter"]
    assert (r["day"], r["at"], r["url"]) == ("2026-12-20", "09:00", "/letter")
    today[0] = date(2026, 12, 20)  # 到期当天早上打开 App 重排提醒：9 点那条还要在
    assert [x["day"] for x in client.get("/today").json()["later_reminders"] if x["kind"] == "letter"] == ["2026-12-20"]
    today[0] = date(2026, 12, 21)
    assert [x for x in client.get("/today").json()["later_reminders"] if x["kind"] == "letter"] == []


def test_letters_exported_and_deleted(setup):
    client, db, model, _ = setup
    finish_step4(client, model)
    client.post("/letters", json={"days": 90, "text": "信"})
    assert db.export(1)["letters"][0]["text"] == "信"
    db.delete_user(1)
    assert db.export(1)["letters"] == []
