"""每天两条本地提醒（合并版设计 六）：下课问电量、晚上对账。文案在这里写，禁用词测试管得到。

时间由后端从当天计划和设置算出来，手机拿到后自己定时，不用服务器推送。
"""
REMINDERS = {
    # kind: (标题, 正文, 点开去哪一页)
    "after_class": ("下课了", "电量几格？点一下，只重排今晚。", "/energy"),
    "evening": ("晚间对账", "今天的几件事，点一下就记好。", "/checkin"),
    "letter": ("有一封信到期了", "你写给自己的信，今天可以拆开了。", "/letter"),  # 只给回信用，不在每天那两条里
}
DEFAULT_EVENING = "21:00"


def todays_reminders(plan: dict, settings: dict) -> list[dict]:
    """plan 是 GET /today 的计划，settings 是求解器输入里的 reminders 一段（没有就用默认）。

    下课那条：最后一节课结束的时间；当天没课就没有这条。晚上那条：设置里的时间，设成 null 就关掉。
    """
    on = {"after_class": True, "evening": DEFAULT_EVENING, **(settings or {})}
    times = {}
    class_ends = [b["end"] for b in plan["blocks"] if b["kind"] == "class"]
    if on["after_class"] and class_ends:
        times["after_class"] = max(class_ends)
    if on["evening"]:
        times["evening"] = on["evening"]
    return [{"kind": k, "at": at, "title": REMINDERS[k][0], "body": REMINDERS[k][1], "url": REMINDERS[k][2]}
            for k, at in sorted(times.items(), key=lambda kv: kv[1])]
