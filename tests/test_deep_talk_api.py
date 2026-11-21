import json
import threading
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from mentor.council import Card
from mentor.model import FakeModel
from server.api import DEFAULT_TEMPLATE, create_app
from server.db import Db

TEMPLATE = json.loads(DEFAULT_TEMPLATE.read_text(encoding="utf-8"))  # 假用户：两个习惯 reading、english
CARDS = [Card("a", "视角甲", "方向与职业", "卡片甲"), Card("b", "视角乙", "习惯养成", "卡片乙")]
LENS = json.dumps({"versions": [{"sees": "你写得很具体", "unknown": "能不能找到实习", "test": "这个月投 3 份申请"}] * 3},
                  ensure_ascii=False)
SYNTH = json.dumps({"disagreement": "视角甲看重稳定，视角乙看重兴趣"}, ensure_ascii=False)
STEP4 = json.dumps({"mission": "做出自己用得上的 AI 应用", "goals": ["每周投出 2 份实习申请"],
                    "prototype": {"title": "写一段代码", "minutes": 30, "floor_min": 10},
                    "tomorrow": "投一份实习申请"}, ensure_ascii=False)

# 走流程用的回答；模型没准备回答时，导师的回应和提议都走兜底
STEPS_1_3 = [(1, "scores", {"健康": 4, "学习或工作": 7, "玩": 5}), (1, "lift", "健康，最近总是很累"),
             (1, "more_time", "运动"), (2, "why", "找到一份做 AI 应用的实习"), (2, "worth", "做出一个自己用得上的东西"),
             (3, "flow", "写代码"), (3, "follow", {"和谁": "一个人"}), (3, "energy", {})]
VERSIONS = [(4, "v1", "在一家公司做 AI 应用开发"), (4, "v2", "去做数据分析"), (4, "v3", "开一家小书店")]


def at(hhmm: str):
    h, m = map(int, hhmm.split(":"))
    return lambda tz: datetime(2026, 11, 20, h, m, tzinfo=tz)


@pytest.fixture
def setup(tmp_path):
    db, model = Db(tmp_path / "app.db"), FakeModel()
    client = TestClient(create_app(db, model, template=TEMPLATE, now=at("21:00"), cards=CARDS))
    return client, db, model


def answer(client, step, screen, value):
    return client.post("/deep-talk/answer", json={"step": step, "screen": screen, "value": value})


def walk(client, steps):
    for step, screen, value in steps:
        r = answer(client, step, screen, value)
        assert r.status_code == 200, r.json()
    return r.json()


def finish_step4(client, model, choose=0):
    """写完三个版本、看过智囊团、打完分、选一个；step 4 的提议用 STEP4。"""
    walk(client, STEPS_1_3 + VERSIONS + [(4, "council", True), (4, "rate", RATE)])
    model.replies.append(STEP4)
    return walk(client, [(4, "choose", choose)])


RATE = {k: {"资源": 3, "喜欢": 4, "信心": 2, "和自己一致": 5} for k in ("0", "1", "2")}


def reply(text):
    return json.dumps({"reply": text}, ensure_ascii=False)


def test_step1_end_to_end_proposes_observation(setup):
    client, db, model = setup
    s = client.get("/deep-talk").json()
    assert (s["round"], s["step"], s["screen"]) == (1, 1, "scores")
    assert [x["status"] for x in s["steps"]] == ["todo"] * 4 and s["screens"]["1"]["name"] == "现状"
    assert answer(client, 1, "scores", {"健康": 4, "学习或工作": 7, "玩": 5}).json()["screen"] == "lift"  # 关系跳过
    model.replies.append(reply("你在意的是身体。"))
    r = answer(client, 1, "lift", "健康，最近总是很累").json()
    assert r["reply"] == "你在意的是身体。" and r["screen"] == "more_time" and r["steps"][0]["status"] == "doing"
    model.replies += [reply("记下了。"), json.dumps({"observation": "你最想让健康往上走一点"}, ensure_ascii=False)]
    r = answer(client, 1, "more_time", "运动").json()
    assert (r["step"], r["screen"]) == (2, "why") and r["steps"][0]["status"] == "done"
    [p] = r["proposals"]["profiles"]
    assert (p["level"], p["source"], p["content"]) == ("近期观察", "深度长谈", "你最想让健康往上走一点")
    # 「不要」：不确认，也不再显示；档案里仍是待确认
    r = client.post("/deep-talk/confirm", json={"kind": "profile", "id": p["id"], "accept": False}).json()
    assert r["proposals"]["profiles"] == [] and [x["id"] for x in db.profiles(1, confirmed=False)] == [p["id"]]


