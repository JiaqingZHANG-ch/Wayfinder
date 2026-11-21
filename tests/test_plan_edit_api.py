"""手动改块、删块、按精力重排其余的（/plan/edit、DELETE /plan/block、/plan/reflow）。"""
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from mentor.day_parse import memory_key
from mentor.model import FakeModel
from server.api import create_app
from server.db import Db
from test_day_say_api import MEETING, REPORT, TEMPLATE, reply, say

DAY = date(2026, 11, 20)


@pytest.fixture
def setup(tmp_path):
    # 早上 8 点：背单词（07:15 开始）已经开始了
    db, model = Db(tmp_path / "app.db"), FakeModel()
    clock = lambda tz: datetime(2026, 11, 20, 8, 0, tzinfo=tz)
    client = TestClient(create_app(db, model, template=TEMPLATE, now=clock))
    model.replies.append(reply(MEETING, REPORT))
    plan = say(client).json()
    return client, db, model, plan


def report_block(plan):
    return next(b for b in plan["blocks"] if b["title"] == "写报告")


def edit(client, plan, block_id, start, end):
    return client.post("/plan/edit", json={"version": plan["version"], "block_id": block_id, "start": start, "end": end})


def test_edit_pins_block_and_reports_overlaps(setup):
    client, _, _, plan = setup
    b = report_block(plan)
    r = edit(client, plan, b["id"], "20:30", "22:00")
    assert r.status_code == 200
    r = r.json()
    assert r["version"] == plan["version"] + 1 and not r["confirmed"] and "items" in r  # /today 的形状
    moved = next(x for x in r["blocks"] if x["id"] == b["id"])
    assert (moved["start"], moved["end"], moved["pinned"], moved["item_id"]) == ("20:30", "22:00", True, b["task_id"])
    assert r["overlaps"] == ["reading", "exam-prep-0"]  # 自由时间不算
    # 不重排：别的块原样
    assert [x for x in r["blocks"] if x["id"] != b["id"]] == [x for x in plan["blocks"] if x["id"] != b["id"]]
    assert client.get("/today").json()["version"] == r["version"]


def test_stale_version_is_409(setup):
    client, _, _, plan = setup
    b = report_block(plan)
    assert edit(client, plan, b["id"], "19:00", "20:30").status_code == 200
    assert edit(client, plan, b["id"], "19:00", "20:30").status_code == 409  # 还拿着旧版本
    assert client.delete(f"/plan/block/{b['id']}?version={plan['version']}").status_code == 409
    assert client.post("/plan/reflow", json={"version": plan["version"]}).status_code == 409


@pytest.mark.parametrize("block_id,start,end", [
    ("math", "09:30", "12:00"),        # 课不能改
    ("lunch", "12:00", "12:30"),       # 吃饭不能改
    ("REPORT", "21:00", "20:00"),      # 开始晚于结束
    ("REPORT", "06:00", "07:30"),      # 起床前
    ("REPORT", "22:30", "23:30"),      # 上床后
    ("REPORT", "20:00", "20:05"),      # 不到 10 分钟
    ("REPORT", "25:00", "26:00"),      # 不是 HH:MM
])
def test_edit_rejects_bad_input(setup, block_id, start, end):
    client, _, _, plan = setup
    block_id = report_block(plan)["id"] if block_id == "REPORT" else block_id
    r = edit(client, plan, block_id, start, end)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert client.get("/today").json()["version"] == plan["version"]


def test_unknown_block_is_404(setup):
    client, _, _, plan = setup
    assert edit(client, plan, "nope", "19:00", "20:00").status_code == 404


def test_changed_duration_is_remembered_and_used_next_time(setup):
    client, db, model, plan = setup
    b = report_block(plan)
    assert edit(client, plan, b["id"], b["start"], "19:45").status_code == 200  # 90 → 60 分钟
    assert db.remembered_duration(1, memory_key("写报告")) == 60
    model.replies.append(reply(REPORT))
    item = say(client).json()["items"][0]
    assert (item["minutes"], item["source"], item["estimated"]) == (60, "上次", False)


def test_moving_without_resizing_or_habit_does_not_remember(setup):
    client, db, _, plan = setup
    b = report_block(plan)
    assert edit(client, plan, b["id"], "19:00", "20:30").status_code == 200  # 只挪，时长没变
    assert db.remembered_duration(1, memory_key("写报告")) is None
    plan = client.get("/today").json()
    assert edit(client, plan, "reading", "19:00", "19:45").status_code == 200  # 习惯的时长归设置页管
    assert db.remembered_duration(1, memory_key("看书")) is None


def test_delete_block_removes_day_item(setup):
    client, db, _, plan = setup
    b = report_block(plan)
    r = client.delete(f"/plan/block/{b['id']}?version={plan['version']}")
    assert r.status_code == 200
    r = r.json()
    assert r["version"] == plan["version"] + 1
    assert not any(x.get("task_id") == b["task_id"] for x in r["blocks"])
    assert [i["title"] for i in r["items"]] == ["开会"] and [i["title"] for i in db.day_items(1, DAY)] == ["开会"]
    again = client.post("/plan/reflow", json={"version": r["version"]}).json()  # 重排也不会再冒出来
    assert not any(x["title"] == "写报告" for x in again["blocks"])


def test_reflow_keeps_pins_and_started_blocks(setup):
    client, _, _, plan = setup
    b = report_block(plan)
    edited = edit(client, plan, b["id"], "20:30", "22:00").json()
    edited = edit(client, edited, "reading", "19:00", "19:30").json()
    r = client.post("/plan/reflow", json={"version": edited["version"]})
    assert r.status_code == 200
    r = r.json()
    assert r["version"] == edited["version"] + 1 and not r["confirmed"]
    assert r["before"] == edited["blocks"]
    by_id = {x["id"]: x for x in r["blocks"]}
    report = by_id[b["id"]]  # 位置不变，kind 恢复成任务块，还带着事项
    assert (report["start"], report["end"], report["kind"], report["pinned"]) == ("20:30", "22:00", "proj", True)
    assert report["task_id"] == b["task_id"] and report["item_id"] == b["task_id"]
    assert [x["id"] for x in r["blocks"] if x.get("task_id") == b["task_id"]] == [b["id"]]  # 钉住的任务不再排一遍
    reading = [x for x in r["blocks"] if x["title"] == "看书"]
    assert len(reading) == 1 and (reading[0]["kind"], reading[0]["start"], reading[0]["pinned"]) == ("must", "19:00", True)
    assert by_id["english"] == next(x for x in plan["blocks"] if x["id"] == "english")  # 已经开始的不动
    assert len(by_id) == len(r["blocks"])  # id 不重复


def test_reflow_infeasible_is_422_with_reason(setup):
    client, _, _, plan = setup
    b = report_block(plan)
    edited = edit(client, plan, b["id"], "14:30", "16:00").json()  # 钉在大学物理上
    assert edited["overlaps"] == ["physics"]
    r = client.post("/plan/reflow", json={"version": edited["version"]})
    assert r.status_code == 422 and "冲突" in r.json()["detail"]
    assert client.get("/today").json()["version"] == edited["version"]
