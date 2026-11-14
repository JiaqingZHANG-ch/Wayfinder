"""界面：对话、档案、记录三页。只做展示和把输入交给 mentor.handle_turn，不含导师的逻辑。"""
import os
from collections.abc import Callable
from datetime import date
from pathlib import Path

from nicegui import run, ui

from mentor.mentor import MAX_INPUT, current_mode, handle_turn, weekly_due
from mentor.model import DeepSeekModel, ModelError, ModelPort
from mentor.safety import CRISIS_MESSAGE
from mentor.store import Store

DB_PATH = Path(__file__).resolve().parents[2] / "var" / "mentor.db"
FIRST_USE = "这不是心理咨询或医疗服务。你说的话会发送给模型服务商（DeepSeek）用来生成回复，记录保存在这台电脑上。"
_DONE_TEXT = {"none": "还没问", "yes": "做到了", "no": "没做到"}
_DONE_VALUE = {"none": None, "yes": True, "no": False}
_PAGE = "width: 100%; max-width: 720px; margin: 0 auto"


def _frame() -> ui.column:
    with ui.header().classes("items-center justify-between"):
        ui.link("成长导师", "/").classes("text-white text-lg").style("text-decoration: none")
        with ui.row():
            ui.link("档案", "/profile").classes("text-white")
            ui.link("记录", "/records").classes("text-white")
    return ui.column().style(_PAGE)


def _bubble(role: str, text: str) -> None:
    with ui.chat_message(name="你" if role == "user" else "导师", sent=role == "user"):
        ui.label(text).style("white-space: pre-wrap")  # 纯文本显示，保留换行


