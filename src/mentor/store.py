"""数据库：建表与读写。不依赖界面和模型。每个方法各自开关连接，界面在别的线程里调用也安全。"""
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import date
from pathlib import Path


@dataclass(frozen=True)
class Habit:
    name: str
    daily_minutes: int


@dataclass(frozen=True)
class Message:
    day: date
    mode: str
    role: str  # "user" | "assistant"
    content: str


@dataclass(frozen=True)
class Daily:
    day: date
    minutes: int
    did: str
    blocker: str
    tomorrow_task: str
    done: bool | None = None  # 这一天定下的「明天的一件事」后来做到没有


@dataclass(frozen=True)
class Weekly:
    day: date
    pattern: str
    adjustment: str


_SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, mode TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily (
    day TEXT PRIMARY KEY, minutes INTEGER NOT NULL, did TEXT NOT NULL, blocker TEXT NOT NULL,
    tomorrow_task TEXT NOT NULL, done INTEGER);
CREATE TABLE IF NOT EXISTS weekly (day TEXT PRIMARY KEY, pattern TEXT NOT NULL, adjustment TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crisis (
    id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, text TEXT NOT NULL,
    resumed INTEGER NOT NULL DEFAULT 0);
"""


def _to_done(value: int | None) -> bool | None:
    return None if value is None else bool(value)


def _to_daily(row: tuple) -> Daily:
    day, minutes, did, blocker, tomorrow_task, done = row
    return Daily(date.fromisoformat(day), minutes, did, blocker, tomorrow_task, _to_done(done))


_DAILY_COLS = "day, minutes, did, blocker, tomorrow_task, done"


class Store:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._run(lambda c: c.executescript(_SCHEMA))

    def _run(self, fn):
        with closing(sqlite3.connect(self._path)) as conn, conn:  # 内层 with 负责提交或回滚
            return fn(conn)

    def _get(self, key: str) -> str | None:
        row = self._run(lambda c: c.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone())
        return None if row is None else row[0]

    def _set(self, key: str, value: str) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value)))

    # 档案与习惯
    def get_profile(self) -> str | None:
        return self._get("profile")

    def set_profile(self, text: str, on: date) -> None:
        self._set("profile", text)
        if self._get("profile_date") is None:
            self._set("profile_date", on.isoformat())

    def profile_date(self) -> date | None:
        value = self._get("profile_date")
        return None if value is None else date.fromisoformat(value)

    def get_habit(self) -> Habit | None:
        name, minutes = self._get("habit_name"), self._get("habit_minutes")
        return None if name is None or minutes is None else Habit(name, int(minutes))

    def set_habit(self, habit: Habit) -> None:
        self._set("habit_name", habit.name)
        self._set("habit_minutes", str(habit.daily_minutes))

    # 对话
    def add_message(self, m: Message) -> None:
        self._run(lambda c: c.execute(
            "INSERT INTO messages (day, mode, role, content) VALUES (?, ?, ?, ?)",
            (m.day.isoformat(), m.mode, m.role, m.content)))

    def messages(self, mode: str, day: date | None = None) -> list[Message]:
        sql, args = "SELECT day, mode, role, content FROM messages WHERE mode = ?", [mode]
        if day is not None:
            sql, args = sql + " AND day = ?", args + [day.isoformat()]
        rows = self._run(lambda c: c.execute(sql + " ORDER BY id", args).fetchall())
        return [Message(date.fromisoformat(d), mo, r, t) for d, mo, r, t in rows]

    # 每日记录
    def save_daily(self, d: Daily) -> None:
        done = None if d.done is None else int(d.done)
        self._run(lambda c: c.execute(
            f"INSERT OR REPLACE INTO daily ({_DAILY_COLS}) VALUES (?, ?, ?, ?, ?, ?)",
            (d.day.isoformat(), d.minutes, d.did, d.blocker, d.tomorrow_task, done)))

    def daily_between(self, start: date, end: date) -> list[Daily]:
        rows = self._run(lambda c: c.execute(
            f"SELECT {_DAILY_COLS} FROM daily WHERE day BETWEEN ? AND ? ORDER BY day",
            (start.isoformat(), end.isoformat())).fetchall())
        return [_to_daily(r) for r in rows]

    def last_daily_before(self, day: date) -> Daily | None:
        row = self._run(lambda c: c.execute(
            f"SELECT {_DAILY_COLS} FROM daily WHERE day < ? ORDER BY day DESC LIMIT 1",
            (day.isoformat(),)).fetchone())
        return None if row is None else _to_daily(row)

    def set_done(self, day: date, done: bool) -> None:
        self._run(lambda c: c.execute("UPDATE daily SET done = ? WHERE day = ?", (int(done), day.isoformat())))

    def update_daily(self, day: date, *, minutes: int, tomorrow_task: str, done: bool | None) -> None:
        value = None if done is None else int(done)
        self._run(lambda c: c.execute(
            "UPDATE daily SET minutes = ?, tomorrow_task = ?, done = ? WHERE day = ?",
            (minutes, tomorrow_task, value, day.isoformat())))

    # 每周复盘
    def save_weekly(self, w: Weekly) -> None:
        self._run(lambda c: c.execute(
            "INSERT OR REPLACE INTO weekly (day, pattern, adjustment) VALUES (?, ?, ?)",
            (w.day.isoformat(), w.pattern, w.adjustment)))

    def all_weekly(self) -> list[Weekly]:
        rows = self._run(lambda c: c.execute(
            "SELECT day, pattern, adjustment FROM weekly ORDER BY day DESC").fetchall())
        return [Weekly(date.fromisoformat(d), p, a) for d, p, a in rows]

    # 危机暂停
    def log_crisis(self, day: date, text: str) -> None:
        self._run(lambda c: c.execute("INSERT INTO crisis (day, text) VALUES (?, ?)", (day.isoformat(), text)))

    def is_paused(self, day: date) -> bool:
        row = self._run(lambda c: c.execute(
            "SELECT 1 FROM crisis WHERE day = ? AND resumed = 0 LIMIT 1", (day.isoformat(),)).fetchone())
        return row is not None

    def resume(self, day: date) -> None:
        self._run(lambda c: c.execute("UPDATE crisis SET resumed = 1 WHERE day = ?", (day.isoformat(),)))

    # 一次性标记（比如首次使用说明看过了）
    def get_flag(self, name: str) -> bool:
        return self._get(f"flag:{name}") == "1"

    def set_flag(self, name: str) -> None:
        self._set(f"flag:{name}", "1")
