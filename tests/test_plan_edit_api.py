"""手动改块、删块、按精力重排其余的（/plan/edit、DELETE /plan/block、/plan/reflow）。"""
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from mentor.day_parse import memory_key
from mentor.model import FakeModel
from server.api import create_app
from server.db import Db
from planner.model import to_hhmm, to_min
from test_day_say_api import MEETING, REPORT, TEMPLATE, clocked, item, reply, say

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


def test_split_task_pin_not_duplicated_after_reflows(tmp_path):
    # 浏览器里实测出来的：两小时的事拆成两块，拖其中一块再重排，钉住的块被求解器改名后又加了一遍（显示成「课」）
    db, model = Db(tmp_path / "app.db"), FakeModel()
    client = TestClient(create_app(db, model, template=TEMPLATE, now=lambda tz: datetime(2026, 11, 20, 8, 0, tzinfo=tz)))
    model.replies.append(reply(item("写报告", minutes=120, effort="heavy"), item("健身", minutes=60)))
    plan = say(client).json()
    first = next(b for b in plan["blocks"] if b["title"] == "写报告")
    plan = edit(client, plan, first["id"], to_hhmm(to_min(first["start"]) + 60), to_hhmm(to_min(first["end"]) + 60)).json()
    gym = next(b for b in plan["blocks"] if b["title"] == "健身")
    plan = edit(client, plan, gym["id"], gym["start"], to_hhmm(to_min(gym["end"]) - 15)).json()
    for _ in range(2):
        plan = client.post("/plan/reflow", json={"version": plan["version"]}).json()
        report = [b for b in plan["blocks"] if b["title"] == "写报告"]
        assert all(b["kind"] == "proj" for b in report)
        assert sum(to_min(b["end"]) - to_min(b["start"]) for b in report) <= 120  # 不会排两遍（排不下时有提醒）
        assert sum(1 for b in report if b.get("pinned")) == 1


def test_reflow_infeasible_is_422_with_reason(setup):
    client, _, _, plan = setup
    b = report_block(plan)
    edited = edit(client, plan, b["id"], "14:30", "16:00").json()  # 钉在大学物理上
    assert edited["overlaps"] == ["physics"]
    r = client.post("/plan/reflow", json={"version": edited["version"]})
    assert r.status_code == 422 and "冲突" in r.json()["detail"]
    assert client.get("/today").json()["version"] == edited["version"]


def mins(b):
    return to_min(b["end"]) - to_min(b["start"])


def test_shrunk_item_updates_day_item_and_stays_short(setup):
    # 把写报告从 90 拉短到 45：事项跟着改成 45、不再标「估」；重排、报电量都不再补出被砍掉的那段（评审 3）
    client, db, _, plan = setup
    b = report_block(plan)
    r = edit(client, plan, b["id"], b["start"], to_hhmm(to_min(b["start"]) + 45)).json()
    report = next(i for i in r["items"] if i["title"] == "写报告")
    assert (report["minutes"], report["estimated"], report["source"]) == (45, False, "说的")
    assert db.day_items(1, DAY) == r["items"]
    r = client.post("/plan/reflow", json={"version": r["version"]}).json()
    assert [mins(x) for x in r["blocks"] if x["title"] == "写报告"] == [45]
    r = client.post("/energy", json={"level": 3}).json()
    assert [(mins(x), x.get("pinned")) for x in r["blocks"] if x["title"] == "写报告"] == [(45, True)]


def test_said_fixed_can_be_moved_and_deleted(setup):
    # 说的固定事项（求解器输出成 class、带 item_id）能拖能删，拖了以后事项的起止跟着改（评审 7）
    client, db, _, plan = setup
    meeting = next(x for x in plan["blocks"] if x["title"] == "开会")
    assert meeting["kind"] == "class" and meeting["item_id"] == meeting["id"]
    r = edit(client, plan, meeting["id"], "20:00", "21:30")
    assert r.status_code == 200
    item = next(i for i in db.day_items(1, DAY) if i["title"] == "开会")
    assert (item["start"], item["end"], item["minutes"]) == ("20:00", "21:30", 90)
    r = client.post("/plan/reflow", json={"version": r.json()["version"]}).json()
    moved = next(x for x in r["blocks"] if x["title"] == "开会")
    assert (moved["start"], moved["end"], moved["kind"], moved["pinned"]) == ("20:00", "21:30", "class", True)
    r = client.delete(f"/plan/block/{meeting['id']}?version={r['version']}")
    assert r.status_code == 200 and [i["title"] for i in r.json()["items"]] == ["写报告"]
    assert not any(x["title"] == "开会" for x in r.json()["blocks"])


