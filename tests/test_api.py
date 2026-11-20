import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from mentor.model import FakeModel
from mentor.safety import CRISIS_MESSAGE
from server.api import DEFAULT_TEMPLATE, create_app
from server.db import Db

TEMPLATE = json.loads(DEFAULT_TEMPLATE.read_text(encoding="utf-8"))  # 假用户「学生」：上下午各一节课


def at(hhmm: str):
    h, m = map(int, hhmm.split(":"))
    return lambda tz: datetime(2026, 11, 20, h, m, tzinfo=tz)


@pytest.fixture
def setup(tmp_path):
    db, model = Db(tmp_path / "app.db"), FakeModel()
    client = TestClient(create_app(db, model, template=TEMPLATE, now=at("21:00")))
    return client, db, model


def ids(plan: dict) -> set[str]:
    return {b["id"] for b in plan["blocks"]}


def test_today_is_generated_once_and_kept(setup):
    client, _, _ = setup
    first = client.get("/today").json()
    assert first["day"] == "2026-11-20" and first["version"] == 1 and not first["confirmed"]
    assert {"math", "physics", "english", "reading"} <= ids(first)
    assert any(b["kind"] == "proj" and b["task_id"] == "exam-prep" for b in first["blocks"])
    assert all(len(b["start"]) == 5 for b in first["blocks"])  # 时间是 HH:MM
    assert client.get("/today").json() == first


def test_energy_replans_tonight_as_new_unconfirmed_version(setup):
    client, _, _ = setup
    before = client.get("/today").json()
    after = client.post("/energy", json={"level": 2, "now": "18:00"}).json()
    assert after["version"] == 2 and after["energy_level"] == 2 and not after["confirmed"]
    kept = {b["id"] for b in before["blocks"] if b["start"] < "18:00" and b["kind"] != "life"}
    assert kept <= ids(after)  # 18:00 之前的课和已经做的事原样保留
    assert client.get("/today").json() == after


@pytest.mark.parametrize("body", [{"level": 0}, {"level": 6}, {"level": 3, "now": "6pm"}, {}])
def test_energy_rejects_bad_input(setup, body):
    assert setup[0].post("/energy", json=body).status_code == 422


def test_energy_with_unknown_done_id_is_422(setup):
    assert setup[0].post("/energy", json={"level": 3, "now": "18:00", "done_ids": ["nope"]}).status_code == 422


def test_confirm_only_the_latest_version(setup):
    client, _, _ = setup
    client.get("/today")
    client.post("/energy", json={"level": 4, "now": "18:00"})
    assert client.post("/plan/confirm", json={"version": 1}).status_code == 409
    ok = client.post("/plan/confirm", json={"version": 2})
    assert ok.status_code == 200 and ok.json()["confirmed"]


def test_checkin_with_buttons_saves_log_and_quote(setup):
    client, db, _ = setup
    r = client.post("/checkin", json={"result": {
        "energy_after_class": 3, "note": "今天读得很顺", "tomorrow_task": "做一套往年卷",
        "items": {"english": {"status": "done"}, "reading": {"status": "floor"},
                  "exam-prep": {"status": "done", "vs_plan": "less"}}}}).json()
    assert r["crisis"] is False and r["closing"] == "「今天读得很顺」"
    assert r["saved"]["items"]["reading"] == {"status": "floor"}
    assert [q["text"] for q in db.quotes(1)] == ["今天读得很顺"]
    week = client.get("/week").json()
    assert week["start"] == "2026-11-14" and week["end"] == "2026-11-20" and week["logged_days"] == 1
    assert {h["id"]: h["done_days"] for h in week["habits"]} == {"english": 1, "reading": 1}
    assert week["projects"] == [{"id": "exam-prep", "title": "高数期末复习", "less": 1, "same": 0, "more": 0}]


def test_checkin_without_note_closes_plainly(setup):
    r = setup[0].post("/checkin", json={"result": {"items": {"english": {"status": "skip"}}}}).json()
    assert r["closing"] == "今天记下了"
    assert setup[1].quotes(1) == []


@pytest.mark.parametrize("body", [
    {},
    {"result": {"items": {}}, "sentence": "英语完成"},
    {"result": {"items": {"french": {"status": "done"}}}},
    {"result": {"items": {"english": {"status": "done", "vs_plan": "more"}}}},
    {"sentence": "字" * 4001},
])
def test_checkin_rejects_bad_input(setup, body):
    client, db, _ = setup
    assert client.post("/checkin", json=body).status_code == 422
    assert client.get("/week").json()["logged_days"] == 0


