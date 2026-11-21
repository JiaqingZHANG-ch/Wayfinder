"""合并版 App 的数据库（合并版设计 七）。每张表都带 user_id；第 7 周整体搬到 Supabase 的 Postgres。

写法尽量两边通用：JSON 先存成 TEXT（Postgres 里换 jsonb），自增 id 用 SQLite 的 INTEGER PRIMARY KEY
（Postgres 里换 bigint generated always as identity）。每个方法各自开关连接。
"""
import json
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from mentor.tone import quote_is_verbatim

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT 'zh',
    timezone TEXT NOT NULL DEFAULT 'Europe/Paris', country TEXT NOT NULL DEFAULT '',
    is_adult INTEGER, created_at TEXT NOT NULL);
-- shortcut: 整份求解器输入（daily-planner 的 JSON 格式）存在一格里，设置表单只改其中几样（server/settings.py）；
-- 习惯要单独查询统计时（第 6 周复盘）再拆出 habits/tasks 表
CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, plan_input TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS day_plans (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL, version INTEGER NOT NULL, plan TEXT NOT NULL, energy_level INTEGER,
    confirmed_at TEXT, in_calendar INTEGER NOT NULL DEFAULT 0, UNIQUE (user_id, day, version));
CREATE TABLE IF NOT EXISTS day_logs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL,
    energy_after_class INTEGER, items TEXT NOT NULL, blocker TEXT NOT NULL, note TEXT NOT NULL,
    tomorrow_task TEXT NOT NULL, yesterday_done INTEGER, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL, mode TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_quotes (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    text TEXT NOT NULL, used_in TEXT NOT NULL, day TEXT NOT NULL);
-- 档案：一条一件事。confirmed_at 为空 = 模型提的、用户还没确认，不能当事实用
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level TEXT NOT NULL, content TEXT NOT NULL, confirmed_at TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL);
-- 深度长谈：一轮 4 步，一步一行；answers 是这一步用户的回答，council 是智囊团的看法
CREATE TABLE IF NOT EXISTS deep_talks (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    round INTEGER NOT NULL, step INTEGER NOT NULL, answers TEXT NOT NULL, council TEXT, council_status TEXT,
    snoozes INTEGER NOT NULL DEFAULT 0, started_at TEXT, finished_at TEXT, UNIQUE(user_id, round, step));
-- 每周复盘：adjustments 里每条带 answer（null = 还没点，"好" / "先不改"）；still_right 是这次问「还对吗」的那条档案
CREATE TABLE IF NOT EXISTS weekly_reviews (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_end TEXT NOT NULL, stats TEXT NOT NULL, summary TEXT NOT NULL, adjustments TEXT NOT NULL,
    question TEXT NOT NULL, still_right INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, UNIQUE (user_id, week_end));
-- 每次调模型一条：事后查怪答案、用假模型回放。也是用户数据，导出和删除都要带上
CREATE TABLE IF NOT EXISTS model_calls (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, model TEXT NOT NULL, request TEXT NOT NULL, reply TEXT, error TEXT, ms INTEGER NOT NULL);
-- 同意：哪一版说明、什么时候点的同意
CREATE TABLE IF NOT EXISTS consents (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, version TEXT NOT NULL,
    at TEXT NOT NULL, PRIMARY KEY (user_id, kind));
-- 回信：用户写给将来的自己，到期前不显示原文；habit_id 是写信时那一轮接受的原型习惯（可能为空）
CREATE TABLE IF NOT EXISTS letters (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    written_on TEXT NOT NULL, due TEXT NOT NULL, days INTEGER NOT NULL, text TEXT NOT NULL,
    prototype TEXT, habit_id TEXT, created_at TEXT NOT NULL);
-- 季度回顾：scores 是 {项: 0-10}，goals 是 [{text, check}]
CREATE TABLE IF NOT EXISTS quarterly_reviews (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL, scores TEXT NOT NULL, focus TEXT NOT NULL, start TEXT NOT NULL, stop TEXT NOT NULL,
    keep TEXT NOT NULL, goals TEXT NOT NULL, created_at TEXT NOT NULL,
    council TEXT, council_status TEXT);
