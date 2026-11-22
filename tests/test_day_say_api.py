import json
import re
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from mentor.day_parse import memory_key
from mentor.model import FakeModel
from planner.model import to_min
from server.api import DEFAULT_TEMPLATE, create_app
from server.db import Db

# 学生：习惯 reading、english，两节课。精力加大，不然课加开会就把一天的精力用完，任务排不进去
TEMPLATE = {**json.loads(DEFAULT_TEMPLATE.read_text(encoding="utf-8")), "energy": {"base_min": 900}}


def reply(*items) -> str:
    return json.dumps({"items": list(items)}, ensure_ascii=False)


def item(title, kind="task", start=None, end=None, minutes=None, effort="normal"):
    return {"title": title, "kind": kind, "start": start, "end": end, "minutes": minutes, "effort": effort}


MEETING = item("开会", "fixed", "17:00", "18:00")
REPORT = item("写报告", effort="heavy")


@pytest.fixture
def setup(tmp_path):
    db, model = Db(tmp_path / "app.db"), FakeModel()
    clock = lambda tz: datetime(2026, 11, 20, 8, 0, tzinfo=tz)
    return TestClient(create_app(db, model, template=TEMPLATE, now=clock)), db, model


def say(client, text="今天写报告，四点半开会"):
    return client.post("/day/say", json={"text": text})


def test_say_returns_unconfirmed_plan_with_items_and_item_ids(setup):
    client, db, model = setup
    model.replies.append(reply(MEETING, REPORT))
    r = say(client).json()
    assert r["version"] == 1 and not r["confirmed"] and "reminders" in r  # 和 /today 同形
    meeting, report = r["items"]
    assert meeting["kind"] == "fixed" and meeting["minutes"] == 60 and meeting["id"].startswith("item-")
    assert report["start"] is None and report["minutes"] == 90 and report["estimated"] and report["source"] == "估的"
    by_item = {b["item_id"]: b for b in r["blocks"] if "item_id" in b}
    assert by_item[meeting["id"]]["start"] == "17:00" and by_item[meeting["id"]]["id"] == meeting["id"]
    task_blocks = [b for b in r["blocks"] if b.get("task_id") == report["id"]]
    assert task_blocks and all(b["item_id"] == report["id"] for b in task_blocks)
    assert client.get("/today").json()["items"] == r["items"]
    assert db.day_items(1, datetime(2026, 11, 20).date()) == r["items"]


def test_duration_uses_last_time_then_default(setup):
    client, db, model = setup
    db.remember_duration(1, memory_key("写报告 2"), 45)  # 键去掉空格和数字
    model.replies.append(reply(REPORT, item("读论文", effort="light"), item("健身", minutes=50)))
    report, paper, gym = say(client).json()["items"]
    assert (report["minutes"], report["estimated"], report["source"]) == (45, False, "上次")
    assert (paper["minutes"], paper["estimated"], paper["source"]) == (30, True, "估的")
    assert (gym["minutes"], gym["estimated"], gym["source"]) == (50, False, "说的")


def test_fixed_with_only_start_gets_estimated_end(setup):
    # 「下午三点开组会」只说了几点开始：结束按时长补（说了的、上次的、按精力档估的）
    client, db, model = setup
    db.remember_duration(1, memory_key("面试"), 45)
    model.replies.append(reply(item("开组会", "fixed", "17:00"), item("面试", "fixed", "10:00"),
                               item("看电影", "fixed", "19:30", minutes=90)))
    meet, interview, movie = say(client).json()["items"]
    assert (meet["end"], meet["minutes"], meet["estimated"]) == ("18:00", 60, True)
    assert (interview["end"], interview["source"]) == ("10:45", "上次")
    assert (movie["end"], movie["source"]) == ("21:00", "说的")


@pytest.mark.parametrize("bad", [
    item("开会", "fixed", "17:30", "16:30"), item("开会", "fixed", "25:00", "26:00"), item("开会", "fixed"),
    item("开会", "fixed", "23:30", minutes=60),
    item("写报告", minutes=3), item("写报告", minutes=600), item("", minutes=30), item("长" * 31, minutes=30)])
def test_invalid_item_is_rejected_after_one_retry(setup, bad):
    client, db, model = setup
    model.replies += [reply(bad), reply(bad)]
    r = say(client)
    assert r.status_code == 422 and r.json()["detail"] == "没听清，换个说法或直接加"
    assert len(model.calls) == 2 and db.day_items(1, datetime(2026, 11, 20).date()) == []


