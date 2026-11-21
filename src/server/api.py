"""合并版 App 的接口（合并版设计 八）。排程只由求解器做，模型只负责把一句话理解成对账记录。

启动：.\\serve.ps1 ，然后打开 http://127.0.0.1:8000/docs
"""
import json
import logging
import os
import threading
from collections.abc import Callable
from dataclasses import asdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from mentor.checkin import VS_PLAN, Item, closing_line, parse_sentence, validate_checkin
from mentor.council import CARDS_DIR, Card, load_cards, run_versions_council
from mentor.deep_talk import STEPS, invest_suggestions, next_screen, propose, should_invite
from mentor.deep_talk import reply as talk_reply
from mentor.mentor import MAX_INPUT, logical_date
from mentor.model import ModelPort, RecordingModel, make_model
from mentor.onboarding import QUESTIONS, run_round
from mentor.reminders import todays_reminders
from mentor.review import MAX_HABITS, apply_adjustments, week_stats, write_review
from mentor.safety import all_strings, crisis_message, is_crisis
from planner.errors import InputError, PlanInfeasible
from planner.model import input_from_dict, to_hhmm, to_min
from planner.solve import DayPlan, replan_from, solve_day
from server.replan import replan_after

from .calendar import CalendarAuthError, CalendarError, CalendarPort, make_calendar
from .db import Db
from .privacy import COUNTRIES, PRIVACY_TEXT, PRIVACY_VERSION
from .settings import ENERGY_COST, SettingsIn, for_day, from_plan_input, to_plan_input

_log = logging.getLogger(__name__)

# shortcut: 第 7 周加登录之前只有一个本机用户；之后从登录信息里取 user_id
USER_ID = 1
WEB_ORIGINS = ["http://localhost:8081", "http://127.0.0.1:8081"]
DEFAULT_TEMPLATE = Path(__file__).resolve().parents[3] / "daily-planner" / "examples" / "users" / "学生.json"


class EnergyIn(BaseModel):
    level: int = Field(ge=1, le=5, strict=True, description="电量几格（1–5）")
    now: str | None = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="从几点开始重排，不填 = 现在")
    done_ids: list[str] = Field(default_factory=list, description="今天已经做完的事项 id")
    preview: bool = Field(False, description="只算不存：面板里点一格先看会改什么，点「就这样」再正式报")


class ConfirmIn(BaseModel):
    version: int


class OnboardingIn(BaseModel):
    answer: str | None = Field(None, description="对上一个问题的回答；不填 = 开始或接着问")


class ProfileConfirmIn(BaseModel):
    id: int
    content: str | None = Field(None, description="确认前改过的字；不填 = 原样确认")


class ReviewIn(BaseModel):
    """不填 = 生成（或取回）这周的复盘；三个都填 = 回答其中一条调整。"""
    id: int | None = Field(None, description="复盘的 id")
    index: int | None = Field(None, ge=0, le=2, description="第几条调整（从 0 数）")
    accept: bool | None = Field(None, description="true =「好」，false =「先不改」")


class MeIn(BaseModel):
    country: str = Field(description="CN / FR / 空（别的国家或不想说）：危机提示显示哪国的热线")
    is_adult: bool
    consent: str | None = Field(None, description="同意的隐私说明版本，要等于 GET /me 给的 privacy.version；不填 = 只改国家")


class CheckinIn(BaseModel):
    """二选一：按钮的结果（result），或者用户说的一句话（sentence）。"""
    result: dict | None = None
    sentence: str | None = None


class DeepTalkAnswerIn(BaseModel):
    step: int
    screen: str = Field(description="屏 id，要等于 GET /deep-talk 给的 screen")
    value: Any = Field(None, description="格式按这一屏的 kind")


class DeepTalkConfirmIn(BaseModel):
    kind: Literal["profile", "habit", "tomorrow"]
    id: int | None = Field(None, description="profile：档案 id")
    key: str | None = Field(None, description="habit：提议的 key（prototype / read / move …）")
    content: str | None = Field(None, max_length=MAX_INPUT, description="改过的字；不填 = 原样")
    accept: bool


def _answer_ok(s: dict, v, energy_ids: set[str]) -> bool:
    """按屏的 kind 校验回答的格式（危机检查已经在 screen() 里做过）。"""
    def num(x, lo, hi):
        return type(x) is int and lo <= x <= hi

    def text(x):
        return isinstance(x, str) and bool(x.strip()) and len(x) <= MAX_INPUT

    kind = s["kind"]
    if kind in ("open", "version"):
        return text(v)
    if kind == "choose":  # null =「先不选」
        return v is None or num(v, 0, 2)
    if kind == "council":
        return v is True
    if not isinstance(v, dict):
        return False
    if kind == "scores":  # options 里的项可以跳过（不带）
        return (set(s["items"]) - set(s.get("options", [])) <= set(v) <= set(s["items"])
                and all(num(x, 0, 10) for x in v.values()))
    if kind == "follow":
        return len(v) <= 2 and set(v) <= set(s["options"]) and all(map(text, v.values()))
    if kind == "energy":
        return set(v) <= energy_ids and all(x in (None, *ENERGY_COST) for x in v.values())
    return set(v) == {"0", "1", "2"} and all(  # rate：三个版本各打四项
        isinstance(r, dict) and set(r) == set(s["items"]) and all(num(x, 1, 5) for x in r.values()) for r in v.values())


def _energy_items(raw: dict | None) -> list[dict]:
    """能量屏要标的：每个习惯、每门课（按名字去重）、每个项目，带现在标的那一档。"""
    if not raw:
        return []
    form = from_plan_input(raw)
    classes: dict[str, str | None] = {}
    for c in form["timetable"]:
        classes.setdefault(c["title"], c["energy"])
    return ([{"id": h["id"], "title": h["title"], "kind": "habit", "energy": h["energy"]} for h in form["habits"]]
            + [{"id": f"class:{t}", "title": t, "kind": "class", "energy": e} for t, e in classes.items()]
            + [{"id": p["id"], "title": p["title"], "kind": "project", "energy": p["energy"]} for p in form["projects"]])


