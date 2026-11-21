"""第 7 周循环 ④：把本机 SQLite 里一个用户的数据写成 Postgres 的 INSERT 语句。

    uv run python -m server.migrate_pg var/app.db <Supabase 里登录账号的 uuid> > var/migrate.sql
    psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f var/migrate.sql

先 supabase start 并用这个账号注册一次（auth.users 里要有它）。id 原样保留，user_quotes、weekly_reviews 的外键才对得上。
"""
import json
import sqlite3
import sys
from contextlib import closing

# 每张表：列名 → 类型（text 原样、json 转 jsonb、bool 把 0/1 转成 true/false、int）
TABLES = {
    "users": {"display_name": "text", "lang": "text", "timezone": "text", "country": "text", "is_adult": "bool",
              "created_at": "text"},
    "consents": {"kind": "text", "version": "text", "at": "text"},
    "settings": {"plan_input": "json"},
    "day_plans": {"id": "int", "day": "text", "version": "int", "plan": "json", "energy_level": "int",
                  "confirmed_at": "text", "in_calendar": "bool"},
    "day_logs": {"day": "text", "energy_after_class": "int", "items": "json", "blocker": "text", "note": "text",
                 "tomorrow_task": "text", "yesterday_done": "bool"},
    "messages": {"id": "int", "day": "text", "mode": "text", "role": "text", "content": "text"},
    "user_quotes": {"id": "int", "message_id": "int", "text": "text", "used_in": "text", "day": "text"},
    "profiles": {"id": "int", "level": "text", "content": "text", "confirmed_at": "text", "source": "text",
                 "created_at": "text"},
    "deep_talks": {"id": "int", "round": "int", "step": "int", "answers": "json", "council": "json",
                   "council_status": "text", "snoozes": "int", "started_at": "text", "finished_at": "text"},
    "weekly_reviews": {"id": "int", "week_end": "text", "stats": "json", "summary": "text", "adjustments": "json",
                       "question": "text", "still_right": "int", "created_at": "text"},
    "model_calls": {"id": "int", "created_at": "text", "model": "text", "request": "json", "reply": "text",
                    "error": "text", "ms": "int"},
    "crisis_events": {"id": "int", "day": "text", "text": "text", "resumed": "bool"},
    "letters": {"id": "int", "written_on": "text", "due": "text", "days": "int", "text": "text", "prototype": "text",
                "habit_id": "text", "created_at": "text"},
    "quarterly_reviews": {"id": "int", "day": "text", "scores": "json", "focus": "text", "start": "text",
                          "stop": "text", "keep": "text", "goals": "json", "created_at": "text"},
}


def literal(value, kind: str) -> str:
    if value is None:
        return "null"
    if kind == "int":
        return str(int(value))
    if kind == "bool":
        return "true" if value else "false"
    text = "'" + str(value).replace("'", "''") + "'"
    if kind == "json":
        json.loads(value)  # 坏的 JSON 在这里就报错，不带进 Postgres
        return text + "::jsonb"
    return text


def to_sql(db_path: str, user_id: int, uuid: str) -> str:
    out = ["begin;"]
    with closing(sqlite3.connect(db_path)) as conn:
        for table, cols in TABLES.items():
            owner = "id" if table == "users" else "user_id"
            names = list(cols)
            for row in conn.execute(f"SELECT {', '.join(names)} FROM {table} WHERE {owner} = ? ORDER BY rowid", (user_id,)):
                values = [literal(uuid, "text")] + [literal(v, cols[n]) for n, v in zip(names, row)]
                overriding = " overriding system value" if "id" in cols else ""
                out.append(f"insert into public.{table} ({owner}, {', '.join(names)}){overriding} "
                           f"values ({', '.join(values)});")
    # 保留了原来的 id，自增要从最大的 id 往后接
    out += [f"select setval(pg_get_serial_sequence('public.{t}', 'id'), (select coalesce(max(id), 0) + 1 from public.{t}), false);"
            for t, cols in TABLES.items() if "id" in cols]
    out.append("commit;")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("用法：python -m server.migrate_pg <app.db> <uuid>")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(to_sql(sys.argv[1], 1, sys.argv[2]))
