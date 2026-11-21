import json
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from mentor.model import FakeModel
from server.api import AREAS, create_app
from mentor.tone import banned_hits
from server.db import Db
from test_deep_talk_api import CARDS, TEMPLATE


@pytest.fixture
def setup(tmp_path):
    db, today = Db(tmp_path / "app.db"), [date(2026, 11, 20)]
    clock = lambda tz: datetime(today[0].year, today[0].month, today[0].day, 21, 0, tzinfo=tz)
    model = FakeModel()
    client = TestClient(create_app(db, model, template=TEMPLATE, now=clock, cards=CARDS))
    client.model = model  # 测试里往它的 replies 里塞回答
    return client, db, today


def body(**over):
    b = {"scores": {a: 5 for a in AREAS}, "focus": "健康", "start": "跑步", "stop": "", "keep": "",
         "goals": [{"text": "每周跑两次", "check": "跑了几次"}]}
    return {**b, **over}


def log(db, day):
    db.save_log(1, {"date": day, "energy_after_class": None, "items": {}, "blocker": "", "note": "", "tomorrow_task": "",
                    "yesterday_done": None})


def test_valid_post_saves_and_goals_become_confirmed_profiles(setup):
    client, db, _ = setup
    r = client.post("/quarter", json=body(extra_area=" 写作 ", scores={**{a: 5 for a in AREAS}, "写作": 7},
                                          goals=[{"text": " 每周跑两次 ", "check": "跑了几次"}])).json()
    assert r["focus"] == "健康" and r["scores"]["写作"] == 7 and r["goals"] == [{"text": "每周跑两次", "check": "跑了几次"}]
    assert db.profiles(1, confirmed=False) == []
    [p] = db.profiles(1, confirmed=True)
    assert (p["level"], p["source"], p["content"]) == ("目标", "季度回顾", "每周跑两次（每周看：跑了几次）")
    assert client.get("/quarter").json()["last"]["id"] == r["id"]


@pytest.mark.parametrize("bad", [
    body(scores={a: 5 for a in AREAS[:5]}),  # 少一项
    body(scores={**{a: 5 for a in AREAS}, "写作": 5}),  # 多一项但没声明 extra_area
    body(scores={**{a: 5 for a in AREAS}, "健康": 11}),
    body(scores={**{a: 5 for a in AREAS}, "健康": -1}),
    body(scores={**{a: 5 for a in AREAS}, "健康": 5.5}),
    body(extra_area="写", scores={**{a: 5 for a in AREAS}, "写": 5}),  # 少于 2 字
    body(extra_area="一二三四五六七八九", scores={**{a: 5 for a in AREAS}, "一二三四五六七八九": 5}),
    body(extra_area="钱"),  # 和默认重复
    body(extra_area="写作"),  # 声明了但没打分
    body(focus="写作"),
    body(start="", stop="", keep="  "),
    body(start="字" * 5000),
    body(goals=[]),
    body(goals=[{"text": "a", "check": "b"}] * 4),
    body(goals=[{"text": " ", "check": "b"}]),
    body(goals=[{"text": "a", "check": ""}]),
    body(goals=[{"text": "字" * 61, "check": "b"}]),
    body(goals=[{"text": "a", "check": "字" * 61}]),
])
def test_validation_rejects(setup, bad):
    client, db, _ = setup
    r = client.post("/quarter", json=bad)
    assert r.status_code == 422 and banned_hits(r.json()["detail"]) == []
    assert db.last_quarter(1) is None and db.profiles(1, confirmed=True) == []


def test_crisis_stores_nothing(setup):
    client, db, _ = setup
    r = client.post("/quarter", json=body(stop="我不想活了")).json()
    assert r["crisis"] is True and db.last_quarter(1) is None and db.crisis_count(1) == 1
    assert db.profiles(1, confirmed=True) == []


def test_available_needs_90_days_of_logs(setup):
    client, db, today = setup
    assert client.get("/quarter").json()["available"] is False  # 还没有对账
    log(db, "2026-08-22")  # 到 11-20 是 90 天
    q = client.get("/quarter").json()
    assert (q["available"], q["days_used"], q["areas"], q["last"]) == (True, 90, list(AREAS), None)
    db._run(lambda c: c.execute("UPDATE day_logs SET day = '2026-08-23'"))  # 89 天
    q = client.get("/quarter").json()
    assert (q["available"], q["days_used"]) == (False, 89)


