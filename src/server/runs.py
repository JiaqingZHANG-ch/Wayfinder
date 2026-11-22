"""做事陪跑的纯函数：被打断后往后推、提前做完时截短、专注了多久、块开始和番茄的提醒。不碰数据库。

块是计划 JSON 里的 dict（start / end 是 HH:MM）；run 是 block_runs 的一行（时间是带时区的 ISO 字符串）。
"""
from datetime import datetime, timedelta
from typing import Callable

from planner.model import to_hhmm, to_min
from planner.solve import FREE_MIN_GAP, POMODORO_MIN

MIN_BLOCK = 10  # 一块最短几分钟（手动改、提前做完截短都按这个）
BREAK_AT = 25  # 一个番茄里专注到第几分钟开始小歇
SMALL_BREAK = 15  # 被打断不超过这么多分钟算小打断：继续时只往后推，不问重排（用户定的）


def _fixed(b: dict) -> bool:
    """往后推时挪不动的：课（用户说的固定事项求解器也输出成 class）和钉住的。"""
    return b["kind"] == "class" or bool(b.get("pinned"))


def _free(b: dict) -> bool:
    return b["id"].startswith("free-")


def _span(b: dict, start: int, end: int) -> dict:
    return {**b, "start": to_hhmm(start), "end": to_hhmm(end)}


def _sorted(blocks: list[dict]) -> list[dict]:
    return sorted(blocks, key=lambda b: to_min(b["start"]))


def extend(blocks: list[dict], block_id: str, minutes: int, sleep: int, ripple: bool) -> tuple[list[dict], bool]:
    """这一块往后延长 minutes 分钟；ripple 时把后面的块依次往后推（中间的空档吸收掉）。
    延长到不了（撞上课或钉住的块、过了上床时间）或者推不开，ok 就是 False，这时只返回这一块延长后的样子。"""
    blocks = _sorted(blocks)
    i = next(k for k, b in enumerate(blocks) if b["id"] == block_id)
    b = blocks[i]
    end = to_min(b["end"])
    wall = min([to_min(x["start"]) for x in blocks if x is not b and _fixed(x) and to_min(x["start"]) >= end] + [sleep])
    new_end = min(end + minutes, wall)
    extended = [*blocks[:i], _span(b, to_min(b["start"]), new_end), *blocks[i + 1:]]
    if not ripple or new_end < end + minutes:
        return extended, False
    out, prev = extended[:i + 1], new_end
    for k, x in enumerate(blocks[i + 1:], start=i + 1):
        s, e = to_min(x["start"]), to_min(x["end"])
        if _free(x):  # 自由时间不挡路：被压到就剪短，太短就不要了
            if s < prev:
                if e - prev >= FREE_MIN_GAP:
                    out.append(_span(x, prev, e))
                continue
            out.append(x)
            continue
        if s >= prev:  # 不重叠了：后面的都不用动
            out.extend(blocks[k:])
            break
        if _fixed(x) or e + prev - s > sleep:
            return extended, False
        out.append(_span(x, prev, e + prev - s))
        prev = e + prev - s
    return _sorted(out), True


def clashes(blocks: list[dict], block_id: str) -> list[str]:
    """和这一块重叠的块（自由时间不算），连这一块自己，按开始时间；没撞上就是空的。"""
    b = next(x for x in blocks if x["id"] == block_id)
    hit = [x for x in blocks if x is not b and not _free(x)
           and to_min(x["start"]) < to_min(b["end"]) and to_min(b["start"]) < to_min(x["end"])]
    return [x["id"] for x in _sorted([b, *hit])] if hit else []


def cut_at(blocks: list[dict], block_id: str, now_min: int) -> list[dict] | None:
    """提前做完：这一块的结束改成现在（向上取整到 5 分钟）。不比原来早、或者剩不到 MIN_BLOCK 分钟，就不改（None）。"""
    b = next(x for x in blocks if x["id"] == block_id)
    s, new_end = to_min(b["start"]), -(-now_min // 5) * 5
    if new_end >= to_min(b["end"]) or new_end - s < MIN_BLOCK:
        return None
    return [_span(x, s, new_end) if x is b else x for x in blocks]


def paused_seconds(run: dict, now: datetime) -> int:
    """各段暂停加起来多少秒；还没继续的那段算到 now。"""
    return int(sum(((datetime.fromisoformat(t) if t else now) - datetime.fromisoformat(f)).total_seconds()
                   for f, t in run["pauses"]))


def focus_seconds(run: dict, now: datetime) -> int:
    """从开始到 now，扣掉暂停，专注了多少秒。"""
    return max(0, int((now - datetime.fromisoformat(run["started_at"])).total_seconds()) - paused_seconds(run, now))


def run_reminders(blocks: list[dict], runs: dict[str, dict], operable: set[str], now: datetime,
                  started_at: Callable[[dict], datetime]) -> list[dict]:
    """今天还要响的提醒：没点开始的块到点提醒；点了开始的按番茄提醒小歇和回来（扣掉暂停，暂停中不提醒）。
    started_at(b) 是这一块计划开始的时刻（逻辑日和时区只有调用方知道）。"""
    out = []
    for b in _sorted(blocks):
        run = runs.get(b["id"])
        if b["id"] not in operable or (run and run["done_at"]):
            continue
        if run is None:  # 没点开始：到点提醒（将来的），不响番茄
            if started_at(b) > now:
                out.append({"kind": "block", "at": b["start"], "title": f"到点了：{b['title']}",
                            "body": f"{b['start']}–{b['end']}", "url": "/"})
            continue
        if run["pauses"] and run["pauses"][-1][1] is None:
            continue  # 暂停中
        done = focus_seconds(run, now)
        # 继续时块往后延长过（暂停按 5 分钟取整）：番茄个数按第一次点按钮时的计划起止算，不把停的那段也算成番茄
        span = to_min(run.get("planned_end", b["end"])) - to_min(run.get("planned_start", b["start"]))
        n = max(1, -(-span // POMODORO_MIN))
        marks = [((POMODORO_MIN * (k - 1) + BREAK_AT) * 60, "休息 5 分钟") for k in range(1, n + 1)] + \
                [(POMODORO_MIN * k * 60, "回来接着做") for k in range(1, n)]
        end = started_at(b) + timedelta(minutes=to_min(b["end"]) - to_min(b["start"]))
        out += [{"kind": "pomodoro", "at": t_at.strftime("%H:%M"), "title": title, "body": b["title"], "url": "/"}
                for t, title in marks if t > done and (t_at := now + timedelta(seconds=t - done)) <= end]  # 块结束后不再响
    return sorted(out, key=lambda r: r["at"])