def test_retry_recovers(setup):
    client, _, model = setup
    model.replies += ["不是 JSON", reply(REPORT)]
    assert say(client).status_code == 200


def test_crisis_in_text_skips_model(setup):
    client, db, model = setup
    r = say(client, "我不想活了").json()
    assert r["crisis"] is True and model.calls == [] and db.crisis_count(1) == 1


def test_crisis_in_model_output(setup):
    client, db, model = setup
    model.replies.append(json.dumps({"crisis": True}))
    assert say(client).json()["crisis"] is True
    assert db.day_items(1, datetime(2026, 11, 20).date()) == []


def test_saying_again_replaces_items(setup):
    client, _, model = setup
    model.replies += [reply(MEETING, REPORT), reply(item("读论文", effort="light"))]
    say(client)
    r = say(client).json()
    assert [i["title"] for i in r["items"]] == ["读论文"] and r["version"] == 2
    assert not any(b["id"] == "开会" or b["title"] == "开会" for b in r["blocks"])
    assert not any(b["title"] == "写报告" for b in r["blocks"])


def test_habits_still_scheduled(setup):
    client, _, model = setup
    model.replies.append(reply(MEETING, REPORT))
    ids = {b["id"] for b in say(client).json()["blocks"]}
    assert {"reading", "english", "math", "physics"} <= ids


def test_items_survive_energy_report(setup):
    client, _, model = setup
    model.replies.append(reply(MEETING, REPORT))
    meeting, report = say(client).json()["items"]
    r = client.post("/energy", json={"level": 2}).json()
    assert r["version"] == 2
    assert any(b["id"] == meeting["id"] for b in r["blocks"])
    assert any(b.get("task_id") == report["id"] for b in r["blocks"])
    pre = client.post("/energy", json={"level": 4, "preview": True}).json()  # 预览也带着
    assert any(b.get("item_id") == meeting["id"] for b in pre["blocks"])


def test_said_tasks_scheduled_even_over_energy(tmp_path):
    # 默认学生模板（精力不加大）：课和必做就把精力用完了，说了的事也要排上（实测出的问题 1）
    tpl = json.loads(DEFAULT_TEMPLATE.read_text(encoding="utf-8"))
    model = FakeModel()
    client = TestClient(create_app(Db(tmp_path / "a.db"), model, template=tpl,
                                   now=lambda tz: datetime(2026, 11, 20, 8, 0, tzinfo=tz)))
    model.replies.append(reply(item("开组会", "fixed", "17:00", "17:45"), item("写报告", minutes=120, effort="heavy"),
                               item("健身", minutes=60)))
    r = say(client).json()
    _, report, gym = r["items"]
    assert any(b.get("task_id") == report["id"] for b in r["blocks"])
    assert any(b.get("task_id") == gym["id"] for b in r["blocks"])
    assert not any("截止日" in w or "晚上不排项目" in w for w in r["warnings"])


def test_said_fixed_wins_over_clashing_class(setup):
    client, db, model = setup
    model.replies.append(reply(item("开组会", "fixed", "14:00", "15:00")))
    r = say(client)
    assert r.status_code == 200  # 以前撞上大学物理就 422「时间冲突」
    ids = {b["id"] for b in r.json()["blocks"]}
    assert "physics" not in ids and "math" in ids
    note = "『大学物理』和『开组会』撞了，今天先按你说的排"
    assert note in r.json()["warnings"] and note in client.get("/today").json()["warnings"]
    assert any(e["id"] == "physics" for e in db.plan_input(1)["fixed"])  # 设置不动，只是今天去掉


def test_items_survive_settings_change(setup):
    client, _, model = setup
    model.replies.append(reply(MEETING, REPORT))
    meeting, _ = say(client).json()["items"]
    form = client.get("/settings").json()
    form["habits"][0]["minutes"] = 40
    assert client.put("/settings", json=form).status_code == 200
    assert any(b["id"] == meeting["id"] for b in client.get("/today").json()["blocks"])


def clocked(tmp_path, h=8, m=0):
    """时钟可以拨：t[0]、t[1] 是现在的时、分。"""
    db, model, t = Db(tmp_path / "app.db"), FakeModel(), [h, m]
    clock = lambda tz: datetime(2026, 11, 20, t[0], t[1], tzinfo=tz)
    return TestClient(create_app(db, model, template=TEMPLATE, now=clock)), db, model, t


def real(plan):
    return [b for b in plan["blocks"] if not b["id"].startswith("free-")]