def test_resume_after_close(setup):
    client, _, _ = setup
    walk(client, STEPS_1_3[:2])
    s = client.get("/deep-talk").json()
    assert s["screen"] == "more_time" and s["reply"] is None
    assert s["answers"]["1"]["lift"] == "健康，最近总是很累" and s["answers"]["1"]["scores"]["健康"] == 4


def test_wrong_screen_is_409(setup):
    client, _, _ = setup
    assert answer(client, 1, "lift", "健康").status_code == 409
    assert answer(client, 2, "why", "实习").status_code == 409
    assert client.post("/deep-talk/council").status_code == 409  # 三个版本还没写
    assert answer(client, 1, "scores", {"健康": 11, "学习或工作": 7, "玩": 5}).status_code == 422
    assert answer(client, 1, "scores", {"健康": 4, "玩": 5}).status_code == 422  # 只有「关系」能跳过
    assert client.get("/deep-talk").json()["answers"] == {}


def test_crisis_in_version_stores_nothing(setup):
    client, db, _ = setup
    walk(client, STEPS_1_3 + VERSIONS[:1])
    r = answer(client, 4, "v2", "这条路走不通我就不想活了").json()
    assert r["crisis"] is True
    s = client.get("/deep-talk").json()
    assert "v2" not in s["answers"]["4"] and s["screen"] == "v2" and db.crisis_count(1) == 1


def test_energy_screen_rewrites_settings_and_replans(setup):
    client, _, _ = setup
    walk(client, STEPS_1_3[:7])
    s = client.get("/deep-talk").json()
    assert s["screen"] == "energy"
    assert {(i["id"], i["kind"]) for i in s["energy_items"]} == {("reading", "habit"), ("english", "habit"),
                                                                  ("exam-prep", "project")}
    before = client.get("/today").json()["version"]
    r = answer(client, 3, "energy", {"reading": "drain", "english": "love"}).json()
    assert r["step"] == 4 and r["answers"]["3"]["loved"] == ["背单词"]
    habits = {h["id"]: h["energy"] for h in client.get("/settings").json()["habits"]}
    assert habits == {"reading": "drain", "english": "love"}
    assert client.get("/today").json()["version"] == before + 1
    assert answer(client, 4, "v1", "x").status_code == 200
    assert answer(client, 3, "energy", {"nope": "love"}).status_code == 409  # 第 3 步已经做完


def test_council_runs_in_background_and_is_polled(setup):
    client, _, model = setup
    walk(client, STEPS_1_3 + VERSIONS)
    model.replies += [LENS, LENS, SYNTH]
    r = client.post("/deep-talk/council").json()
    assert r["council"] == {"status": "running", "result": None}
    client.app.state.deep_talk_thread.join()
    c = client.get("/deep-talk").json()["council"]
    assert c["status"] == "done" and c["result"]["disagreement"] == "视角甲看重稳定，视角乙看重兴趣"
    assert len(c["result"]["lenses"]) >= 2 and all(len(x["versions"]) == 3 for x in c["result"]["lenses"])
    calls = len(model.calls)
    assert client.post("/deep-talk/council").json()["council"]["status"] == "done"  # 开过了就不再开
    assert len(model.calls) == calls


def test_council_failed_flow_continues(setup):
    client, _, _ = setup
    walk(client, STEPS_1_3 + VERSIONS)
    client.post("/deep-talk/council")
    client.app.state.deep_talk_thread.join()
    assert client.get("/deep-talk").json()["council"] == {"status": "failed", "result": None}
    s = walk(client, [(4, "council", True), (4, "rate", RATE), (4, "choose", 1)])
    assert s["step"] is None and s["steps"][3]["status"] == "done"
    # 模型没回答：使命用选中版本的原话
    assert [(p["level"], p["content"]) for p in s["proposals"]["profiles"] if p["level"] == "使命"] == [("使命", "去做数据分析")]


def test_accept_habit_when_full_is_409(setup):
    client, _, model = setup
    settings = client.get("/settings").json()
    settings["habits"].append({"title": "冥想", "minutes": 10, "floor_min": 5})
    assert client.put("/settings", json=settings).status_code == 200
    s = finish_step4(client, model)
    assert s["habits_full"] is True
    assert [(h["key"], h["source"]) for h in s["proposals"]["habits"]] == [("prototype", "deep_talk")]  # 不提「投资自己」
    r = client.post("/deep-talk/confirm", json={"kind": "habit", "key": "prototype", "accept": True})
    assert r.status_code == 409 and r.json()["detail"] == "习惯满了，先在设置里换掉一个"
    assert [h["title"] for h in client.get("/settings").json()["habits"]] == ["看书", "背单词", "冥想"]
    assert client.get("/deep-talk").json()["proposals"]["habits"][0]["status"] == "pending"