def test_available_needs_84_days_since_last(setup):
    client, db, today = setup
    log(db, "2026-01-01")
    client.post("/quarter", json=body())
    today[0] = date(2027, 2, 11)  # 83 天后
    assert client.get("/quarter").json()["available"] is False
    today[0] = date(2027, 2, 12)  # 84 天后
    assert client.get("/quarter").json()["available"] is True


def test_exported_and_deleted(setup):
    client, db, _ = setup
    client.post("/quarter", json=body())
    assert db.export(1)["quarterly_reviews"][0]["goals"][0]["check"] == "跑了几次"
    db.delete_user(1)
    assert db.last_quarter(1) is None


def test_crisis_beats_validation(setup):
    client, db, _ = setup
    r = client.post("/quarter", json=body(scores={}, stop="我不想活了")).json()
    assert r["crisis"] is True and db.crisis_count(1) == 1 and db.last_quarter(1) is None


def test_new_review_replaces_old_quarter_goals(setup):
    client, db, _ = setup
    other = db.propose_profile(1, "目标", "长谈的目标", "深度长谈")
    db.confirm_profile(1, other)
    client.post("/quarter", json=body())
    client.post("/quarter", json=body(goals=[{"text": "每周读书", "check": "读了几章"}]))
    assert [(p["content"], p["source"]) for p in db.profiles(1, confirmed=True)] == [
        ("长谈的目标", "深度长谈"), ("每周读书（每周看：读了几章）", "季度回顾")]
    assert len(db.export(1)["quarterly_reviews"]) == 2  # 原文都还在
    assert set(client.get("/quarter").json()["last"]) == {"id", "day", "scores", "focus", "start", "stop", "keep", "goals", "council", "council_status"}


LENS = json.dumps({"sees": "你写得很具体", "unknown": "能不能坚持", "test": "这个月跑 3 次"}, ensure_ascii=False)
SYNTH = json.dumps({"disagreement": "视角甲看重稳定，视角乙看重兴趣"}, ensure_ascii=False)


def test_council_needs_a_review(setup):
    assert setup[0].post("/quarter/council").status_code == 409


def test_council_runs_in_background_and_shows_in_last(setup):
    client, _, _ = setup
    client.post("/quarter", json=body())
    client.model.replies += [LENS, LENS, SYNTH]
    assert client.post("/quarter/council").json() == {"status": "running"}
    client.app.state.quarter_thread.join()
    last = client.get("/quarter").json()["last"]
    assert last["council_status"] == "done" and last["council"]["disagreement"] == "视角甲看重稳定，视角乙看重兴趣"
    assert len(last["council"]["lenses"]) >= 2 and set(last["council"]["lenses"][0]) == {"title", "sees", "unknown", "test"}
    calls = len(client.model.calls)
    assert client.post("/quarter/council").json() == {"status": "done"}  # 开过了就不再开
    assert len(client.model.calls) == calls


def test_council_failed_can_retry(setup):
    client, _, _ = setup
    client.post("/quarter", json=body())
    client.post("/quarter/council")
    client.app.state.quarter_thread.join()
    last = client.get("/quarter").json()["last"]
    assert (last["council_status"], last["council"]) == ("failed", None)
    client.model.replies += [LENS, LENS, SYNTH]
    assert client.post("/quarter/council").json() == {"status": "running"}
    client.app.state.quarter_thread.join()


def test_council_crisis_shows_only_fixed_message(setup):
    client, db, _ = setup
    client.post("/quarter", json=body())
    client.model.replies.append(json.dumps({"crisis": True}))
    client.post("/quarter/council")
    client.app.state.quarter_thread.join()
    last = client.get("/quarter").json()["last"]
    assert last["council_status"] == "crisis" and last["council"] is None and "请现在联系能帮到你的人" in last["message"]
    assert db.crisis_count(1) == 1
    # 危机以后再点：和深度长谈一样可以重跑（本机模型偶尔把平常的话误判成危机）
    assert client.post("/quarter/council").json()["status"] == "running"
    client.app.state.quarter_thread.join()