def test_say_in_afternoon_only_replans_after_now(tmp_path):
    # 下午三点才说：上午的真实计划不动，新事项只排在现在之后（评审 1）
    client, _, model, t = clocked(tmp_path)
    morning = client.get("/today").json()
    t[0] = 15
    model.replies.append(reply(item("写报告", minutes=120, effort="heavy"), item("买菜", minutes=30, effort="light")))
    r = say(client, "写报告两小时，买菜").json()
    assert [b for b in real(r) if b["start"] < "15:00"] == [b for b in real(morning) if b["start"] < "15:00"]
    said = [b for b in r["blocks"] if "item_id" in b]
    assert {b["title"] for b in said} == {"写报告", "买菜"} and all(b["start"] >= "15:00" for b in said)
    assert sum(to_min(b["end"]) - to_min(b["start"]) for b in said if b["title"] == "写报告") == 120


def test_first_say_in_afternoon_without_plan_still_starts_from_now(tmp_path):
    client, _, model, _ = clocked(tmp_path, 15)
    model.replies.append(reply(item("复习", minutes=90)))
    r = say(client).json()
    assert all(b["start"] >= "15:00" for b in r["blocks"] if "item_id" in b)


def test_too_much_said_is_scheduled_as_far_as_it_goes(tmp_path):
    # 下午说了排不完的：不 422，能排多少排多少，提醒差多少；报电量、改设置也照样能用（评审 2）
    client, _, model, t = clocked(tmp_path)
    client.get("/today")
    t[0] = 15
    model.replies.append(reply(item("写报告", minutes=480, effort="heavy")))
    r = say(client)
    assert r.status_code == 200
    note = next(w for w in r.json()["warnings"] if w.startswith("今天剩下的时间排不下"))
    assert re.fullmatch(r"今天剩下的时间排不下：写报告（还差 \d+ 分钟）", note)
    assert any(b["title"] == "写报告" for b in r.json()["blocks"])
    t[0], t[1] = 18, 30
    e = client.post("/energy", json={"level": 3})
    assert e.status_code == 200 and any(w.startswith("今天剩下的时间排不下：写报告") for w in e.json()["warnings"])
    form = client.get("/settings").json()
    form["habits"][0]["minutes"] = 40
    assert client.put("/settings", json=form).status_code == 200
    assert client.post("/plan/reflow", json={"version": client.get("/today").json()["version"]}).status_code == 200


def test_energy_during_said_task_counts_the_part_in_progress(tmp_path):
    # 写报告正在做：这一块算进去，不再补排一块，也不报排不下
    client, _, model, t = clocked(tmp_path)
    model.replies.append(reply(item("写报告", minutes=90, effort="heavy")))
    b = next(x for x in say(client).json()["blocks"] if x["title"] == "写报告")
    t[0], t[1] = divmod(to_min(b["start"]) + 10, 60)
    r = client.post("/energy", json={"level": 3}).json()
    assert [x for x in r["blocks"] if x["title"] == "写报告"] == [{**b}]
    assert not any("排不下" in w for w in r["warnings"])


def test_said_minutes_are_not_rounded_up(setup):
    client, _, model = setup
    model.replies.append(reply(item("健身", minutes=45), item("倒垃圾", minutes=5, effort="light")))
    blocks = say(client).json()["blocks"]
    assert {b["title"]: to_min(b["end"]) - to_min(b["start"]) for b in blocks if "item_id" in b} == {"健身": 45, "倒垃圾": 5}


def test_one_bad_item_is_dropped_others_kept(setup):
    # 一句话里有一项不合格：丢掉那一项，其余照排，不用重试（评审 14）
    client, db, model = setup
    model.replies.append(reply(REPORT, item("写报告", minutes=600), item("开会", "fixed", "17:30", "16:30"), MEETING))
    r = say(client)
    assert r.status_code == 200 and len(model.calls) == 1
    assert [i["title"] for i in r.json()["items"]] == ["写报告", "开会"]


@pytest.mark.parametrize("first", ["today", "say"])
def test_first_plan_after_wake_does_not_pretend_morning_was_done(tmp_path, first):
    # 用户实测：10 点多第一次打开、第一次说，看书被排到早上当「做过了」，今天就不再排
    client, _, model, _ = clocked(tmp_path, 15)
    if first == "say":
        model.replies.append(reply(item("复习", minutes=60)))
        plan = say(client).json()
    else:
        plan = client.get("/today").json()
    real_blocks = [b for b in real(plan) if b["kind"] in ("must", "proj", "flex")]
    assert real_blocks and all(b["start"] >= "15:00" for b in real_blocks)
    assert any(b["id"] == "reading" for b in real_blocks)  # 看书照样排在今天剩下的时间里
