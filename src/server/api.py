"""合并版 App 的接口（合并版设计 八）。排程只由求解器做，模型只负责把一句话理解成对账记录。

启动：.\\serve.ps1 ，然后打开 http://127.0.0.1:8000/docs
"""
import json
import os
import threading
from collections.abc import Callable
from dataclasses import asdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from mentor.checkin import VS_PLAN, Item, closing_line, parse_sentence, validate_checkin
from mentor.mentor import MAX_INPUT, logical_date
from mentor.model import ModelPort, RecordingModel, make_model
from mentor.onboarding import QUESTIONS, run_round
from mentor.reminders import todays_reminders
from mentor.review import MAX_HABITS, apply_adjustments, week_stats, write_review
from mentor.safety import all_strings, crisis_message, is_crisis
from planner.errors import InputError, PlanInfeasible
from planner.model import input_from_dict, to_hhmm, to_min
from planner.solve import DayPlan, replan_from, solve_day

from .calendar import CalendarAuthError, CalendarError, CalendarPort, make_calendar
from .db import Db
from .privacy import COUNTRIES, PRIVACY_TEXT, PRIVACY_VERSION
from .settings import SettingsIn, for_day, from_plan_input, to_plan_input

# shortcut: 第 7 周加登录之前只有一个本机用户；之后从登录信息里取 user_id
USER_ID = 1
WEB_ORIGINS = ["http://localhost:8081", "http://127.0.0.1:8081"]
DEFAULT_TEMPLATE = Path(__file__).resolve().parents[3] / "daily-planner" / "examples" / "users" / "学生.json"


class EnergyIn(BaseModel):
    level: int = Field(ge=1, le=5, description="电量几格（1–5）")
    now: str | None = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="从几点开始重排，不填 = 现在")
    done_ids: list[str] = Field(default_factory=list, description="今天已经做完的事项 id")


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


def create_app(db: Db, model: ModelPort, *, template: dict | None = None, calendar: CalendarPort | None = None,
               now: Callable[[ZoneInfo], datetime] = datetime.now) -> FastAPI:
    db.ensure_user(USER_ID)
    model = RecordingModel(model, lambda call: db.add_model_call(USER_ID, call))
    settings_lock = threading.Lock()
    if db.plan_input(USER_ID) is None and template is not None:
        db.set_plan_input(USER_ID, template)  # 开发用：设了 PLAN_TEMPLATE 就跳过建档

    app = FastAPI(title="Wayfinder 后端", version="0.1.0")
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

    def replan_today(day, raw: dict) -> tuple[DayPlan, int | None]:
        """按新设置重排今天。今天报过电量就沿用：现在之前照原计划，之后按电量排（和报电量一样）。"""
        latest, t = db.latest_plan(USER_ID, day), clock()
        level = latest["energy_level"] if latest and t.date() == day else None  # 凌晨还算昨天，昨天没有「之后」了
        try:
            inp = input_from_dict({**day_raw(raw, day), **({"energy_level": level} if level else {})})
        except InputError as e:
            raise HTTPException(422, str(e)) from None
        if level:
            return solved(lambda: replan_from(inp, to_hhmm(t.hour * 60 + t.minute), [])), level
        return solved(lambda: solve_day(inp)), None

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
        return {**out(day, stored), "reminders": todays_reminders(stored["plan"], settings),
                "checked_in": bool(log), "tomorrow_task": (log[0]["tomorrow_task"].strip() or None) if log else None}

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
            if not result["items"] and result["energy_after_class"] is None and \
                    not any(result[k] for k in ("note", "blocker", "tomorrow_task")):
                raise HTTPException(422, "还什么都没记：点一下做没做，或者写一句")
            said = quote = result["note"]
        if earlier := db.logs_between(USER_ID, day, day):  # 只补这次说到的，不冲掉今天之前记过的
            old = earlier[0]
            result = {**old, **{k: v for k, v in result.items() if v not in (None, "")},
                      "items": {**old["items"], **result["items"]}}

        if ONE_THING in result["items"]:  # 昨晚定的那件事今天做到没有
            result["yesterday_done"] = result["items"][ONE_THING]["status"] != "skip"
        if result["energy_after_class"] is None:  # 没说电量就用今天报过的
            result["energy_after_class"] = stored["energy_level"]
        db.save_log(USER_ID, result)
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

    @app.put("/settings", summary="保存设置；排得出今天的计划才保存，今天的计划跟着换成新版本")
    def put_settings(body: SettingsIn):
        day = logical_date(clock())
        if crisis := screen(body, day):
            return crisis
        raw = to_plan_input(body, db.plan_input(USER_ID))
        plan, level = replan_today(day, raw)
        db.set_plan_input(USER_ID, raw)
        db.add_plan(USER_ID, day, plan, level)
        return from_plan_input(raw)

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
                      calendar=make_calendar(env))