def test_tomorrow_confirm_keeps_tonight_log(setup):
    client, db, model = setup
    client.post("/checkin", json={"result": {"note": "今天读得很顺", "tomorrow_task": "做一套往年卷",
                                             "items": {"english": {"status": "done"}}}})
    s = finish_step4(client, model)
    assert s["tonight_task"] == "做一套往年卷" and s["proposals"]["tomorrow"] == "投一份实习申请"
    assert s["can_set_tomorrow"] is True
    r = client.post("/deep-talk/confirm", json={"kind": "tomorrow", "accept": True}).json()
    assert r["proposals"]["tomorrow"] is None and r["tonight_task"] == "投一份实习申请"
    assert client.get("/today").json()["tomorrow_task"] == "投一份实习申请"
    [log] = db.logs_between(1, datetime(2026, 11, 20).date(), datetime(2026, 11, 20).date())
    assert log["note"] == "今天读得很顺" and log["items"] == {"english": {"status": "done"}}


def test_invite_only_after_checkin_and_not_on_low_energy(setup):
    client, _, _ = setup
    assert client.get("/deep-talk").json()["invite"] is False  # 还没对账
    client.post("/checkin", json={"result": {"items": {"english": {"status": "done"}}}})
    assert client.get("/deep-talk").json()["invite"] is True
    client.post("/energy", json={"level": 2, "now": "18:00"})
    assert client.get("/deep-talk").json()["invite"] is False  # 电量 ≤ 2
    client.post("/energy", json={"level": 4, "now": "18:00"})
    for n in (1, 2):
        assert client.post("/deep-talk/snooze").json()["snoozes"] == n
    assert client.get("/deep-talk").json()["invite"] is True
    assert client.post("/deep-talk/snooze").json()["invite"] is False  # 连着 3 次「明天再说」
    s = walk(client, STEPS_1_3[:1])
    assert s["snoozes"] == 0 and s["invite"] is False  # 今晚已经开始聊了


def test_today_goals_map(setup):
    client, _, model = setup
    s = finish_step4(client, model)
    goal = next(p for p in s["proposals"]["profiles"] if p["level"] == "目标")
    assert {p["level"] for p in s["proposals"]["profiles"]} >= {"使命", "目标", "策略"}
    client.post("/deep-talk/confirm", json={"kind": "profile", "id": goal["id"], "accept": True})
    r = client.post("/deep-talk/confirm", json={"kind": "habit", "key": "prototype", "accept": True}).json()
    assert next(h for h in r["proposals"]["habits"] if h["key"] == "prototype")["status"] == "accepted"
    habit = next(h for h in client.get("/settings").json()["habits"] if h["source"] == "deep_talk")
    assert (habit["title"], habit["goal_id"]) == ("写一段代码", goal["id"])
    assert client.get("/today").json()["goals"] == {habit["id"]: "每周投出 2 份实习申请"}
    client.post("/deep-talk/restart")
    assert client.get("/today").json()["goals"] == {}  # 新的一轮还没有目标：旧目标不再显示


def test_choose_later_after_not_choosing(setup):
    client, _, model = setup
    s = walk(client, STEPS_1_3 + VERSIONS + [(4, "council", True), (4, "rate", RATE), (4, "choose", None)])
    assert s["step"] is None and not any(p["level"] == "使命" for p in s["proposals"]["profiles"])
    assert {h["source"] for h in s["proposals"]["habits"]} == {"invest"}
    model.replies.append(STEP4)
    s = walk(client, [(4, "choose", 0)])  # 回来选一个版本：改的是同一轮第 4 次
    assert any(p["level"] == "使命" for p in s["proposals"]["profiles"])
    assert [h["key"] for h in s["proposals"]["habits"]][-1] == "prototype"


def test_restart_keeps_old_round(setup):
    client, db, _ = setup
    walk(client, STEPS_1_3[:3])
    s = client.post("/deep-talk/restart").json()
    assert (s["round"], s["step"], s["screen"], s["answers"]) == (2, 1, "scores", {})
    assert db.deep_talk_rows(1, 1)[0]["finished_at"] is not None


def test_tomorrow_needs_tonight_checkin(setup):
    client, db, model = setup
    s = finish_step4(client, model)
    assert s["can_set_tomorrow"] is False and s["proposals"]["tomorrow"] == "投一份实习申请"
    r = client.post("/deep-talk/confirm", json={"kind": "tomorrow", "accept": True})
    assert r.status_code == 409 and r.json()["detail"] == "先对完今晚的账，再定明天的一件事"
    assert client.get("/today").json()["checked_in"] is False
    assert client.get("/deep-talk").json()["proposals"]["tomorrow"] == "投一份实习申请"  # 对完账还能回来定


