"""合并版 App 的接口（合并版设计 八）。排程只由求解器做，模型只负责把一句话理解成对账记录。

启动：.\\serve.ps1 ，然后打开 http://127.0.0.1:8000/docs
"""
import json
import os
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
from mentor.model import ModelPort, make_model
from mentor.onboarding import QUESTIONS, run_round
from mentor.reminders import todays_reminders
from mentor.review import apply_adjustments, week_stats, write_review
from mentor.safety import CRISIS_MESSAGE, is_crisis
from planner.errors import InputError, PlanInfeasible
from planner.model import input_from_dict, to_hhmm
from planner.solve import DayPlan, replan_from, solve_day

from .db import Db
from .settings import SettingsIn, from_plan_input, to_plan_input

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


class CheckinIn(BaseModel):
    """二选一：按钮的结果（result），或者用户说的一句话（sentence）。"""
    result: dict | None = None
    sentence: str | None = None


def _plan_json(plan: DayPlan) -> dict:
    blocks = [{**asdict(b), "start": to_hhmm(b.start), "end": to_hhmm(b.end)}
              for b in sorted(plan.blocks, key=lambda b: b.start)]
    return {"blocks": blocks, "warnings": list(plan.warnings),
            "energy_used": round(plan.energy_used), "energy_cap": round(plan.energy_cap)}


def _items(plan: dict) -> dict[str, Item]:
    """对账能记哪些事：习惯和可选项按块 id，项目按任务 id（一个任务可能排了几块）。"""
    items = {}
    for b in plan["blocks"]:
        if b["kind"] in ("must", "flex"):
            items[b["id"]] = Item(b["title"])
        elif b["kind"] == "proj":
            items[b["task_id"]] = Item(b["title"], project=True)
    return items


