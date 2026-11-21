import sqlite3
from contextlib import closing
from datetime import date

from server.db import Db
from server.migrate_pg import TABLES, literal, to_sql

UUID = "aaaaaaaa-0000-0000-0000-000000000001"
DAY = date(2026, 11, 20)


def full_db(path):
    db = Db(path)
    for u in (1, 2):
        db.ensure_user(u)
        db.consent(u, "隐私", "隐私说明-v1")
        db.set_plan_input(u, {"wake": "07:00"})
        db.add_plan(u, DAY, {"blocks": []}, 3)
        db.save_log(u, {"date": "2026-11-20", "energy_after_class": 3, "items": {}, "blocker": "", "note": "it's ok",
                        "tomorrow_task": "", "yesterday_done": True})
        mid = db.add_message(u, DAY, "对账", "user", "今天读得很顺")
        db.add_quote(u, mid, "读得很顺", "对账", DAY)
        pid = db.propose_profile(u, "方向", "想做产品", "建档")
        db.add_review(u, DAY, {"stats": {}, "summary": "s", "adjustments": [], "question": "q？", "still_right": pid})
        db.add_model_call(u, {"model": "fake", "messages": [], "think": False, "schema": None, "reply": "{}",
                              "error": None, "ms": 3})
        db.log_crisis(u, DAY, "（测试）")
        db.upsert_deep_talk(u, 1, 1, answers={"why": "x"})
        db.add_letter(u, date(2026, 11, 20), 30, "给自己", None, None)
    return db


def test_every_table_is_covered(tmp_path):
    full_db(tmp_path / "app.db")
    with closing(sqlite3.connect(tmp_path / "app.db")) as c:
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        for t, cols in TABLES.items():
            have = {r[1] for r in c.execute(f"PRAGMA table_info({t})")} - {"user_id"}
            assert have - {"id"} <= set(cols) and (("id" in cols) == ("id" in have) or t == "users"), t
    assert tables == set(TABLES)  # 加了新表却忘了搬，这里会红


def test_only_one_users_rows_with_uuid(tmp_path):
    full_db(tmp_path / "app.db")
    sql = to_sql(str(tmp_path / "app.db"), 1, UUID)
    inserts = [line for line in sql.splitlines() if line.startswith("insert")]
    assert len(inserts) == len(TABLES)  # 每张表这个用户各一行
    assert all(f"'{UUID}'" in line for line in inserts)
    assert "'it''s ok'" in sql and "'{}'::jsonb" in sql and ", true);" in sql
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")


def test_literal():
    assert literal(None, "text") == "null" and literal(0, "bool") == "false" and literal("3", "int") == "3"
    assert literal('{"a": 1}', "json") == """'{"a": 1}'::jsonb"""