def _plan_json(plan: DayPlan) -> dict:
    blocks = [{**asdict(b), "start": to_hhmm(b.start), "end": to_hhmm(b.end)}
              for b in sorted(plan.blocks, key=lambda b: b.start)]
    return {"blocks": blocks, "warnings": list(plan.warnings),
            "energy_used": round(plan.energy_used), "energy_cap": round(plan.energy_cap)}


ONE_THING = "one-thing"  # 昨晚说的「明天的一件事」在第二天计划里的任务 id


def _items(plan: dict) -> dict[str, Item]:
    """对账能记哪些事：习惯和可选项按块 id，项目按任务 id（一个任务可能排了几块）。"""
    items = {}
    for b in plan["blocks"]:
        mins = to_min(b["end"]) - to_min(b["start"])
        if b["kind"] in ("must", "flex"):
            items[b["id"]] = Item(b["title"], minutes=mins)
        elif b.get("task_id") == ONE_THING:  # 只问做没做，不问比预想多还是少
            items[ONE_THING] = Item(f"昨晚定的一件事：{b['title']}", minutes=mins)
        elif b["kind"] == "proj":
            old = items.get(b["task_id"])
            items[b["task_id"]] = Item(b["title"], project=True, minutes=mins + (old.minutes if old else 0))
    return items


_FIELD = {"habits": "习惯", "timetable": "课", "projects": "项目", "title": "名字", "minutes": "标准版分钟数",
          "floor_min": "保底版分钟数", "wake": "起床时间", "sleep": "上床时间", "start": "开始时间", "end": "结束时间",
          "hours_left": "剩余小时", "deadline": "截止日", "level": "电量", "evening": "对账提醒时间", "weekday": "星期几"}


def _say_field(loc: tuple) -> str:
    """("body", "habits", 0, "title") →「第 1 个习惯的名字」"""
    parts, i = [], 0
    path = [x for x in loc if x != "body"]
    while i < len(path):
        x = path[i]
        if isinstance(x, str) and i + 1 < len(path) and isinstance(path[i + 1], int):
            parts.append(f"第 {path[i + 1] + 1} 个{_FIELD.get(x, x)}")
            i += 2
            continue
        if isinstance(x, str) and x in _FIELD:
            parts.append(_FIELD[x])
        i += 1
    return "的".join(parts)


def _say_error(e: dict) -> str:
    """把 pydantic 的一条英文错误说成中文。"""
    t, ctx = e.get("type", ""), e.get("ctx") or {}
    if t == "value_error":  # 我们自己写的中文说明，去掉「Value error, 」前缀
        return str(ctx.get("error") or e.get("msg", "")).removeprefix("Value error, ")
    what = {
        "string_too_short": "不能空着", "missing": "不能空着",
        "string_too_long": f"最多 {ctx.get('max_length')} 个字",
        "too_long": f"最多 {ctx.get('max_length')} 个", "too_short": f"至少 {ctx.get('min_length')} 个",
        "greater_than_equal": f"不能小于 {ctx.get('ge')}", "greater_than": f"要大于 {ctx.get('gt')}",
        "less_than_equal": f"不能大于 {ctx.get('le')}", "less_than": f"要小于 {ctx.get('lt')}",
        "int_parsing": "要填整数", "int_from_float": "要填整数", "int_type": "要填整数",
        "float_parsing": "要填数字", "string_pattern_mismatch": "格式不对", "date_from_datetime_parsing": "日期不对",
    }.get(t, "填得不对")
    field = _say_field(tuple(e.get("loc", ())))
    return f"{field}：{what}" if field else what


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": _say_error(exc.errors()[0]) if exc.errors() else "输入有误"})