def test_talk_after_midnight_counts_for_the_evening_before(tmp_path):
    t = [datetime(2026, 11, 20, 21, 0)]
    client = TestClient(create_app(Db(tmp_path / "app.db"), FakeModel(), template=TEMPLATE,
                                   now=lambda tz: t[0].replace(tzinfo=tz), cards=CARDS))
    client.post("/checkin", json={"result": {"items": {"english": {"status": "done"}}}})
    t[0] = datetime(2026, 11, 21, 1, 30)  # 凌晨 1:30 还算 11-20 那一晚
    s = walk(client, STEPS_1_3[:1])
    assert s["invite"] is False
    t[0] = datetime(2026, 11, 21, 21, 0)  # 第二天晚上对完账：照常邀请
    client.post("/checkin", json={"result": {"items": {"english": {"status": "done"}}}})
    assert client.get("/deep-talk").json()["invite"] is True


def test_talk_started_at_uses_logical_day(tmp_path):
    db = Db(tmp_path / "app.db")
    client = TestClient(create_app(db, FakeModel(), template=TEMPLATE,
                                   now=lambda tz: datetime(2026, 11, 21, 1, 30, tzinfo=tz), cards=CARDS))
    walk(client, STEPS_1_3[:1])
    assert db.deep_talk_rows(1, 1)[0]["started_at"] == "2026-11-20T01:30"


def test_council_stuck_running_after_restart_runs_again(setup):
    client, db, model = setup
    walk(client, STEPS_1_3 + VERSIONS)
    db.upsert_deep_talk(1, 1, 4, council_status="running")  # 后端重启前留下的，没有线程在跑
    model.replies += [LENS, LENS, SYNTH]
    assert client.post("/deep-talk/council").json()["council"]["status"] == "running"
    client.app.state.deep_talk_thread.join()
    assert client.get("/deep-talk").json()["council"]["status"] == "done"


def test_two_habit_accepts_at_once_both_land_once(setup):
    client, _, _ = setup
    settings = client.get("/settings").json()
    settings["habits"] = settings["habits"][1:]  # 只留「背单词」：再加两条也不超过 3 个，今天也排得下
    assert client.put("/settings", json=settings).status_code == 200
    s = walk(client, STEPS_1_3 + VERSIONS + [(4, "council", True), (4, "rate", RATE), (4, "choose", None)])
    keys = [h["key"] for h in s["proposals"]["habits"]]
    assert keys == ["move", "sleep"]
    barrier, codes = threading.Barrier(2), []

    def accept(key):
        barrier.wait()
        codes.append(client.post("/deep-talk/confirm", json={"kind": "habit", "key": key, "accept": True}).status_code)
    threads = [threading.Thread(target=accept, args=(k,)) for k in keys]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert codes == [200, 200]
    titles = [h["title"] for h in client.get("/settings").json()["habits"]]
    assert sorted(titles) == sorted(["背单词", "运动", "睡前放下手机"])
    assert [h["status"] for h in client.get("/deep-talk").json()["proposals"]["habits"]] == ["accepted", "accepted"]


def test_tomorrow_confirm_keeps_tonight_energy_and_ignores_blank_edit(setup):
    client, db, model = setup
    client.post("/checkin", json={"result": {"energy_after_class": 2, "items": {"english": {"status": "done"}}}})
    client.post("/energy", json={"level": 4, "now": "18:00"})
    finish_step4(client, model)
    r = client.post("/deep-talk/confirm", json={"kind": "tomorrow", "content": "   ", "accept": True})
    assert r.status_code == 200
    [log] = db.logs_between(1, datetime(2026, 11, 20).date(), datetime(2026, 11, 20).date())
    assert log["energy_after_class"] == 2 and log["tomorrow_task"] == "投一份实习申请"


def test_habit_accept_that_cannot_be_saved_stays_pending(setup):
    client, _, model = setup
    finish_step4(client, model)
    r = client.post("/deep-talk/confirm", json={"kind": "habit", "key": "prototype", "content": "名" * 21, "accept": True})
    assert r.status_code == 422
    assert next(h for h in client.get("/deep-talk").json()["proposals"]["habits"] if h["key"] == "prototype")["status"] == "pending"
    assert len(client.get("/settings").json()["habits"]) == 2


def test_follow_and_energy_bad_answers_store_nothing(setup):
    client, db, _ = setup
    walk(client, STEPS_1_3[:6])
    assert answer(client, 3, "follow", {"在哪": "家", "和谁": "一个人", "用什么": "电脑"}).status_code == 422  # 最多 2 项
    r = answer(client, 3, "follow", {"和谁": "一个人的时候我想死"}).json()
    assert r["crisis"] is True and db.crisis_count(1) == 1
    s = client.get("/deep-talk").json()
    assert s["screen"] == "follow" and "follow" not in s["answers"]["3"]
    walk(client, [(3, "follow", {})])
    assert answer(client, 3, "energy", {"nope": "love"}).status_code == 422
    assert client.get("/deep-talk").json()["screen"] == "energy"