def create_app(db: Db, model: ModelPort, *, template: dict | None = None,
               now: Callable[[ZoneInfo], datetime] = datetime.now) -> FastAPI:
    db.ensure_user(USER_ID)
    if db.plan_input(USER_ID) is None and template is not None:
        db.set_plan_input(USER_ID, template)  # 开发用：设了 PLAN_TEMPLATE 就跳过建档

    app = FastAPI(title="Wayfinder 后端", version="0.1.0")
    # Expo 网页版开在 8081，和后端不同源，浏览器要后端明说放行；手机上的 App 不受这条限制
    app.add_middleware(CORSMiddleware, allow_origins=WEB_ORIGINS, allow_methods=["GET", "POST", "PUT"],
                       allow_headers=["Content-Type"])

    def clock() -> datetime:
        return now(ZoneInfo(db.user_timezone(USER_ID)))

    def plan_input(day, energy_level=None):
        raw = db.plan_input(USER_ID)
        if raw is None:
            raise HTTPException(409, "还没有设置，先完成建档")
        raw = {**raw, "day": day.isoformat()}
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
        text = json.dumps(body.model_dump(), ensure_ascii=False)
        try:
            text.encode("utf-8")
        except UnicodeEncodeError:
            raise HTTPException(422, "文字里有无法识别的字符") from None
        if is_crisis(text):
            db.log_crisis(USER_ID, day, text)
            return {"crisis": True, "message": CRISIS_MESSAGE}
        return None

    @app.get("/today", summary="今日计划，没有就生成；reminders 是手机要定的两条本地提醒")
    def get_today():
        day = logical_date(clock())
        stored = today_plan(day)
        settings = (db.plan_input(USER_ID) or {}).get("reminders")
        return {**out(day, stored), "reminders": todays_reminders(stored["plan"], settings)}

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

    @app.post("/plan/confirm", summary="确认计划（第 6 周起同时写入「Wayfinder 计划」日历）")
    def post_confirm(body: ConfirmIn):
        day = logical_date(clock())
        stored = db.latest_plan(USER_ID, day)
        if stored is None or stored["version"] != body.version:
            raise HTTPException(409, "这不是今天最新的计划，刷新后再确认")
        db.confirm_plan(USER_ID, day, body.version)
        return out(day, db.latest_plan(USER_ID, day))

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
        items = _items(today_plan(day)["plan"])

        if body.sentence is not None:
            outcome, result = parse_sentence(model, body.sentence, day, items)
            if outcome == "crisis":
                db.log_crisis(USER_ID, day, body.sentence)
                return {"crisis": True, "message": CRISIS_MESSAGE}
            if outcome == "bad":  # 什么都不存，让用户点按钮补
                raise HTTPException(422, "这句话我没整理出来，请点按钮补上")
            said, quote = body.sentence, result["note"]
            if earlier := db.logs_between(USER_ID, day, day):  # 一句话只补它提到的，不冲掉按钮记过的
                old = earlier[0]
                result = {**old, **{k: v for k, v in result.items() if v not in (None, "")},
                          "items": {**old["items"], **result["items"]}}
        else:
            try:
                result = validate_checkin(body.result, day, items)
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
            said = quote = result["note"]

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

        habits = [{"id": h["id"], "title": h["title"],
                   "done_days": sum(s["status"] in ("done", "floor") for s in statuses(h["id"]))}
                  for h in raw.get("habits", [])]
        projects = [{"id": t["id"], "title": t["title"],
                     **{v: sum(s.get("vs_plan") == v for s in statuses(t["id"])) for v in VS_PLAN}}
                    for t in raw.get("tasks", [])]
        return {"start": start.isoformat(), "end": end.isoformat(), "logged_days": len(logs),
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
                return {"crisis": True, "message": CRISIS_MESSAGE}
            try:
                stale = db.stalest_profile(USER_ID, day)
            except NotImplementedError:  # 第 4 周循环 ⑥ 写好之前，复盘不问「还对吗」
                stale = None
            db.add_review(USER_ID, day, {"stats": stats, **written, "still_right": stale and stale["id"]})
            return review_view(db.reviews(USER_ID)[0])

        if body.id is None or body.index is None or body.accept is None:
            raise HTTPException(422, "回答调整要同时填 id、index、accept")
        if not latest or latest[0]["id"] != body.id:
            raise HTTPException(409, "只能回答最近一次复盘里的调整")
        adjustments = latest[0]["adjustments"]
        if body.index >= len(adjustments) or adjustments[body.index]["answer"] is not None:
            raise HTTPException(409, "没有这条调整，或者已经回答过了")
        raw = None
        if body.accept:  # 先确认改完还排得出今天的计划，再记回答、写设置
            raw = apply_adjustments(db.plan_input(USER_ID) or {}, [adjustments[body.index]])
            try:
                inp = input_from_dict({**raw, "day": day.isoformat()})
            except InputError as e:
                raise HTTPException(422, str(e)) from None
            plan = solved(lambda: solve_day(inp))
        if not db.answer_adjustment(USER_ID, body.id, body.index, "好" if body.accept else "先不改"):
            raise HTTPException(409, "这条已经回答过了")
        if raw is not None:
            db.set_plan_input(USER_ID, raw)
            db.add_plan(USER_ID, day, plan, None)
        return review_view(db.reviews(USER_ID)[0])

    @app.post("/onboarding", summary="建档对话的一轮：一次只问一个问题，最后提一条「方向」等用户确认")
    def post_onboarding(body: OnboardingIn):
        day = logical_date(clock())
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
            return {"crisis": True, "message": CRISIS_MESSAGE}
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
        try:
            inp = input_from_dict({**raw, "day": day.isoformat()})
        except InputError as e:
            raise HTTPException(422, str(e)) from None
        plan = solved(lambda: solve_day(inp))
        db.set_plan_input(USER_ID, raw)
        db.add_plan(USER_ID, day, plan, None)
        return from_plan_input(raw)

    return app


def app_from_env(env=os.environ) -> FastAPI:
    """PLAN_TEMPLATE 设成一份求解器输入（比如 daily-planner 的假用户）就跳过建档；不设就从建档开始。"""
    path = env.get("PLAN_TEMPLATE")
    template = json.loads(Path(path).read_text(encoding="utf-8")) if path else None
    return create_app(Db(env.get("APP_DB") or "var/app.db"), make_model(env), template=template)