def create_app(db: Db, model: ModelPort, *, template: dict | None = None, calendar: CalendarPort | None = None,
               now: Callable[[ZoneInfo], datetime] = datetime.now, cards: list[Card] | None = None) -> FastAPI:
    db.ensure_user(USER_ID)
    model = RecordingModel(model, lambda call: db.add_model_call(USER_ID, call))
    settings_lock = threading.Lock()
    if db.plan_input(USER_ID) is None and template is not None:
        db.set_plan_input(USER_ID, template)  # 开发用：设了 PLAN_TEMPLATE 就跳过建档

    app = FastAPI(title="Wayfinder 后端", version="0.1.0")
    app.add_exception_handler(RequestValidationError, _validation_error)
    # Expo 网页版开在 8081，和后端不同源，浏览器要后端明说放行；手机上的 App 不受这条限制
    app.add_middleware(CORSMiddleware, allow_origins=WEB_ORIGINS, allow_methods=["GET", "POST", "PUT", "DELETE"],
                       allow_headers=["Content-Type"])

    def crisis_reply() -> dict:
        return {"crisis": True, "message": crisis_message(db.user_info(USER_ID)["country"])}

    def clock() -> datetime:
        return now(ZoneInfo(db.user_timezone(USER_ID)))

    def day_raw(raw: dict, day) -> dict:
        """这一天的求解器输入：课表里这天的课，加上昨晚说的「明天的一件事」（一块，求解器会先排它）。"""
        d = for_day(raw, day)
        last = db.logs_between(USER_ID, day - timedelta(days=1), day - timedelta(days=1))
        if last and (t := last[0]["tomorrow_task"].strip()):
            d["tasks"] = [*d.get("tasks", []), {"id": ONE_THING, "project": "昨晚定的一件事", "title": t[:40],
                                                "remaining_min": 30,  # 截止写成明天：权重照样最高一档，又不会报「截止日已到」
                                                "deadline": (day + timedelta(days=1)).isoformat()}]
        return d

    def replan_today(day, raw: dict) -> tuple[dict, int | None]:
        """按新设置重排今天，只动「现在之后」：已经过去的和正在做的块，照存着的计划原样留下；
        那些块里已经排过的习惯、三餐不再排一遍。今天报过电量就沿用（和报电量一样）。"""
        latest, t = db.latest_plan(USER_ID, day), clock()
        level = latest["energy_level"] if latest else None
        try:
            inp = input_from_dict({**day_raw(raw, day), **({"energy_level": level} if level else {})})
        except InputError as e:
            raise HTTPException(422, str(e)) from None
        if latest is None:
            return solved(lambda: solve_day(inp)), None
        old = db.plan_input(USER_ID)
        if old is not None and input_from_dict({**day_raw(old, day), **({"energy_level": level} if level else {})}) == inp:
            return latest["plan"], level  # 改的东西不影响今天怎么排（比如只改了提醒时间）：今天的计划一点不动
        now_min = t.hour * 60 + t.minute
        blocks = latest["plan"]["blocks"]
        # 凌晨还算昨天（昨天没有「之后」了），或者今天已经走完：只检查新设置排得出来，今天的计划和电量不动
        if t.date() != day or (blocks and all(to_min(b["end"]) <= now_min for b in blocks)):
            solved(lambda: solve_day(inp))
            return latest["plan"], level
        return solved(lambda: replan_after(inp, blocks, now_min)), level

    def check_week(raw: dict, day) -> None:
        """今天之外的六天也各试排一次：哪天排不下就不让存，免得到那天首页打不开。"""
        for k in range(1, 7):
            d = day + timedelta(days=k)
            try:
                solve_day(input_from_dict(for_day(raw, d)))
            except (InputError, PlanInfeasible) as e:
                raise HTTPException(422, f"星期{'一二三四五六日'[d.weekday()]}排不下：{e}") from None

    def plan_input(day, energy_level=None):
        raw = db.plan_input(USER_ID)
        if raw is None:
            raise HTTPException(409, "还没有设置，先完成建档")
        raw = day_raw(raw, day)
        if energy_level is not None:
            raw["energy_level"] = energy_level
        try:
            return input_from_dict(raw)
        except InputError as e:
            raise HTTPException(422, str(e)) from None

    def solved(fn):
        try:
            return _plan_json(fn())
        except (InputError, PlanInfeasible) as e:
            raise HTTPException(422, str(e)) from None

    def out(day, stored: dict) -> dict:
        return {"day": day.isoformat(), "version": stored["version"], "confirmed": stored["confirmed_at"] is not None,
                "energy_level": stored["energy_level"], **stored["plan"]}

    def today_plan(day) -> dict:
        stored = db.latest_plan(USER_ID, day)
        if stored is None:
            inp = plan_input(day)
            db.add_plan(USER_ID, day, solved(lambda: solve_day(inp)), None, only_if_none=True)
            stored = db.latest_plan(USER_ID, day)
        return stored

    def screen(body: BaseModel, day) -> dict | None:
        """请求里用户写的任何文字：编码不了就 422；有危机字眼就记下并返回危机话术（不交给模型）。"""
        texts = all_strings(body.model_dump())
        try:
            for t in texts:
                t.encode("utf-8")
        except UnicodeEncodeError:
            raise HTTPException(422, "文字里有无法识别的字符") from None
        if any(is_crisis(t) for t in texts):
            text = "\n".join(texts)
            db.log_crisis(USER_ID, day, text)
            return crisis_reply()
        return None

    @app.get("/today", summary="今日计划，没有就生成；reminders 是手机要定的两条本地提醒")
    def get_today():
        day = logical_date(clock())
        stored = today_plan(day)
        settings = (db.plan_input(USER_ID) or {}).get("reminders")
        log = db.logs_between(USER_ID, day, day)  # 今晚对过账没有：首页据此换成「今天收好了」
        # 对过账就不再提醒对账，报过电量就不再提醒报电量
        reminders = [r for r in todays_reminders(stored["plan"], settings)
                     if not (r["kind"] == "evening" and log) and not (r["kind"] == "after_class" and stored["energy_level"])]
        return {**out(day, stored), "reminders": reminders,
                "checked_in": bool(log), "tomorrow_task": (log[0]["tomorrow_task"].strip() or None) if log else None,
                # 往后 6 天的提醒也一起给：手机一次定好，那几天不打开 App 也会响
                "later_reminders": [{**r, "day": d.isoformat()} for d in (day + timedelta(days=k) for k in range(1, 7))
                                    for r in todays_reminders({"blocks": for_day(db.plan_input(USER_ID) or {}, d)["fixed"]}, settings)],
                # 再改一下对账时，先把上次选的填好
                "checkin": {k: log[0][k] for k in ("items", "note", "blocker")} if log else None,
                "goals": goals_map(db.plan_input(USER_ID) or {})}

    @app.post("/energy", summary="报电量 → 只重排今晚 → 返回新计划（未确认）")
    def post_energy(body: EnergyIn):
        t = clock()
        day = logical_date(t)
        if crisis := screen(body, day):
            return crisis
        if body.now is None and t.date() != day:  # 凌晨 4 点前还算昨天，但昨天已经没有「今晚」可排了
            raise HTTPException(409, "今天已经过完了，早上再看新的计划")
        inp = plan_input(day, body.level)
        # shortcut: 总是从当天的原始计划重排，不在上一次重排的结果上叠；一天报两次电量时，第二次之前的手动改动会丢
        plan = solved(lambda: replan_from(inp, body.now or to_hhmm(t.hour * 60 + t.minute), body.done_ids))
        if body.preview:  # 预览不存：关掉面板，今天的计划和电量都不变；version 0 表示「还没存」
            return {"day": day.isoformat(), "version": 0, "confirmed": False, "energy_level": body.level, **plan}
        db.add_plan(USER_ID, day, plan, body.level)
        return out(day, db.latest_plan(USER_ID, day))

    @app.post("/plan/confirm", summary="确认计划，再写入「Wayfinder 计划」日历；calendar：off / written / reconnect / failed")
    def post_confirm(body: ConfirmIn):
        day = logical_date(clock())
        stored = db.latest_plan(USER_ID, day)
        if stored is None or stored["version"] != body.version:
            raise HTTPException(409, "这不是今天最新的计划，刷新后再确认")
        db.confirm_plan(USER_ID, day, body.version)
        status = "off"
        if calendar is not None:
            try:
                calendar.write_day(day, stored["plan"]["blocks"], db.user_timezone(USER_ID))
                db.mark_in_calendar(USER_ID, day, body.version)
                status = "written"
            except CalendarAuthError:
                status = "reconnect"  # App 提示用户重新连；计划照样算确认了
            except CalendarError:
                status = "failed"
        return {**out(day, db.latest_plan(USER_ID, day)), "calendar": status}

    def merge_log(day, result: dict, explicit: set[str]) -> dict:
        """和今天已有的记录合并（只补这次说到的，explicit 里的字段可以清空），补上电量，存下，返回整条。"""
        stored = today_plan(day)
        said_energy = result["energy_after_class"]
        if earlier := db.logs_between(USER_ID, day, day):  # 只补这次说到的，不冲掉今天之前记过的
            old = earlier[0]
            result = {**old, **{k: v for k, v in result.items() if v not in (None, "") or k in explicit},
                      "items": {**old["items"], **result["items"]}}
        if ONE_THING in result["items"]:  # 昨晚定的那件事今天做到没有
            result["yesterday_done"] = result["items"][ONE_THING]["status"] != "skip"
        if said_energy is None and stored["energy_level"] is not None:  # 这次没说电量：用今天最后一次报的
            result["energy_after_class"] = stored["energy_level"]
        db.save_log(USER_ID, result)
        return result

    @app.post("/checkin", summary="晚间对账：按钮结果或一句话 → 校验 → 写入 day_logs")
    def post_checkin(body: CheckinIn):
        if (body.result is None) == (body.sentence is None):
            raise HTTPException(422, "result 和 sentence 只填一个")
        day = logical_date(clock())
        if crisis := screen(body, day):  # 用户的话先查危机，不交给模型
            return crisis
        texts = [body.sentence] if body.sentence is not None else \
            [v for k in ("note", "blocker", "tomorrow_task") if isinstance(v := body.result.get(k), str)]
        if any(len(t) > MAX_INPUT for t in texts):
            raise HTTPException(422, f"一次最多 {MAX_INPUT} 字")
        stored = today_plan(day)
        items = _items(stored["plan"])

        if body.sentence is not None:
            outcome, result = parse_sentence(model, body.sentence, day, items)
            if outcome == "crisis":
                db.log_crisis(USER_ID, day, body.sentence)
                return crisis_reply()
            if outcome == "bad":  # 什么都不存，让用户点按钮补
                raise HTTPException(422, "这句话我没整理出来，请点按钮补上")
            said, quote = body.sentence, result["note"]
        else:
            try:
                result = validate_checkin(body.result, day, items)
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
            clearing = set(body.result or {}) & {"note", "blocker", "tomorrow_task"} and db.logs_between(USER_ID, day, day)
            if not result["items"] and result["energy_after_class"] is None and not clearing and \
                    not any(result[k] for k in ("note", "blocker", "tomorrow_task")):
                raise HTTPException(422, "还什么都没记：点一下做没做，或者写一句")
            said = quote = result["note"]
        # 按按钮时明确带了的字段（哪怕是空的）就是要改成这样，可以清掉；一句话里没提到的不动
        explicit = set(body.result or {}) if body.sentence is None else set()
        result = merge_log(day, result, explicit)
        if said:
            mid = db.add_message(USER_ID, day, "对账", "user", said)
            if quote:  # 只引用这一次说的话
                db.add_quote(USER_ID, mid, quote, "对账", day)
        return {"crisis": False, "saved": result, "closing": closing_line(quote)}

    def review_state(day) -> str | None:
        """首页的复盘入口：due = 可以做了，today = 今天已经做了（还能回去点调整），None = 不显示。"""
        last = db.reviews(USER_ID)
        return "today" if last and last[0]["week_end"] == day.isoformat() else "due" if review_due(day) else None

    def review_due(day) -> bool:
        """满 7 天出现复盘入口：最早一条对账至少在 6 天前，而且最近 7 天里没复盘过。"""
        first, last = db.first_log_day(USER_ID), db.reviews(USER_ID)
        return (first is not None and first <= day - timedelta(days=6)
                and bool(db.logs_between(USER_ID, day - timedelta(days=6), day))  # 这 7 天一晚都没记就不复盘
                and not (last and date.fromisoformat(last[0]["week_end"]) > day - timedelta(days=7)))

    def review_view(review: dict) -> dict:
        earlier = db.reviews(USER_ID, limit=2)[1:]
        profile = next((p for p in db.profiles(USER_ID, confirmed=True) if p["id"] == review["still_right"]), None)
        return {"crisis": False, **review,
                "last_question": earlier[0]["question"] if earlier else None,  # 上周带进来的问题，导师不回答
                "still_right": profile and {**profile, "question": f"上次你说「{profile['content']}」，现在还对吗？"}}

    @app.get("/week", summary="近 7 天：每个习惯做了几天 / 记录了几天，项目比预想多还是少；review 是复盘入口")
    def get_week():
        end = logical_date(clock())
        start = end - timedelta(days=6)
        logs = db.logs_between(USER_ID, start, end)
        raw = db.plan_input(USER_ID) or {}

        def statuses(item_id):
            return [log["items"][item_id] for log in logs if item_id in log["items"]]

        dates = [(start + timedelta(days=i)).isoformat() for i in range(7)]
        by_date = {log["date"]: log for log in logs}

        def per_day(item_id):  # 从 start 到 end 每天一格：done / floor / skip，没记就是 None
            return [by_date[d]["items"].get(item_id, {}).get("status") if d in by_date else None for d in dates]

        habits = [{"id": h["id"], "title": h["title"],
                   "done_days": sum(s["status"] in ("done", "floor") for s in statuses(h["id"])),
                   "days": per_day(h["id"])}
                  for h in raw.get("habits", [])]
        projects = [{"id": t["id"], "title": t["title"],
                     **{v: sum(s.get("vs_plan") == v for s in statuses(t["id"])) for v in VS_PLAN}}
                    for t in raw.get("tasks", [])]
        return {"start": start.isoformat(), "end": end.isoformat(), "logged_days": len(logs),
                "logged": [d in by_date for d in dates],
                "habits": habits, "projects": projects, "review": review_state(end)}

    @app.post("/review", summary="每周复盘：生成这周的（数字由程序算），或回答一条调整（点了「好」才写进设置）")
    def post_review(body: ReviewIn):
        day = logical_date(clock())
        latest = db.reviews(USER_ID)
        if body.id is None and body.index is None and body.accept is None:
            if latest and latest[0]["week_end"] == day.isoformat():
                return review_view(latest[0])
            if not review_due(day):
                raise HTTPException(409, "还没满 7 天，或者这周已经复盘过了")
            raw = db.plan_input(USER_ID) or {}
            habits = raw.get("habits", [])
            stats = week_stats(db.logs_between(USER_ID, day - timedelta(days=6), day), habits, raw.get("tasks", []))
            outcome, written = write_review(model, stats, habits)
            if outcome == "crisis":
                db.log_crisis(USER_ID, day, "（每周复盘的模型输出）")
                return crisis_reply()
            stale = db.stalest_profile(USER_ID, day)
            db.add_review(USER_ID, day, {"stats": stats, **written, "still_right": stale and stale["id"]})
            return review_view(db.reviews(USER_ID)[0])

        if body.id is None or body.index is None or body.accept is None:
            raise HTTPException(422, "回答调整要同时填 id、index、accept")
        # 快速连点两条「好」：排队处理，不然两边各读一份旧设置、后写的盖掉先写的那条改动
        # shortcut: 锁只在一个进程里有效；后端开多个进程时要换成数据库事务
        with settings_lock:
            latest = db.reviews(USER_ID)
            if not latest or latest[0]["id"] != body.id:
                raise HTTPException(409, "只能回答最近一次复盘里的调整")
            adjustments = latest[0]["adjustments"]
            if body.index >= len(adjustments) or adjustments[body.index]["answer"] is not None:
                raise HTTPException(409, "没有这条调整，或者已经回答过了")
            raw = None
            if body.accept:  # 先确认改完还排得出今天的计划，再记回答、写设置
                raw = apply_adjustments(db.plan_input(USER_ID) or {}, [adjustments[body.index]])
                if len(raw.get("habits", [])) > MAX_HABITS:
                    raise HTTPException(409, f"已经有 {MAX_HABITS} 个习惯了，先在设置里去掉一个")
                plan, level = replan_today(day, raw)
                check_week(raw, day)
            if not db.answer_adjustment(USER_ID, body.id, body.index, "好" if body.accept else "先不改"):
                raise HTTPException(409, "这条已经回答过了")
            if raw is not None:
                db.set_plan_input(USER_ID, raw)
                db.add_plan(USER_ID, day, plan, level)
        return review_view(db.reviews(USER_ID)[0])

    @app.post("/onboarding", summary="建档对话的一轮：一次只问一个问题，最后提一条「方向」等用户确认")
    def post_onboarding(body: OnboardingIn):
        day = logical_date(clock())
        if db.consents(USER_ID).get("隐私") != PRIVACY_VERSION:
            raise HTTPException(409, "先看隐私说明并同意")
        answers = [m["content"] for m in db.messages(USER_ID, "建档") if m["role"] == "user"]
        n = len(answers)
        if n >= len(QUESTIONS):
            return {"crisis": False, "done": True, "reply": None, "question": None,
                    "proposals": db.profiles(USER_ID, confirmed=False)}
        if body.answer is None:
            return {"crisis": False, "done": False, "reply": None, "question": QUESTIONS[n]}
        if crisis := screen(body, day):
            return crisis
        if not body.answer.strip() or len(body.answer) > MAX_INPUT:
            raise HTTPException(422, f"回答不能是空的，也不能超过 {MAX_INPUT} 字")
        final = n == len(QUESTIONS) - 1
        earlier = list(zip(QUESTIONS, answers)) if final else []
        outcome, out_ = run_round(model, QUESTIONS[n], body.answer, db.profiles(USER_ID, confirmed=True), earlier)
        if outcome == "crisis":
            db.log_crisis(USER_ID, day, body.answer)
            return crisis_reply()
        db.add_message(USER_ID, day, "建档", "user", body.answer)
        db.add_message(USER_ID, day, "建档", "assistant", out_["reply"])
        if final:
            db.propose_profile(USER_ID, "方向", out_["direction"], "建档")
            return {"crisis": False, "done": True, "reply": out_["reply"], "question": None,
                    "proposals": db.profiles(USER_ID, confirmed=False)}
        return {"crisis": False, "done": False, "reply": out_["reply"], "question": QUESTIONS[n + 1]}

    @app.get("/profile", summary="档案：已确认的，和等你确认的")
    def get_profile():
        return {"confirmed": db.profiles(USER_ID, confirmed=True), "pending": db.profiles(USER_ID, confirmed=False)}

    @app.post("/profile/confirm", summary="确认一条档案（可以先改字）；没确认的档案不当事实用")
    def post_profile_confirm(body: ProfileConfirmIn):
        if crisis := screen(body, logical_date(clock())):
            return crisis
        try:
            ok = db.confirm_profile(USER_ID, body.id, body.content)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        if not ok:
            raise HTTPException(404, "没有这条档案")
        return get_profile()

    @app.get("/settings", summary="设置：作息、习惯和保底版、每件事累不累")
    def get_settings():
        raw = db.plan_input(USER_ID)
        if raw is None:
            raise HTTPException(404, "还没有设置")
        return from_plan_input(raw)

    def save_settings(body: SettingsIn) -> dict:
        """保存设置；排不下抛 422。设置页和深度长谈共用。"""
        day = logical_date(clock())
        if crisis := screen(body, day):
            return crisis
        raw = to_plan_input(body, db.plan_input(USER_ID))
        plan, level = replan_today(day, raw)
        check_week(raw, day)
        db.set_plan_input(USER_ID, raw)
        db.add_plan(USER_ID, day, plan, level)
        return from_plan_input(raw)

    @app.put("/settings", summary="保存设置；排得出今天的计划才保存，今天的计划跟着换成新版本")
    def put_settings(body: SettingsIn):
        return save_settings(body)

    # 深度长谈（设计 2026-11-21-deep-talk）：一轮 4 步，一步一行；问题由程序定，模型只回应和提议
    def change_settings(edit: Callable[[dict], None]) -> dict | None:
        """在现在的设置表单上改一处，再走 save_settings（排不下抛 422）；返回危机话术或 None。"""
        raw = db.plan_input(USER_ID)
        if raw is None:
            raise HTTPException(409, "还没有设置，先完成建档")
        form = from_plan_input(raw)
        edit(form)
        try:
            body = SettingsIn(**form)
        except ValidationError as e:
            raise HTTPException(422, _say_error(e.errors()[0])) from None
        out = save_settings(body)
        return out if out.get("crisis") else None

    def talk_rows() -> tuple[int, dict[int, dict], dict[int, dict]]:
        """(这一轮, {步: 行}, {步: 回答})：步是整数（数据库里的 step 列）。"""
        rnd = db.deep_talk_round(USER_ID)
        rows = {r["step"]: r for r in db.deep_talk_rows(USER_ID, rnd)}
        return rnd, rows, {s: r["answers"] for s, r in rows.items()}

    def current_step(rows: dict[int, dict]) -> int | None:
        return next((s for s in STEPS if not rows.get(s, {}).get("finished_at")), None)

    def goals_map(raw: dict) -> dict[str, str]:
        """习惯 id → 它服务的目标原文；只认最新一轮里提出、已经确认的「目标」。"""
        _, _, answers = talk_rows()
        ids = {i for a in answers.values() for i in a.get("profile_ids", [])}
        goals = {p["id"]: p["content"] for p in db.profiles(USER_ID, confirmed=True) if p["level"] == "目标" and p["id"] in ids}
        return {h: goals[m["goal_id"]] for h, m in raw.get("habit_meta", {}).items() if m.get("goal_id") in goals}

    def talk_state(said: str | None = None) -> dict:
        day = logical_date(clock())
        rnd, rows, answers = talk_rows()
        step, raw = current_step(rows), db.plan_input(USER_ID)
        log, latest = db.logs_between(USER_ID, day, day), db.latest_plan(USER_ID, day)
        a4, row4 = answers.get(4, {}), rows.get(4, {})
        shown = ({i for a in answers.values() for i in a.get("profile_ids", [])}
                 - {i for a in answers.values() for i in a.get("dismissed", [])})
        full = len((raw or {}).get("habits", [])) >= MAX_HABITS

        def status(s):
            r = rows.get(s, {})
            return "done" if r.get("finished_at") else "doing" if r.get("started_at") else "todo"
        return {"crisis": False, "round": rnd, "step": step, "screen": step and next_screen(answers, step),
                "steps": [{"step": s, "name": d["name"], "status": status(s)} for s, d in STEPS.items()],
                "screens": STEPS, "answers": {str(s): a for s, a in answers.items() if a},
                "invite": should_invite(list(rows.values()), checked_in=bool(log),
                                        energy_level=latest and latest["energy_level"], today=day),
                "snoozes": rows.get(step, {}).get("snoozes", 0),
                "council": {"status": row4["council_status"], "result": row4["council"]} if row4.get("council_status") else None,
                "proposals": {"profiles": [p for p in db.profiles(USER_ID, confirmed=False) if p["id"] in shown],
                              # 习惯满了：「投资自己」不再提（原型照样显示，接受时报「习惯满了」）
                              "habits": [h for h in a4.get("proposals", [])
                                         if not (full and h["source"] == "invest" and h["status"] == "pending")],
                              "tomorrow": None if a4.get("tomorrow_done") else a4.get("tomorrow")},
                "tonight_task": (log[0]["tomorrow_task"].strip() or None) if log else None,
                "habits_full": full, "energy_items": _energy_items(raw), "reply": said}

    def finish_step(step: int, answers: dict[int, dict]) -> tuple[dict, bool] | None:
        """一步的最后一屏答完：提议存成待确认的档案；返回 (要并进这一步回答的字段, 方向对不上)，模型输出危机时 None。"""
        mine = answers[step]
        out: dict = {}
        if not (step == 4 and mine.get("choose") is None):  #「先不选」不落地，只给「投资自己」
            outcome, out = propose(model, step, answers)
            if outcome == "crisis":
                return None
        proto = out.get("prototype")
        levels = {1: [("近期观察", out.get("observation"))], 2: [("方向", out.get("direction"))],
                  3: [("近期观察", out.get("formula"))],
                  4: [("使命", out.get("mission")), *(("目标", g) for g in out.get("goals", [])),
                      ("策略", proto and proto["title"])]}[step]
        ids = [db.propose_profile(USER_ID, level, text, "深度长谈") for level, text in levels if text and text.strip()]
        extra: dict = {"profile_ids": [*mine.get("profile_ids", []), *ids]}
        if step == 4:
            fresh = ([{"key": "prototype", **proto, "when": None, "why": None, "source": "deep_talk"}] if proto else []) + \
                [{**i, "source": "invest"} for i in invest_suggestions(answers, (db.plan_input(USER_ID) or {}).get("habits", []))]
            old = mine.get("proposals", [])  # 回来选版本时：已经回答过的提议保留，只补新的
            extra["proposals"] = old + [{**p, "status": "pending"} for p in fresh if p["key"] not in {o["key"] for o in old}]
            if out.get("tomorrow"):
                extra.update(tomorrow=out["tomorrow"], tomorrow_done=False)
        return extra, bool(out.get("mismatch"))

    @app.get("/deep-talk", summary="深度长谈：第几次、哪一屏、今晚要不要邀请、已答内容和待确认的提议")
    def get_deep_talk():
        return talk_state()

    @app.post("/deep-talk/answer", summary="答一屏：开放问题回导师的一句；一步的最后一屏答完给这一步的提议")
    def post_deep_talk_answer(body: DeepTalkAnswerIn):
        t = clock()
        day = logical_date(t)
        if crisis := screen(body, day):  # 危机：这一屏什么都不存，停在这里
            return crisis
        rnd, rows, answers = talk_rows()
        step = current_step(rows)
        # 第 4 次选了「先不选」以后，可以回来选一个版本（改的是同一轮的那一行）
        rechoose = body.step == 4 and body.screen == "choose" and answers.get(4, {}).get("choose", 0) is None
        if not rechoose and (body.step != step or body.screen != next_screen(answers, step)):
            raise HTTPException(409, "不是这一屏，刷新后再接着聊")
        s = next(x for x in STEPS[body.step]["screens"] if x["id"] == body.screen)
        items = _energy_items(db.plan_input(USER_ID))
        if not _answer_ok(s, body.value, {i["id"] for i in items}):
            raise HTTPException(422, f"回答不能是空的，也不能超过 {MAX_INPUT} 字"
                                if s["kind"] in ("open", "version", "follow") else "这一屏的回答格式不对")
        mine = {**answers.get(body.step, {})}
        if s["kind"] == "council":
            mine["council_seen"] = True
        else:
            mine[body.screen] = body.value
        said = None
        if s["kind"] == "open":
            outcome, said = talk_reply(model, s["question"], body.value)
            if outcome == "crisis":
                db.log_crisis(USER_ID, day, body.value)
                return crisis_reply()
        if s["kind"] == "energy":  # 标的结果马上写进设置、重排今天
            mine["loved"] = [i["title"] for i in items if body.value.get(i["id"]) == "love"]

            def mark(form):
                for x in form["habits"] + form["projects"]:
                    x["energy"] = body.value.get(x["id"], x["energy"])
                for c in form["timetable"]:
                    c["energy"] = body.value.get(f"class:{c['title']}", c["energy"])
            if crisis := change_settings(mark):
                return crisis
        answers = {**answers, body.step: mine}
        fields: dict = {}
        if next_screen(answers, body.step) is None:
            done = finish_step(body.step, answers)
            if done is None:
                db.log_crisis(USER_ID, day, "（深度长谈提议的模型输出）")
                return crisis_reply()
            extra, mismatch = done
            mine.update(extra)
            if mismatch:
                said = f"{said or ''}\n这两句指的方向不太一样，先记下。".strip()
            fields["finished_at"] = t.isoformat(timespec="seconds")
        if not rows.get(body.step, {}).get("started_at"):  # 开始一步：「明天再说」清零
            fields.update(started_at=t.isoformat(timespec="seconds"), snoozes=0)
        db.upsert_deep_talk(USER_ID, rnd, body.step, answers=mine, **fields)
        return talk_state(said)

    @app.post("/deep-talk/snooze", summary="「明天再说」：这一步的次数加一，连着 3 次以后对账页不再邀请")
    def post_deep_talk_snooze():
        rnd, rows, _ = talk_rows()
        step = current_step(rows)
        if step is None:
            raise HTTPException(409, "这一轮已经聊完了")
        db.upsert_deep_talk(USER_ID, rnd, step, snoozes=rows.get(step, {}).get("snoozes", 0) + 1)
        return talk_state()

    @app.post("/deep-talk/council", summary="三个版本写完后请智囊团看：后台跑，马上返回；App 每 3 秒查 GET /deep-talk")
    def post_deep_talk_council():
        day = logical_date(clock())
        rnd, rows, answers = talk_rows()
        a4 = answers.get(4, {})
        if not all(k in a4 for k in ("v1", "v2", "v3")):
            raise HTTPException(409, "三个版本都写完，才能请顾问们看")
        if rows[4]["council_status"] in ("running", "done"):  # 刷新、连点都不重开
            return talk_state()
        db.upsert_deep_talk(USER_ID, rnd, 4, council=None, council_status="running")
        state = talk_state()  # 先取状态再开线程：返回的一定是 running
        versions = [a4[k] for k in ("v1", "v2", "v3")]
        context = "【档案】\n" + ("\n".join(f"{p['level']}：{p['content']}" for p in db.profiles(USER_ID, confirmed=True))
                                 or "（还没有确认过的档案）")

        def run():
            try:
                outcome, result = run_versions_council(model, cards or [], versions, context)
            except Exception:  # 不能让状态一直停在 running，App 会一直等
                _log.exception("智囊团看三个版本出了意外")
                outcome, result = "failed", None
            if outcome == "crisis":
                db.log_crisis(USER_ID, day, "（智囊团看三个版本的模型输出）")
            db.upsert_deep_talk(USER_ID, rnd, 4, council=result, council_status="done" if outcome == "ok" else "failed")

        # 测试靠这个引用等线程跑完；Db 每次调用各开连接，后台线程里用是安全的
        app.state.deep_talk_thread = threading.Thread(target=run, daemon=True)
        app.state.deep_talk_thread.start()
        return state

    @app.post("/deep-talk/confirm", summary="确认或不要一条提议：档案、习惯（走设置保存）、明天的一件事（并进今晚的对账）")
    def post_deep_talk_confirm(body: DeepTalkConfirmIn):
        day = logical_date(clock())
        if crisis := screen(body, day):
            return crisis
        rnd, _, answers = talk_rows()
        a4 = answers.get(4, {})
        if body.kind == "profile":
            step = next((s for s, a in answers.items() if body.id in a.get("profile_ids", [])), None)
            if step is None:
                raise HTTPException(404, "这一轮没有这条提议")
            if body.accept:
                try:
                    db.confirm_profile(USER_ID, body.id, body.content)
                except ValueError as e:
                    raise HTTPException(422, str(e)) from None
            else:  # 不确认：留在待确认里，长谈里不再显示
                mine = answers[step]
                db.upsert_deep_talk(USER_ID, rnd, step, answers={**mine, "dismissed": [*mine.get("dismissed", []), body.id]})
        elif body.kind == "habit":
            props = a4.get("proposals", [])
            p = next((h for h in props if h["key"] == body.key and h["status"] == "pending"), None)
            if p is None:
                raise HTTPException(409, "没有这条提议，或者已经回答过了")
            if body.accept:
                if len((db.plan_input(USER_ID) or {}).get("habits", [])) >= MAX_HABITS:
                    raise HTTPException(409, "习惯满了，先在设置里换掉一个")
                ids = set(a4.get("profile_ids", []))
                goal = next((x["id"] for x in db.profiles(USER_ID, confirmed=True)
                             if x["level"] == "目标" and x["id"] in ids), None) if p["source"] == "deep_talk" else None
                new = {"title": body.content or p["title"], "minutes": p["minutes"], "floor_min": p["floor_min"],
                       "source": p["source"], "goal_id": goal}
                if crisis := change_settings(lambda form: form["habits"].append(new)):  # 排不下抛 422，提议保持 pending
                    return crisis
            p["status"] = "accepted" if body.accept else "declined"
            db.upsert_deep_talk(USER_ID, rnd, 4, answers={**a4, "proposals": props})
        else:
            if not a4.get("tomorrow") or a4.get("tomorrow_done"):
                raise HTTPException(409, "没有待确认的明天的一件事")
            if body.accept:  # 只带 tomorrow_task 一项：今晚对账的其他内容原样保留
                merge_log(day, validate_checkin({"tomorrow_task": body.content or a4["tomorrow"]}, day, {}), {"tomorrow_task"})
            db.upsert_deep_talk(USER_ID, rnd, 4, answers={**a4, "tomorrow_done": True})
        return talk_state()

    @app.post("/deep-talk/restart", summary="重新聊一次：开新的一轮，从第 1 次开始，旧的一轮保留")
    def post_deep_talk_restart():
        db.upsert_deep_talk(USER_ID, db.deep_talk_round(USER_ID) + 1, 1)
        return talk_state()

    @app.get("/me", summary="国家、是否成年、隐私说明和有没有同意过这一版")
    def get_me():
        return {**db.user_info(USER_ID), "consented": db.consents(USER_ID).get("隐私") == PRIVACY_VERSION,
                "privacy": {"version": PRIVACY_VERSION, "text": PRIVACY_TEXT}}

    @app.put("/me", summary="填国家和是否成年；带 consent 就同时同意这一版隐私说明（建档前、说明更新后要做）")
    def put_me(body: MeIn):
        if body.country not in COUNTRIES:
            raise HTTPException(422, f"country 只能是 {' / '.join(c or '空' for c in COUNTRIES)}")
        if body.consent is not None and body.consent != PRIVACY_VERSION:
            raise HTTPException(409, "隐私说明更新了，刷新后再看一遍")
        db.update_user(USER_ID, country=body.country, is_adult=body.is_adult)
        if body.consent is not None:
            db.consent(USER_ID, "隐私", PRIVACY_VERSION)
        return get_me()

    @app.get("/export", summary="导出我的全部数据（每张表里属于我的行）")
    def get_export():
        return {"exported_at": clock().isoformat(timespec="seconds"), "tables": db.export(USER_ID)}

    @app.delete("/me", summary="删除我的全部数据，不能恢复；要带 ?confirm=true")
    def delete_me(confirm: bool = False):
        if not confirm:
            raise HTTPException(422, "删除不能恢复，确定的话带上 confirm=true")
        db.delete_user(USER_ID)
        db.ensure_user(USER_ID)  # 换成一个全新的空用户，下次打开从同意和建档开始
        return {"deleted": True}

    return app


def app_from_env(env=os.environ) -> FastAPI:
    """PLAN_TEMPLATE 设成一份求解器输入（比如 daily-planner 的假用户）就跳过建档；不设就从建档开始。"""
    path = env.get("PLAN_TEMPLATE")
    template = json.loads(Path(path).read_text(encoding="utf-8")) if path else None
    return create_app(Db(env.get("APP_DB") or "var/app.db"), make_model(env), template=template,
                      calendar=make_calendar(env), cards=load_cards(CARDS_DIR))