def test_pins_survive_energy_and_settings_in_the_afternoon(tmp_path):
    # 钉住的块存在当天的计划里：12:30 报电量、改设置都不挪它们，pinned 也还在（评审 4）
    client, _, model, t = clocked(tmp_path)
    model.replies.append(reply(REPORT))
    plan = say(client).json()
    plan = edit(client, plan, report_block(plan)["id"], "20:00", "21:30").json()
    plan = edit(client, plan, "reading", "13:00", "13:30").json()
    t[0], t[1] = 12, 30

    def pinned(p):
        return {x["title"]: (x["start"], x["end"]) for x in p["blocks"] if x.get("pinned")}

    want = {"写报告": ("20:00", "21:30"), "看书": ("13:00", "13:30")}
    assert pinned(client.post("/energy", json={"level": 3}).json()) == want
    form = client.get("/settings").json()
    form["habits"][0]["minutes"] = 40
    assert client.put("/settings", json=form).status_code == 200
    today = client.get("/today").json()
    assert pinned(today) == want and [x["title"] for x in today["blocks"]].count("看书") == 1


def test_resaying_clears_pins_of_replaced_items(tmp_path):
    client, _, model, t = clocked(tmp_path)
    model.replies.append(reply(REPORT))
    plan = say(client).json()
    edit(client, plan, report_block(plan)["id"], "20:00", "21:30")
    t[0] = 15
    model.replies.append(reply(item("买菜", effort="light")))
    r = say(client, "买菜").json()
    assert not any(x["title"] == "写报告" for x in r["blocks"])
    assert any(x["title"] == "买菜" and x["start"] >= "15:00" for x in r["blocks"])


@pytest.mark.parametrize("block_id", ["math", "lunch", "bus-out"])
def test_class_meal_and_commute_cannot_be_deleted(setup, block_id):
    client, _, _, plan = setup
    r = client.delete(f"/plan/block/{block_id}?version={plan['version']}")
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    assert client.get("/today").json()["version"] == plan["version"]


def test_deleted_habit_is_skipped_today(tmp_path):
    # 删掉的习惯今天跳过：下午重排、报电量都不再冒出来（评审 5）
    client, _, model, t = clocked(tmp_path)
    plan = client.get("/today").json()
    r = client.delete(f"/plan/block/reading?version={plan['version']}").json()
    assert not any(x["id"] == "reading" for x in r["blocks"])
    t[0] = 15
    r = client.post("/plan/reflow", json={"version": r["version"]}).json()
    assert not any(x["title"] == "看书" for x in r["blocks"])
    r = client.post("/energy", json={"level": 4, "done_ids": ["reading"]}).json()
    assert not any(x["title"] == "看书" for x in r["blocks"])
    model.replies.append(reply(REPORT))
    assert not any(x["title"] == "看书" for x in say(client).json()["blocks"])


def test_pin_overlapping_block_in_progress_is_kept(tmp_path):
    # 钉住的块压在正在做的块后半段：重排时照样留着（允许重叠），overlaps 里点出来（评审 6）
    client, _, model, t = clocked(tmp_path)
    model.replies.append(reply(REPORT))
    plan = say(client).json()
    on = next(x for x in plan["blocks"] if x["id"] == "exam-prep-0")
    s = to_min(on["start"])
    plan = edit(client, plan, report_block(plan)["id"], to_hhmm(s + 20), to_hhmm(s + 110)).json()
    t[0], t[1] = divmod(s + 10, 60)  # 下午，复习正在做
    r = client.post("/plan/reflow", json={"version": plan["version"]})
    assert r.status_code == 200
    r = r.json()
    report = [x for x in r["blocks"] if x["title"] == "写报告"]
    assert [(x["start"], x["end"], x["pinned"]) for x in report] == [(to_hhmm(s + 20), to_hhmm(s + 110), True)]
    assert {"exam-prep-0", report[0]["id"]} <= set(r["overlaps"])