CREATE TABLE IF NOT EXISTS crisis_events (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL, text TEXT NOT NULL, resumed INTEGER NOT NULL DEFAULT 0);
"""

# 导出和删除覆盖的表：加了新表要加在这里（tests/test_db.py 会查漏）
USER_TABLES = ("users", "consents", "settings", "day_plans", "day_logs", "messages", "user_quotes", "profiles", "deep_talks",
               "weekly_reviews", "model_calls", "crisis_events", "letters",
               "quarterly_reviews")
JSON_COLUMNS = ("plan_input", "plan", "items", "stats", "adjustments", "request", "answers", "council", "scores", "goals")
QUOTE_USES = ("档案", "对账", "复盘", "回信")
PROFILE_LEVELS = ("使命", "目标", "障碍", "策略", "方向", "近期观察")
PROFILE_SOURCES = ("建档", "复盘", "深度长谈", "季度回顾")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Db:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._run(lambda c: c.executescript(SCHEMA))

    def _run(self, fn):
        with closing(sqlite3.connect(self._path)) as conn, conn:  # 内层 with 负责提交或回滚
            conn.execute("PRAGMA foreign_keys = ON")
            return fn(conn)

    # 用户和设置
    def ensure_user(self, user_id: int, *, timezone_name: str = "Europe/Paris") -> None:
        self._run(lambda c: c.execute(
            "INSERT OR IGNORE INTO users (id, timezone, created_at) VALUES (?, ?, ?)",
            (user_id, timezone_name, _now())))

    def user_timezone(self, user_id: int) -> str:
        return self._run(lambda c: c.execute("SELECT timezone FROM users WHERE id = ?", (user_id,)).fetchone())[0]

    def user_info(self, user_id: int) -> dict:
        country, adult = self._run(lambda c: c.execute(
            "SELECT country, is_adult FROM users WHERE id = ?", (user_id,)).fetchone())
        return {"country": country, "is_adult": None if adult is None else bool(adult)}

    def update_user(self, user_id: int, *, country: str, is_adult: bool) -> None:
        self._run(lambda c: c.execute("UPDATE users SET country = ?, is_adult = ? WHERE id = ?",
                                      (country, int(is_adult), user_id)))

    def consent(self, user_id: int, kind: str, version: str) -> None:
        self._run(lambda c: c.execute(
            "INSERT OR REPLACE INTO consents (user_id, kind, version, at) VALUES (?, ?, ?, ?)",
            (user_id, kind, version, _now())))

    def consents(self, user_id: int) -> dict[str, str]:
        """{kind: version}"""
        return dict(self._run(lambda c: c.execute(
            "SELECT kind, version FROM consents WHERE user_id = ?", (user_id,)).fetchall()))

    def export(self, user_id: int) -> dict[str, list[dict]]:
        """这个用户在每张表里的全部行，JSON 列解开。"""
        def go(c):
            out = {}
            for t in USER_TABLES:
                cur = c.execute(f"SELECT * FROM {t} WHERE {'id' if t == 'users' else 'user_id'} = ?", (user_id,))
                cols = [d[0] for d in cur.description]
                out[t] = [{k: json.loads(v) if k in JSON_COLUMNS and v is not None else v for k, v in zip(cols, row)} for row in cur]
            return out
        return self._run(go)

    def add_letter(self, user_id: int, written_on: date, days: int, text: str, prototype: str | None,
                   habit_id: str | None) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO letters (user_id, written_on, due, days, text, prototype, habit_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, written_on.isoformat(), (written_on + timedelta(days=days)).isoformat(), days, text, prototype,
             habit_id, _now())))

    def letters(self, user_id: int) -> list[dict]:
        def go(c):
            cur = c.execute("SELECT * FROM letters WHERE user_id = ? ORDER BY due, id", (user_id,))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur]
        return self._run(go)

    def add_quarter(self, user_id: int, day: date, scores: dict, focus: str, start: str, stop: str, keep: str,
                    goals: list[dict]) -> int:
        return self._run(lambda c: c.execute(
            "INSERT INTO quarterly_reviews (user_id, day, scores, focus, start, stop, keep, goals, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, day.isoformat(), json.dumps(scores, ensure_ascii=False), focus, start, stop, keep,
             json.dumps(goals, ensure_ascii=False), _now())).lastrowid)

    def last_quarter(self, user_id: int) -> dict | None:
        def go(c):
            cur = c.execute("SELECT id, day, scores, focus, start, stop, keep, goals, council, council_status FROM quarterly_reviews "
                            "WHERE user_id = ? ORDER BY day DESC, id DESC LIMIT 1", (user_id,))
            row = cur.fetchone()
            if row is None:
                return None
            d = dict(zip([x[0] for x in cur.description], row))
            return {**d, "scores": json.loads(d["scores"]), "goals": json.loads(d["goals"]),
                    "council": json.loads(d["council"]) if d["council"] else None}
        return self._run(go)

    def set_quarter_council(self, quarter_id: int, council: dict | None, status: str) -> None:
        self._run(lambda c: c.execute("UPDATE quarterly_reviews SET council = ?, council_status = ? WHERE id = ?",
                                      (None if council is None else json.dumps(council, ensure_ascii=False), status, quarter_id)))

    def delete_user(self, user_id: int) -> None:
        """删掉这个用户和他的全部数据（各表外键都是 ON DELETE CASCADE）。"""
        self._run(lambda c: c.execute("DELETE FROM users WHERE id = ?", (user_id,)))

    # 深度长谈
    def deep_talk_rows(self, user_id: int, round: int) -> list[dict]:
        def go(c):
            cur = c.execute("SELECT * FROM deep_talks WHERE user_id = ? AND round = ? ORDER BY step", (user_id, round))
            cols = [d[0] for d in cur.description]
            return [{k: json.loads(v) if k in JSON_COLUMNS and v is not None else v for k, v in zip(cols, r)}
                    for r in cur]
        return self._run(go)

    def deep_talk_round(self, user_id: int) -> int:
        row = self._run(lambda c: c.execute("SELECT MAX(round) FROM deep_talks WHERE user_id = ?", (user_id,)).fetchone())
        return row[0] or 1

    def upsert_deep_talk(self, user_id: int, round: int, step: int, /, **fields) -> None:
        """没有这一行就建，有就只改给出的字段。"""
        bad = set(fields) - {"answers", "council", "council_status", "snoozes", "started_at", "finished_at"}
        if bad:
            raise ValueError(f"不能改的字段：{sorted(bad)}")
        vals = {k: json.dumps(v, ensure_ascii=False) if k in JSON_COLUMNS and v is not None else v
                for k, v in fields.items()}
        vals.setdefault("answers", "{}")
        cols = ", ".join(vals)
        sets = ", ".join(f"{k} = excluded.{k}" for k in fields)  # 没给的字段不动
        self._run(lambda c: c.execute(
            f"INSERT INTO deep_talks (user_id, round, step, {cols}) VALUES (?, ?, ?, {', '.join('?' * len(vals))}) "
            f"ON CONFLICT(user_id, round, step) DO " + (f"UPDATE SET {sets}" if sets else "NOTHING"),
            (user_id, round, step, *vals.values())))

    def plan_input(self, user_id: int) -> dict | None:
        row = self._run(lambda c: c.execute("SELECT plan_input FROM settings WHERE user_id = ?", (user_id,)).fetchone())
        return None if row is None else json.loads(row[0])

    def set_plan_input(self, user_id: int, raw: dict) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO settings (user_id, plan_input) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET plan_input = excluded.plan_input",
            (user_id, json.dumps(raw, ensure_ascii=False))))

    # 计划：每次重排加一个新版本，旧版本留着
    def add_plan(self, user_id: int, day: date, plan: dict, energy_level: int | None,
                 *, only_if_none: bool = False) -> int:
        """存一个新版本，返回版本号。only_if_none：这天已经有计划就不存（两个请求同时生成当天计划时用）。"""
        def go(c):
            c.execute("BEGIN IMMEDIATE")  # 先拿写锁再读版本号，两个请求同时来也不会撞号
            (latest,) = c.execute("SELECT COALESCE(MAX(version), 0) FROM day_plans WHERE user_id = ? AND day = ?",
                                  (user_id, day.isoformat())).fetchone()
            if only_if_none and latest:
                return latest
            c.execute("INSERT INTO day_plans (user_id, day, version, plan, energy_level) VALUES (?, ?, ?, ?, ?)",
                      (user_id, day.isoformat(), latest + 1, json.dumps(plan, ensure_ascii=False), energy_level))
            return latest + 1
        return self._run(go)

    def latest_plan(self, user_id: int, day: date) -> dict | None:
        """最新一版：{version, plan, energy_level, confirmed_at}；这天还没有计划就是 None。"""
        row = self._run(lambda c: c.execute(
            "SELECT version, plan, energy_level, confirmed_at FROM day_plans WHERE user_id = ? AND day = ? "
            "ORDER BY version DESC LIMIT 1", (user_id, day.isoformat())).fetchone())
        if row is None:
            return None
        version, plan, energy, confirmed = row
        return {"version": version, "plan": json.loads(plan), "energy_level": energy, "confirmed_at": confirmed}

    def confirm_plan(self, user_id: int, day: date, version: int) -> bool:
        cur = self._run(lambda c: c.execute(
            "UPDATE day_plans SET confirmed_at = ? WHERE user_id = ? AND day = ? AND version = ?",
            (_now(), user_id, day.isoformat(), version)))
        return cur.rowcount == 1

    def mark_in_calendar(self, user_id: int, day: date, version: int) -> None:
        self._run(lambda c: c.execute("UPDATE day_plans SET in_calendar = 1 WHERE user_id = ? AND day = ? AND version = ?",
                                      (user_id, day.isoformat(), version)))

    # 对账
    def save_log(self, user_id: int, result: dict) -> None:
        """result 是 mentor.checkin.validate_checkin 校验过的格式。同一天再记一次就覆盖。"""
        done = result["yesterday_done"]
        self._run(lambda c: c.execute(
            "INSERT OR REPLACE INTO day_logs (user_id, day, energy_after_class, items, blocker, note, "
            "tomorrow_task, yesterday_done) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, result["date"], result["energy_after_class"], json.dumps(result["items"], ensure_ascii=False),
             result["blocker"], result["note"], result["tomorrow_task"], None if done is None else int(done))))

    def logs_between(self, user_id: int, start: date, end: date) -> list[dict]:
        rows = self._run(lambda c: c.execute(
            "SELECT day, energy_after_class, items, blocker, note, tomorrow_task, yesterday_done FROM day_logs "
            "WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day",
            (user_id, start.isoformat(), end.isoformat())).fetchall())
        return [{"date": d, "energy_after_class": e, "items": json.loads(i), "blocker": b, "note": n,
                 "tomorrow_task": t, "yesterday_done": None if y is None else bool(y)}
                for d, e, i, b, n, t, y in rows]

    def first_log_day(self, user_id: int) -> date | None:
        (d,) = self._run(lambda c: c.execute("SELECT MIN(day) FROM day_logs WHERE user_id = ?", (user_id,)).fetchone())
        return None if d is None else date.fromisoformat(d)

    def days_with_note(self, user_id: int, start: date, end: date) -> list[str]:
        """这段时间里哪几天写了一句话（note 不是空的），按日期排好。"""
        rows = self._run(lambda c: c.execute(
            "SELECT day FROM day_logs WHERE user_id = ? AND day BETWEEN ? AND ? AND note != '' ORDER BY day",
            (user_id, start.isoformat(), end.isoformat())).fetchall())
        return [d for (d,) in rows]

    # 对话和原话
    def add_message(self, user_id: int, day: date, mode: str, role: str, content: str) -> int:
        cur = self._run(lambda c: c.execute(
            "INSERT INTO messages (user_id, day, mode, role, content) VALUES (?, ?, ?, ?, ?)",
            (user_id, day.isoformat(), mode, role, content)))
        return cur.lastrowid

    def messages(self, user_id: int, mode: str) -> list[dict]:
        rows = self._run(lambda c: c.execute(
            "SELECT id, role, content FROM messages WHERE user_id = ? AND mode = ? ORDER BY id", (user_id, mode)).fetchall())
        return [{"id": i, "role": r, "content": t} for i, r, t in rows]

    def add_quote(self, user_id: int, message_id: int, text: str, used_in: str, day: date) -> int:
        """记一条用户原话。必须是这个用户、这条消息内容里一字不差的连续片段，否则抛 ValueError。"""
        if used_in not in QUOTE_USES:
            raise ValueError(f"used_in 只能是 {'/'.join(QUOTE_USES)}")

        def go(c):
            row = c.execute("SELECT content FROM messages WHERE id = ? AND user_id = ? AND role = 'user'",
                            (message_id, user_id)).fetchone()
            if row is None or not quote_is_verbatim(text, row[0]):
                raise ValueError("这句话不是该用户在这条消息里的原话")
            return c.execute("INSERT INTO user_quotes (user_id, message_id, text, used_in, day) VALUES (?, ?, ?, ?, ?)",
                             (user_id, message_id, text, used_in, day.isoformat())).lastrowid
        return self._run(go)

    def quotes(self, user_id: int) -> list[dict]:
        rows = self._run(lambda c: c.execute(
            "SELECT message_id, text, used_in, day FROM user_quotes WHERE user_id = ? ORDER BY id",
            (user_id,)).fetchall())
        return [{"message_id": m, "text": t, "used_in": u, "day": d} for m, t, u, d in rows]

    # 档案：模型只能提议，用户点了确认才算数
    def propose_profile(self, user_id: int, level: str, content: str, source: str) -> int:
        if level not in PROFILE_LEVELS or source not in PROFILE_SOURCES or not content.strip():
            raise ValueError("档案的层级、来源不对，或者内容是空的")
        return self._run(lambda c: c.execute(
            "INSERT INTO profiles (user_id, level, content, source, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, level, content.strip(), source, _now())).lastrowid)

    def delete_profiles(self, user_id: int, level: str, source: str) -> None:
        self._run(lambda c: c.execute("DELETE FROM profiles WHERE user_id = ? AND level = ? AND source = ?",
                                      (user_id, level, source)))

    def confirm_profile(self, user_id: int, profile_id: int, content: str | None = None) -> bool:
        """用户确认一条档案（可以先改字）。也用于「还对吗」之后的再确认：confirmed_at 更新成现在。"""
        if content is not None and not content.strip():
            raise ValueError("档案内容不能是空的")
        cur = self._run(lambda c: c.execute(
            "UPDATE profiles SET confirmed_at = ?, content = COALESCE(?, content) WHERE id = ? AND user_id = ?",
            (_now(), None if content is None else content.strip(), profile_id, user_id)))
        return cur.rowcount == 1

    def profiles(self, user_id: int, *, confirmed: bool) -> list[dict]:
        cond = "IS NOT NULL" if confirmed else "IS NULL"
        rows = self._run(lambda c: c.execute(
            f"SELECT id, level, content, confirmed_at, source FROM profiles WHERE user_id = ? AND confirmed_at {cond} "
            "ORDER BY id", (user_id,)).fetchall())
        return [{"id": i, "level": lv, "content": ct, "confirmed_at": ca, "source": s} for i, lv, ct, ca, s in rows]

    def stalest_profile(self, user_id: int, today: date) -> dict | None:
        """已确认、且最久没再确认的那条；离上次确认不到 14 天就是 None（第 6 周复盘问「还对吗」用）。"""
        # confirmed_at 是 UTC 时间，date() 取它的日期；和 today 差 14 天及以上才算「该问一下」
        row = self._run(lambda c: c.execute(
            "SELECT id, level, content, confirmed_at, source FROM profiles WHERE user_id = ? "
            "AND confirmed_at IS NOT NULL AND date(confirmed_at) <= date(?, '-14 days') "
            "ORDER BY confirmed_at, id LIMIT 1", (user_id, today.isoformat())).fetchone())
        if row is None:
            return None
        i, lv, ct, ca, s = row
        return {"id": i, "level": lv, "content": ct, "confirmed_at": ca, "source": s}

    # 每周复盘
    def add_review(self, user_id: int, week_end: date, review: dict) -> None:
        """review：{stats, summary, adjustments, question, still_right}。这一周已经有了就不再存（同时来两个请求时）。"""
        adjustments = [{**a, "answer": None} for a in review["adjustments"]]
        self._run(lambda c: c.execute(
            "INSERT OR IGNORE INTO weekly_reviews (user_id, week_end, stats, summary, adjustments, question, still_right, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, week_end.isoformat(), json.dumps(review["stats"], ensure_ascii=False), review["summary"],
             json.dumps(adjustments, ensure_ascii=False), review["question"], review["still_right"], _now())))

    def reviews(self, user_id: int, *, limit: int = 1) -> list[dict]:
        """最近几次复盘，新的在前。"""
        rows = self._run(lambda c: c.execute(
            "SELECT id, week_end, stats, summary, adjustments, question, still_right FROM weekly_reviews "
            "WHERE user_id = ? ORDER BY week_end DESC LIMIT ?", (user_id, limit)).fetchall())
        return [{"id": i, "week_end": w, "stats": json.loads(st), "summary": su, "adjustments": json.loads(a),
                 "question": q, "still_right": sr} for i, w, st, su, a, q, sr in rows]

    def answer_adjustment(self, user_id: int, review_id: int, index: int, answer: str) -> bool:
        """记下用户对第 index 条调整点的「好」或「先不改」。已经点过的不能改，返回 False。"""
        def go(c):
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT adjustments FROM weekly_reviews WHERE id = ? AND user_id = ?",
                            (review_id, user_id)).fetchone()
            adjustments = json.loads(row[0]) if row else []
            if not 0 <= index < len(adjustments) or adjustments[index]["answer"] is not None:
                return False
            adjustments[index]["answer"] = answer
            c.execute("UPDATE weekly_reviews SET adjustments = ? WHERE id = ?",
                      (json.dumps(adjustments, ensure_ascii=False), review_id))
            return True
        return self._run(go)

    # 模型调用记录
    def add_model_call(self, user_id: int, call: dict) -> None:
        request = {k: call[k] for k in ("messages", "think", "schema")}
        self._run(lambda c: c.execute(
            "INSERT INTO model_calls (user_id, created_at, model, request, reply, error, ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, _now(), call["model"], json.dumps(request, ensure_ascii=False), call["reply"], call["error"],
             call["ms"])))

    def model_calls(self, user_id: int) -> list[dict]:
        rows = self._run(lambda c: c.execute(
            "SELECT id, created_at, model, request, reply, error, ms FROM model_calls WHERE user_id = ? ORDER BY id",
            (user_id,)).fetchall())
        return [{"id": i, "created_at": t, "model": m, **json.loads(rq), "reply": rp, "error": e, "ms": ms}
                for i, t, m, rq, rp, e, ms in rows]

    # 危机
    def log_crisis(self, user_id: int, day: date, text: str) -> None:
        self._run(lambda c: c.execute("INSERT INTO crisis_events (user_id, day, text) VALUES (?, ?, ?)",
                                      (user_id, day.isoformat(), text)))

    def crisis_count(self, user_id: int) -> int:
        return self._run(lambda c: c.execute(
            "SELECT COUNT(*) FROM crisis_events WHERE user_id = ?", (user_id,)).fetchone())[0]
