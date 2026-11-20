import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from mentor.model import FakeModel
from mentor.onboarding import QUESTIONS
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
    today = client.get("/today").json()
    assert {k: v for k, v in today.items() if k != "reminders"} == after


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

def test_expo_web_origin_allowed_others_not(setup):
    client = setup[0]
    ok = client.options("/checkin", headers={"Origin": "http://localhost:8081", "Access-Control-Request-Method": "POST",
                                             "Access-Control-Request-Headers": "content-type"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert client.get("/today", headers={"Origin": "http://localhost:8081"}).headers[
        "access-control-allow-origin"] == "http://localhost:8081"
    assert "access-control-allow-origin" not in client.get("/today", headers={"Origin": "https://evil.example"}).headers

# ---- 第 4 周：建档、档案、设置 ----
SETTINGS = {"wake": "07:30", "sleep": "23:30",
            "habits": [{"title": "练法语", "minutes": 30, "floor_min": 10, "energy": "recharge"}]}


@pytest.fixture
def new_user(tmp_path):
    db, model = Db(tmp_path / "new.db"), FakeModel()
    return TestClient(create_app(db, model, now=at("09:00"))), db, model


def test_new_user_goes_from_onboarding_to_first_plan(new_user):
    client, db, model = new_user
    assert client.get("/today").status_code == 409
    first = client.post("/onboarding", json={}).json()
    assert first == {"crisis": False, "done": False, "reply": None, "question": QUESTIONS[0]}
    model.replies.append('{"reply": "图书馆那天你记得很清楚。"}')
    r = client.post("/onboarding", json={"answer": "上周六在图书馆读完一本书"}).json()
    assert r["reply"] == "图书馆那天你记得很清楚。" and r["question"] == QUESTIONS[1]
    model.replies.append('{"reply": "记下了。", "direction": "多花时间练法语"}')
    r = client.post("/onboarding", json={"answer": "练法语"}).json()
    assert r["done"] and [p["content"] for p in r["proposals"]] == ["多花时间练法语"]
    assert "上周六在图书馆读完一本书" in model.calls[1]["messages"][1]["content"]  # 最后一轮带上前面的原话
    pid = r["proposals"][0]["id"]
    assert client.get("/profile").json()["confirmed"] == []  # 没确认不算数
    got = client.post("/profile/confirm", json={"id": pid, "content": "把法语练到能面试"}).json()
    assert [p["content"] for p in got["confirmed"]] == ["把法语练到能面试"] and got["pending"] == []
    assert client.post("/onboarding", json={"answer": "再答一次"}).json()["done"]  # 问完了不再问

    assert client.put("/settings", json=SETTINGS).json() == {**SETTINGS, "reminders": {"after_class": True, "evening": "21:00"}}
    plan = client.get("/today").json()
    assert any(b["title"] == "练法语" for b in plan["blocks"])
    raw = db.plan_input(1)
    assert raw["energy"]["cost"]["habit-1"] == 0.5 and raw["habits"][0]["floor_min"] == 10


def test_settings_change_replaces_todays_plan_and_keeps_other_parts(setup):
    client, db, _ = setup
    v1 = client.get("/today").json()
    assert client.get("/settings").json()["habits"][0]["energy"] is None  # 模板里的消耗值不是三档之一
    client.put("/settings", json={**SETTINGS, "wake": "07:00", "sleep": "23:00"})
    v2 = client.get("/today").json()
    assert v2["version"] == v1["version"] + 1
    assert "math" in {b["id"] for b in v2["blocks"]}  # 模板里的课还在
    assert {"english", "reading"}.isdisjoint(b["id"] for b in v2["blocks"])  # 旧习惯换掉了
    assert "habit_block" not in db.plan_input(1)


@pytest.mark.parametrize("body", [
    {**SETTINGS, "wake": "7:30"},
    {**SETTINGS, "habits": []},
    {**SETTINGS, "habits": [{"title": "x", "minutes": 10, "floor_min": 20}]},
    {**SETTINGS, "habits": [{"title": "x", "minutes": 10, "floor_min": 5, "energy": "happy"}]},
    {**SETTINGS, "wake": "23:00", "sleep": "07:00"},
    {**SETTINGS, "habits": [{"title": "x", "minutes": 180, "floor_min": 5}] * 3, "wake": "20:00", "sleep": "22:00"},
])
def test_bad_or_unsolvable_settings_are_not_saved(new_user, body):
    client, db, _ = new_user
    assert client.put("/settings", json=body).status_code == 422
    assert db.plan_input(1) is None


def test_crisis_in_onboarding_answer_skips_model(new_user):
    client, db, model = new_user
    client.post("/onboarding", json={})
    r = client.post("/onboarding", json={"answer": "我不想活了"}).json()
    assert r["crisis"] and model.calls == [] and db.messages(1, "建档") == []


def test_crisis_in_model_output_during_onboarding(new_user):
    client, db, model = new_user
    model.replies.append('{"crisis": true}')
    assert client.post("/onboarding", json={"answer": "说不清"}).json()["crisis"]
    assert db.crisis_count(1) == 1 and db.messages(1, "建档") == []


def test_confirm_unknown_profile_is_404(new_user):
    assert new_user[0].post("/profile/confirm", json={"id": 99}).status_code == 404

# ---- 第 5 周：两条本地提醒 ----
def test_today_carries_two_reminders(setup):
    r = setup[0].get("/today").json()["reminders"]
    assert [(x["kind"], x["at"], x["url"]) for x in r] == [("after_class", "16:00", "/energy"), ("evening", "21:00", "/checkin")]


def test_reminders_follow_settings(new_user):
    client = new_user[0]
    body = {**SETTINGS, "reminders": {"after_class": True, "evening": "20:30"}}
    client.put("/settings", json=body)
    assert [(x["kind"], x["at"]) for x in client.get("/today").json()["reminders"]] == [("evening", "20:30")]  # 没课就没有下课那条
    client.put("/settings", json={**SETTINGS, "reminders": {"after_class": False, "evening": None}})
    assert client.get("/today").json()["reminders"] == []
    assert client.put("/settings", json={**SETTINGS, "reminders": {"evening": "9pm"}}).status_code == 422

def seed_week(db, last_day=20, days=7):
    for d in range(last_day - days + 1, last_day + 1):
        db.save_log(1, {"date": f"2026-11-{d:02d}", "energy_after_class": 3, "blocker": "", "tomorrow_task": "",
                        "note": "今天读得很顺" if d == last_day else "", "yesterday_done": None,
                        "items": {"reading": {"status": "done"}, "english": {"status": "skip" if d % 2 else "done"}}})


REVIEW = json.dumps({"summary": "这 7 天记录了 7 天。「看书」做了 7 天，11 月 20 日你写「今天读得很顺」。",
                     "adjustments": [{"kind": "minutes", "habit_id": "english", "value": 15, "why": "有 3 天没做。"},
                                     {"kind": "add_habit", "title": "散步", "value": 20, "why": "看书很稳。"}],
                     "question": "下周哪天最容易被课拖住？"}, ensure_ascii=False)


def test_review_appears_after_seven_days(setup):
    client, db, model = setup
    seed_week(db, days=6)
    assert client.get("/week").json()["review"] is None
    assert client.post("/review", json={}).status_code == 409
    seed_week(db)
    assert client.get("/week").json()["review"] == "due"
    model.replies.append(REVIEW)
    r = client.post("/review", json={}).json()
    assert r["summary"].startswith("这 7 天记录了 7 天") and r["question"] == "下周哪天最容易被课拖住？"
    assert r["stats"]["habits"][1] == {"id": "english", "title": "背单词", "done_days": 4, "floor_days": 0, "skip_days": 3}
    assert [a["answer"] for a in r["adjustments"]] == [None, None]
    assert r["still_right"] is None and r["last_question"] is None
    assert client.post("/review", json={}).json() == r  # 同一天再点，拿到的是同一份，不再问模型
    assert len(model.calls) == 1 and client.get("/week").json()["review"] == "today"


def test_review_adjustment_only_written_on_yes(setup):
    client, db, model = setup
    seed_week(db)
    model.replies.append(REVIEW)
    rid = client.post("/review", json={}).json()["id"]
    before = client.get("/today").json()["version"]
    r = client.post("/review", json={"id": rid, "index": 1, "accept": False}).json()
    assert [a["answer"] for a in r["adjustments"]] == [None, "先不改"]
    assert len(db.plan_input(1)["habits"]) == 2 and client.get("/today").json()["version"] == before
    r = client.post("/review", json={"id": rid, "index": 0, "accept": True}).json()
    assert r["adjustments"][0]["answer"] == "好"
    assert next(h for h in db.plan_input(1)["habits"] if h["id"] == "english")["minutes"] == 15
    assert client.get("/today").json()["version"] == before + 1  # 今天的计划跟着重排
    assert client.post("/review", json={"id": rid, "index": 0, "accept": False}).status_code == 409  # 不能改口
    assert client.post("/review", json={"id": rid, "index": 2, "accept": True}).status_code == 409
    assert client.post("/review", json={"id": rid + 1, "index": 0, "accept": True}).status_code == 409
    assert client.post("/review", json={"id": rid, "index": 0}).status_code == 422


def test_review_falls_back_when_model_misbehaves(setup):
    client, db, model = setup
    seed_week(db)
    model.replies += [REVIEW.replace("7 天。", "8 天。")] * 2  # 改了数字，两次都不合格
    r = client.post("/review", json={}).json()
    assert r["adjustments"] == [] and r["summary"].startswith("这 7 天记录了 7 天。「看书」做了 7 天。")
