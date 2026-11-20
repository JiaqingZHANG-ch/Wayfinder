"""合并版 App 的接口（合并版设计 八）。排程只由求解器做，模型只负责把一句话理解成对账记录。

启动：.\\serve.ps1 ，然后打开 http://127.0.0.1:8000/docs
"""
import json
import os
from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from mentor.checkin import VS_PLAN, Item, closing_line, parse_sentence, validate_checkin
from mentor.mentor import MAX_INPUT, logical_date
from mentor.model import ModelPort, make_model
from mentor.safety import CRISIS_MESSAGE, is_crisis
from planner.errors import InputError, PlanInfeasible
from planner.model import input_from_dict, to_hhmm
from planner.solve import DayPlan, replan_from, solve_day

from .db import Db

# shortcut: 第 7 周加登录之前只有一个本机用户；之后从登录信息里取 user_id
USER_ID = 1
DEFAULT_TEMPLATE = Path(__file__).resolve().parents[3] / "daily-planner" / "examples" / "users" / "学生.json"


class EnergyIn(BaseModel):
    level: int = Field(ge=1, le=5, description="电量几格（1–5）")
    now: str | None = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="从几点开始重排，不填 = 现在")
    done_ids: list[str] = Field(default_factory=list, description="今天已经做完的事项 id")


class ConfirmIn(BaseModel):
    version: int


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
        db.set_plan_input(USER_ID, template)  # shortcut: 第 4 周做建档和设置页之前，用模板当设置

    app = FastAPI(title="合并版 App 后端", version="0.1.0")

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

    @app.get("/today", summary="今日计划，没有就生成")
    def get_today():
        day = logical_date(clock())
        return out(day, today_plan(day))

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

    @app.post("/plan/confirm", summary="确认计划（第 6 周起同时写入「余能计划」日历）")
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

    @app.get("/week", summary="近 7 天：每个习惯做了几天 / 记录了几天，项目比预想多还是少")
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
                "habits": habits, "projects": projects}

    return app


def app_from_env(env=os.environ) -> FastAPI:
    template = Path(env.get("PLAN_TEMPLATE") or DEFAULT_TEMPLATE)
    return create_app(Db(env.get("APP_DB") or "var/app.db"), make_model(env),
                      template=json.loads(template.read_text(encoding="utf-8")))