def build(store: Store, get_model: Callable[[], ModelPort], today: Callable[[], date] = date.today) -> None:

    @ui.page("/")
    def chat_page() -> None:
        day = today()  # 整个页面用打开时的日期：过了午夜接着聊，仍算这一天的对话；刷新后才换天
        state = {"mode": current_mode(store, day), "busy": False, "notice": None, "box": None}
        try:
            model = get_model()
        except ModelError as e:
            model = None
            missing = str(e)

        def history():
            mode = state["mode"]
            return store.messages(mode) if mode == "intake" else store.messages(mode, day)

        @ui.refreshable
        def conversation() -> None:
            notice = state["notice"]
            with ui.column().classes("w-full") as box:
                state["box"] = box
                if notice is not None:
                    _bubble("assistant", notice.reply)
                    if notice.saved == "profile":
                        ui.link("档案写好了，去看看和修改", "/profile")
                    if notice.saved == "weekly":
                        latest = store.all_weekly()[0]
                        with ui.card().classes("w-full"):
                            ui.label(f"本周规律：{latest.pattern}")
                            ui.label(f"下周调整：{latest.adjustment}")
                rows = store.daily_between(day, day)
                if state["mode"] == "free" and rows:
                    with ui.card().classes("w-full"):
                        ui.label(f"今天记下了：{rows[0].did}，投资自己 {rows[0].minutes} 分钟")
                        ui.label(f"明天的一件事：{rows[0].tomorrow_task}")
                shown = history()
                for m in shown:
                    _bubble(m.role, m.content)
                if store.is_paused(day) and not (shown and shown[-1].content == CRISIS_MESSAGE):
                    _bubble("assistant", CRISIS_MESSAGE)

        async def turn(text: str | None, *, force: bool = False) -> None:
            if state["busy"] or model is None:
                return
            state["busy"] = True
            composer.refresh()
            with state["box"]:
                if text:
                    _bubble("user", text)
                ui.spinner("dots", size="lg")
            try:
                result = await run.io_bound(handle_turn, store, model, state["mode"], text, day, force_finish=force)
            finally:
                state["busy"] = False
            if result.saved is not None:
                state["notice"] = result
                state["mode"] = current_mode(store, day)
            # 触发这次事件的输入框已经被上面的 composer.refresh() 重建，原来的上下文失效；
            # 之后的界面操作都放在不会被重建的 root 里做
            with root:
                if result.error:
                    ui.notify(result.reply, type="warning", timeout=8000, close_button="知道了")
                conversation.refresh()
                composer.refresh()
                ui.run_javascript("window.scrollTo(0, document.body.scrollHeight)")

        async def open_conversation() -> None:
            if state["mode"] != "free" and not store.is_paused(day) and not history():
                await turn(None)

        async def send(box: ui.textarea) -> None:
            text = (box.value or "").strip()
            if text:
                box.value = ""
                await turn(text)

        async def start_weekly() -> None:
            state["mode"], state["notice"] = "weekly", None
            conversation.refresh()
            composer.refresh()
            await open_conversation()

        def resume() -> None:
            store.resume(day)
            conversation.refresh()
            composer.refresh()

        @ui.refreshable
        def composer() -> None:
            if store.is_paused(day):
                ui.button("继续", on_click=resume)
                return
            with ui.row().classes("w-full"):
                shown = history()
                if shown and shown[-1].role == "user" and not state["busy"]:
                    # 上一句没得到回应（断网、模型没答好）：重试不重复存用户的话
                    ui.button("让导师回应", on_click=lambda: turn(None)).props("outline")
                if state["mode"] in ("intake", "weekly") and history() and not state["busy"]:
                    ui.button("结束并生成", on_click=lambda: turn(None, force=True)).props("outline")
                if state["mode"] in ("daily", "free") and weekly_due(store, day) and not state["busy"]:
                    ui.button("做本周复盘", on_click=start_weekly).props("outline")
            with ui.row().classes("w-full items-end no-wrap"):
                box = ui.textarea(placeholder="在这里说…").props(f"autogrow outlined dense maxlength={MAX_INPUT}")
                box.classes("col-grow")
                box.on("keydown.enter.exact.prevent", lambda: send(box))  # 回车发送，Shift+回车换行
                button = ui.button("发送", on_click=lambda: send(box))
                if state["busy"] or model is None:
                    box.disable()
                    button.disable()

        root = _frame()
        with root:
            if model is None:
                ui.label(missing).classes("text-negative")
            conversation()
        with ui.footer().classes("bg-white"), ui.column().style(_PAGE):
            composer()

        async def acknowledge(dialog: ui.dialog) -> None:
            store.set_flag("first_use_ack")
            dialog.close()
            await open_conversation()

        if store.get_flag("first_use_ack"):
            ui.timer(0.1, open_conversation, once=True)
        else:
            with ui.dialog().props("persistent") as dialog, ui.card():
                ui.label("开始之前").classes("text-lg")
                ui.label(FIRST_USE)
                ui.button("我知道了", on_click=lambda: acknowledge(dialog))
            dialog.open()

    @ui.page("/profile")
    def profile_page() -> None:
        with _frame():
            text = store.get_profile()
            if text is None:
                ui.label("还没有档案。先去对话页和导师谈一次，谈完会生成在这里。")
                return
            ui.label("我的档案").classes("text-lg")
            box = ui.textarea(value=text).props("autogrow outlined maxlength=6000").classes("w-full")

            def save() -> None:
                if not (box.value or "").strip():
                    ui.notify("档案不能是空的", type="warning")
                    return
                store.set_profile(box.value, today())
                ui.notify("已保存", type="positive")

            ui.button("保存", on_click=save)

    @ui.page("/records")
    def records_page() -> None:
        with _frame():
            ui.label("每日记录").classes("text-lg")
            rows = store.daily_between(date.min, date.max)
            if not rows:
                ui.label("还没有记录。")
            for d in reversed(rows):
                with ui.card().classes("w-full"):
                    ui.label(f"{d.day.isoformat()}　{d.did}")
                    if d.blocker:
                        ui.label(f"卡在：{d.blocker}").classes("text-grey")
                    with ui.row().classes("w-full items-end"):
                        minutes = ui.number("分钟数", value=d.minutes, min=0, max=1440, precision=0)
                        minutes.style("width: 5em")
                        task = ui.input("定下的下一件事", value=d.tomorrow_task).props("maxlength=2000")
                        task.classes("col-grow")
                        key = "none" if d.done is None else "yes" if d.done else "no"
                        done = ui.select(_DONE_TEXT, label="做到没有", value=key).style("min-width: 7em")

                        def save(day=d.day, minutes=minutes, task=task, done=done) -> None:
                            value = minutes.value
                            if value is None or not 0 <= value <= 1440 or not (task.value or "").strip():
                                ui.notify("分钟数要在 0 到 1440 之间，那件事不能是空的", type="warning")
                                return
                            store.update_daily(day, minutes=int(value), tomorrow_task=task.value.strip(),
                                               done=_DONE_VALUE[done.value])
                            ui.notify("已保存", type="positive")

                        ui.button("保存", on_click=save).props("outline")
            ui.label("每周复盘").classes("text-lg")
            weekly = store.all_weekly()
            if not weekly:
                ui.label("还没有复盘。")
            for w in weekly:
                with ui.card().classes("w-full"):
                    ui.label(w.day.isoformat())
                    ui.label(f"规律：{w.pattern}")
                    ui.label(f"调整：{w.adjustment}")


def main() -> None:
    build(Store(DB_PATH), lambda: DeepSeekModel.from_env(os.environ))
    ui.run(host="127.0.0.1", port=8765, reload=False, show=False, title="成长导师", language="zh-CN")
