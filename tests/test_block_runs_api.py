"""做事陪跑接口：被打断、继续、做完（/block/{id}/pause|resume|done），/today 的 runs 和块、番茄提醒。

夹具这一天（08:00 说「今天写报告，五点开会」）里：写报告 18:45–20:15（proj），后面 20:15–20:45 是自由时间，
20:45 看书；09:00 高数是课。
"""
import pytest

from test_day_say_api import MEETING, REPORT, clocked, reply, say


@pytest.fixture
def day(tmp_path):
    client, db, model, t = clocked(tmp_path)
    model.replies.append(reply(MEETING, REPORT))
    plan = say(client).json()
    return client, t, plan


def report(plan):
    return next(b for b in plan["blocks"] if b["title"] == "写报告")


def block(plan, block_id):
    return next(b for b in plan["blocks"] if b["id"] == block_id)


def act(client, what, block_id):
    return client.post(f"/block/{block_id}/{what}")


def test_pause_creates_run_at_planned_start(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [19, 5]
    r = act(client, "pause", rid)
    assert r.status_code == 200
    run = r.json()["runs"][rid]
    assert run["started_at"][11:16] == "18:45" and len(run["pauses"]) == 1 and run["pauses"][0][1] is None
    assert r.json()["version"] == plan["version"]


def test_pause_twice_409_class_422_missing_404_not_started_409(day):
    client, t, plan = day
    rid = report(plan)["id"]
    assert act(client, "pause", rid).status_code == 409  # 08:00 还没开始
    t[:] = [19, 5]
    assert act(client, "pause", rid).status_code == 200
    assert act(client, "pause", rid).status_code == 409
    t[:] = [10, 0]
    assert act(client, "pause", "math").status_code == 422
    assert act(client, "pause", "nope").status_code == 404


def test_short_resume_extends_and_absorbs_into_gap(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [19, 5]
    act(client, "pause", rid)
    t[:] = [19, 12]  # 停了 7 分钟 → 往后推 10 分钟
    r = act(client, "resume", rid).json()
    assert (r["ask_reflow"], r["overlaps"]) == (False, [])
    assert block(r, rid)["end"] == "20:25"
    assert "free-2" not in {b["id"] for b in r["blocks"]}  # 自由时间剪到 20 分钟就不要了
    assert block(r, "reading")["start"] == "20:45"  # 空档吸收掉了，后面不动
    assert [b.get("pinned") for b in r["blocks"]] == [None] * len(r["blocks"])
    assert r["version"] == plan["version"] + 1


def test_resume_exactly_15_is_small(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [19, 5]
    act(client, "pause", rid)
    t[:] = [19, 20]
    assert act(client, "resume", rid).json()["ask_reflow"] is False


def test_long_resume_asks_reflow_then_reflow_keeps_block(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [19, 5]
    act(client, "pause", rid)
    t[:] = [19, 25]
    r = act(client, "resume", rid).json()
    assert r["ask_reflow"] is True and block(r, rid)["end"] == "20:35"
    after = client.post("/plan/reflow", json={"version": r["version"]}).json()
    assert (block(after, rid)["start"], block(after, rid)["end"]) == ("18:45", "20:35")


def test_resume_after_block_end(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [20, 0]
    act(client, "pause", rid)
    t[:] = [20, 25]
    r = act(client, "resume", rid)
    assert r.status_code == 200 and r.json()["ask_reflow"] is True


def test_resume_without_pause_409(day):
    client, t, plan = day
    t[:] = [19, 5]
    assert act(client, "resume", report(plan)["id"]).status_code == 409


def test_runs_survive_reflow(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [19, 5]
    v = act(client, "pause", rid).json()["version"]
    t[:] = [19, 6]
    client.post("/plan/reflow", json={"version": v})
    today = client.get("/today").json()
    assert rid in today["runs"] and rid in {b["id"] for b in today["blocks"]}


def test_done_early_cuts_block(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [19, 16]  # 开始后 31 分钟
    r = act(client, "done", rid).json()
    assert block(r, rid)["end"] == "19:20"
    assert r["runs"][rid]["actual_min"] == 31 and r["version"] == plan["version"] + 1
    assert [b for b in r["blocks"] if b["id"] != rid] == [b for b in plan["blocks"] if b["id"] != rid]


def test_done_while_paused_closes_pause(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [19, 5]
    act(client, "pause", rid)
    t[:] = [19, 15]
    run = act(client, "done", rid).json()["runs"][rid]
    assert run["pauses"][-1][1] is not None and run["actual_min"] == 20


def test_done_then_pause_409(day):
    client, t, plan = day
    rid = report(plan)["id"]
    t[:] = [20, 10]
    act(client, "done", rid)
    assert act(client, "pause", rid).status_code == 409
    assert act(client, "resume", rid).status_code == 409
    assert act(client, "done", rid).status_code == 409


def test_done_before_start_409(day):
    client, _, plan = day
    assert act(client, "done", report(plan)["id"]).status_code == 409


def test_confirmed_stays_confirmed(day):
    client, t, plan = day
    rid = report(plan)["id"]
    client.post("/plan/confirm", json={"version": plan["version"]})
    t[:] = [19, 5]
    act(client, "pause", rid)
    t[:] = [19, 10]
    assert act(client, "resume", rid).json()["confirmed"] is True


def test_today_has_block_reminders(day):
    client, _, plan = day
    rem = [r for r in client.get("/today").json()["reminders"] if r["kind"] == "block"]
    assert {r["at"] for r in rem} == {"17:00", "18:45", "20:45", "21:45"}  # 开会（说的事）、写报告、看书、复习；08:00 的背单词已经开始了
    assert all(r["url"] == "/" for r in rem)


def test_export_and_delete_include_block_runs(day):
    client, t, plan = day
    t[:] = [19, 5]
    act(client, "pause", report(plan)["id"])
    assert len(client.get("/export").json()["tables"]["block_runs"]) == 1
    client.delete("/me", params={"confirm": "true"})
    assert client.get("/export").json()["tables"]["block_runs"] == []