FULL = [item("写报告", minutes=120, effort="heavy"), item("健身", minutes=60), item("复习", minutes=120, effort="heavy"),
        item("洗衣服", minutes=30, effort="light"), item("读论文", minutes=90)]


def full_day(tmp_path, tomorrow_task=""):
    """08:00 说五件事，一天排不下（有「还差 N 分钟」）；昨晚可以先定好「明天的一件事」。"""
    db, model = Db(tmp_path / "app.db"), FakeModel()
    client = TestClient(create_app(db, model, template=TEMPLATE, now=lambda tz: datetime(2026, 11, 20, 8, 0, tzinfo=tz)))
    db.save_log(1, {"date": "2026-11-19", "energy_after_class": 3, "blocker": "", "tomorrow_task": tomorrow_task,
                    "note": "", "yesterday_done": None, "items": {}})
    model.replies.append(reply(*FULL))
    return client, say(client).json()


def test_one_thing_survives_reflow_on_full_day(tmp_path):
    # 昨晚自己定的事和今天说的一样必排：排满的一天挪一块再重排，它也不被挤掉
    client, plan = full_day(tmp_path, "交作业")
    one = [b for b in plan["blocks"] if b.get("task_id") == "one-thing"]
    assert sum(mins(b) for b in one) == 30
    said = next(b for b in plan["blocks"] if b.get("item_id"))  # 挪一块说的事（排满时哪件被挤掉不一定）
    plan = edit(client, plan, said["id"], to_hhmm(to_min(said["start"]) + 15), to_hhmm(to_min(said["end"]) + 15)).json()
    r = client.post("/plan/reflow", json={"version": plan["version"]}).json()
    assert sum(mins(b) for b in r["blocks"] if b.get("task_id") == "one-thing") == 30


def test_reflow_without_edit_keeps_plan(tmp_path):
    # 排满的一天什么都不改就重排：计划一点不变（复现「重排挤掉块」时确认过的守护）
    client, plan = full_day(tmp_path)
    r = client.post("/plan/reflow", json={"version": plan["version"]}).json()
    assert r["blocks"] == plan["blocks"]


def rename(client, plan, b, title):
    return client.post("/plan/edit", json={"version": plan["version"], "block_id": b["id"],
                                           "start": b["start"], "end": b["end"], "title": title})


def test_edit_title_of_said_item(setup):
    client, db, _, plan = setup
    b = report_block(plan)
    r = rename(client, plan, b, "  写实验报告 ")
    assert r.status_code == 200
    moved = next(x for x in r.json()["blocks"] if x["id"] == b["id"])
    assert (moved["title"], moved["start"], moved["end"], moved["pinned"]) == ("写实验报告", b["start"], b["end"], True)
    assert next(i for i in db.day_items(1, DAY) if i["id"] == b["task_id"])["title"] == "写实验报告"
    assert r.json()["version"] == plan["version"] + 1


def test_edit_title_rejects_habit_and_bad_length(setup):
    client, _, _, plan = setup
    reading = next(x for x in plan["blocks"] if x["id"] == "reading")
    r = rename(client, plan, reading, "读小说")
    assert r.status_code == 422 and "设置里改" in r.json()["detail"]
    b = report_block(plan)
    assert rename(client, plan, b, "   ").status_code == 422
    assert rename(client, plan, b, "字" * 31).status_code == 422


def test_edit_title_crisis_returns_message(setup):
    client, db, _, plan = setup
    r = rename(client, plan, report_block(plan), "我不想活了").json()
    assert r["crisis"] is True and db.crisis_count(1) == 1
    assert client.get("/today").json()["version"] == plan["version"]


def test_edit_title_renames_every_block_of_the_item(tmp_path):
    db, model = Db(tmp_path / "app.db"), FakeModel()
    client = TestClient(create_app(db, model, template=TEMPLATE, now=lambda tz: datetime(2026, 11, 20, 8, 0, tzinfo=tz)))
    model.replies.append(reply(item("写报告", minutes=150, effort="heavy")))  # 一块装不下，拆成两块
    plan = say(client).json()
    parts = [b for b in plan["blocks"] if b["title"] == "写报告"]
    assert len(parts) > 1
    r = rename(client, plan, parts[0], "写实验报告").json()
    assert {b["title"] for b in r["blocks"] if b.get("task_id") == parts[0]["task_id"]} == {"写实验报告"}