def test_checkin_sentence_parsed_by_model(setup):
    client, db, model = setup
    model.replies.append(json.dumps({"energy_after_class": 3, "note": "",
                                     "items": {"english": {"status": "done"}, "reading": {"status": "floor"}}}))
    r = client.post("/checkin", json={"sentence": "英语完成 阅读保底 电量3"}).json()
    assert r["saved"]["energy_after_class"] == 3 and r["saved"]["items"]["reading"] == {"status": "floor"}
    assert r["closing"] == "今天记下了"
    allowed = set(model.calls[0]["schema"]["properties"]["items"]["properties"])
    assert {"english", "reading", "exam-prep"} <= allowed and "math" not in allowed  # 课不用对账


def test_checkin_sentence_model_unclear_saves_nothing(setup):
    client, _, model = setup
    model.replies.append("这不是 json")
    r = client.post("/checkin", json={"sentence": "英语完成"})
    assert r.status_code == 422 and "按钮" in r.json()["detail"]
    assert client.get("/week").json()["logged_days"] == 0


@pytest.mark.parametrize("body", [{"sentence": "今天累得不想活了"},
                                  {"result": {"items": {}, "note": "我想死"}}])
def test_crisis_in_user_words_skips_model_and_saves_no_log(setup, body):
    client, db, model = setup
    r = client.post("/checkin", json=body).json()
    assert r == {"crisis": True, "message": CRISIS_MESSAGE}
    assert model.calls == [] and db.crisis_count(1) == 1
    assert client.get("/week").json()["logged_days"] == 0


def test_crisis_flagged_by_model(setup):
    client, db, model = setup
    model.replies.append('{"crisis": true}')
    assert client.post("/checkin", json={"sentence": "有点说不出口"}).json()["crisis"] is True
    assert db.crisis_count(1) == 1


def test_no_settings_and_no_template(tmp_path):
    client = TestClient(create_app(Db(tmp_path / "app.db"), FakeModel(), now=at("08:00")))
    r = client.get("/today")
    assert r.status_code == 409 and "建档" in r.json()["detail"]


# ---- 审阅后补的 ----
def test_energy_after_midnight_is_refused(tmp_path):
    from datetime import datetime as dt
    client = TestClient(create_app(Db(tmp_path / "a.db"), FakeModel(), template=TEMPLATE,
                                   now=lambda tz: dt(2026, 11, 21, 1, 0, tzinfo=tz)))
    assert client.post("/energy", json={"level": 2}).status_code == 409


@pytest.mark.parametrize("now", ["99:99", "24:00", "18:60"])
def test_energy_rejects_impossible_time(setup, now):
    assert setup[0].post("/energy", json={"level": 2, "now": now}).status_code == 422


def test_lone_surrogate_is_422_not_500(setup):
    client = setup[0]
    body = '{"result": {"items": {}, "note": "\\ud800"}}'
    r = client.post("/checkin", content=body, headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_model_output_with_lone_surrogate_saves_nothing(setup):
    client, _, model = setup
    model.replies.append('{"items": {}, "note": "", "blocker": "\\ud800"}')
    assert client.post("/checkin", json={"sentence": "英语完成"}).status_code == 422
    assert client.get("/week").json()["logged_days"] == 0


def test_sentence_adds_to_earlier_buttons_instead_of_replacing(setup):
    client, db, model = setup
    client.post("/checkin", json={"result": {"energy_after_class": 3, "note": "按钮那次写的",
                                             "items": {"english": {"status": "done"}}}})
    model.replies.append(json.dumps({"items": {"reading": {"status": "done"}}, "note": "今天看书感觉不错"}))
    r = client.post("/checkin", json={"sentence": "今天看书感觉不错"}).json()
    assert r["saved"]["items"] == {"english": {"status": "done"}, "reading": {"status": "done"}}
    assert r["saved"]["energy_after_class"] == 3 and r["closing"] == "「今天看书感觉不错」"
    model.replies.append(json.dumps({"items": {}, "note": ""}))  # 这次没有原话：不引用旧的
    assert client.post("/checkin", json={"sentence": "就这样"}).json()["closing"] == "今天记下了"
    assert [q["text"] for q in db.quotes(1)] == ["按钮那次写的", "今天看书感觉不错"]


@pytest.mark.parametrize("path, body", [
    ("/checkin", {"result": {"items": {"我想死": {"status": "done"}}}}),
    ("/energy", {"level": 2, "now": "18:00", "done_ids": ["不想活了"]}),
])
def test_crisis_words_anywhere_in_request(setup, path, body):
    client, db, model = setup
    assert client.post(path, json=body).json() == {"crisis": True, "message": CRISIS_MESSAGE}
    assert db.crisis_count(1) == 1 and model.calls == []


def test_first_plan_of_the_day_is_not_duplicated(tmp_path):
    from datetime import date
    db = Db(tmp_path / "a.db")
    db.ensure_user(1)
    day = date(2026, 11, 20)
    assert db.add_plan(1, day, {"blocks": []}, None, only_if_none=True) == 1
    assert db.add_plan(1, day, {"blocks": [1]}, None, only_if_none=True) == 1
    assert db.latest_plan(1, day)["plan"] == {"blocks": []}