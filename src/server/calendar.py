"""「Wayfinder 计划」日历（合并版设计 第 6 周）。只在用户确认计划之后写；先删掉这一天写过的再写，重复确认不会重复。

Google 那一头要先做第 6 周循环 ②：在 Google Cloud 建测试项目、打开 Calendar API、建「桌面应用」OAuth 客户端，
把下载的 credentials.json 放到 var/google/。然后运行 `uv run python -m server.calendar`，浏览器里授权一次，
授权结果存成 var/google/token.json。之后 `$env:CALENDAR = 'google'; .\\serve.ps1`。

权限只要 calendar.app.created：只能管这个 App 自己建的日历，看不到你别的日程。
"""
import os
import threading
from collections.abc import Mapping
from datetime import date
from pathlib import Path
from typing import Protocol

CALENDAR_NAME = "Wayfinder 计划"
SCOPES = ["https://www.googleapis.com/auth/calendar.app.created"]
WRITE_KINDS = ("must", "proj", "flex")  # 只写 Wayfinder 排的事；课和吃饭本来就在用户自己的日程里


class CalendarError(Exception):
    """写日历没成功（网络、Google 那边出错）。计划照样算确认了。"""


class CalendarAuthError(CalendarError):
    """授权没了、过期或被撤销：要用户重新连一次。"""


class CalendarPort(Protocol):
    def write_day(self, day: date, blocks: list[dict], tz: str) -> None: ...


def events_for(day: date, blocks: list[dict], tz: str) -> list[dict]:
    """把计划块变成 Google 日历的事件。每个事件带上 wayfinder_day，下次写同一天时靠它找到并删掉。"""
    return [{"summary": b["title"],
             "start": {"dateTime": f"{day.isoformat()}T{b['start']}:00", "timeZone": tz},
             "end": {"dateTime": f"{day.isoformat()}T{b['end']}:00", "timeZone": tz},
             "extendedProperties": {"private": {"wayfinder_day": day.isoformat()}}}
            for b in blocks if b["kind"] in WRITE_KINDS]


class FakeCalendar:
    """测试用：记下每天写了什么。auth_ok=False 模拟授权被撤销。"""

    def __init__(self, auth_ok: bool = True) -> None:
        self.days: dict[str, list[dict]] = {}
        self.auth_ok = auth_ok

    def write_day(self, day: date, blocks: list[dict], tz: str) -> None:
        if not self.auth_ok:
            raise CalendarAuthError("Google 日历的授权失效了")
        self.days[day.isoformat()] = events_for(day, blocks, tz)  # 同一天再写就整个换掉


# shortcut: 只在单元测试里用假日历测过；家庆做完循环 ② 拿到 token 后，第一次真写要看一眼日历
class GoogleCalendar:
    def __init__(self, folder: Path) -> None:
        self.token, self.calendar_id_file = folder / "token.json", folder / "calendar_id.txt"
        self._lock = threading.Lock()

    def _service(self):
        from google.auth.exceptions import RefreshError
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        if not self.token.exists():
            raise CalendarAuthError("还没连 Google 日历")
        creds = Credentials.from_authorized_user_file(str(self.token), SCOPES)
        if not creds.valid:
            if not (creds.expired and creds.refresh_token):
                raise CalendarAuthError("Google 日历的授权失效了")
            try:
                creds.refresh(Request())
            except RefreshError:  # 用户在 Google 账号里撤销了授权，就会走到这里
                raise CalendarAuthError("Google 日历的授权失效了") from None
            self.token.write_text(creds.to_json(), encoding="utf-8")
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    def _calendar_id(self, svc, tz: str) -> str:
        # 这个权限不能列出用户的日历，所以第一次建好后把 id 记在本地
        if self.calendar_id_file.exists():
            return self.calendar_id_file.read_text(encoding="utf-8").strip()
        cal = svc.calendars().insert(body={"summary": CALENDAR_NAME, "timeZone": tz}).execute()
        self.calendar_id_file.write_text(cal["id"], encoding="utf-8")
        return cal["id"]

    def _write(self, day: date, blocks: list[dict], tz: str) -> None:
        svc = self._service()
        cid = self._calendar_id(svc, tz)
        old = svc.events().list(calendarId=cid, privateExtendedProperty=f"wayfinder_day={day.isoformat()}",
                                singleEvents=True).execute().get("items", [])
        for e in old:
            svc.events().delete(calendarId=cid, eventId=e["id"]).execute()
        for e in events_for(day, blocks, tz):
            svc.events().insert(calendarId=cid, body=e).execute()

    def write_day(self, day: date, blocks: list[dict], tz: str) -> None:
        from googleapiclient.errors import HttpError

        # 连点两次「就这样」会同时来两个请求：排队写，不然两边都没看到旧事件、各写一份，或者各建一个日历
        # shortcut: 锁只在一个进程里有效；后端开多个进程时要换成数据库里的锁
        with self._lock:
            for attempt in range(2):
                try:
                    return self._write(day, blocks, tz)
                except CalendarError:
                    raise
                except HttpError as e:
                    if e.status_code == 404 and attempt == 0 and self.calendar_id_file.exists():
                        self.calendar_id_file.unlink()  # 用户在 Google 里删了这个日历：重建一个再写
                        continue
                    if e.status_code in (401, 403):
                        raise CalendarAuthError("Google 日历的授权失效了") from None
                    raise CalendarError(f"Google 日历出错：{e.status_code}") from None
                except Exception as e:  # 网络断了之类：不让它把「确认计划」弄失败
                    raise CalendarError(f"写日历失败：{e}") from None


def make_calendar(env: Mapping[str, str]) -> CalendarPort | None:
    """CALENDAR=off（默认，不写日历）| fake | google。"""
    kind = env.get("CALENDAR", "off").strip().lower()
    if kind == "off":
        return None
    if kind == "fake":
        return FakeCalendar()
    if kind == "google":
        return GoogleCalendar(Path(env.get("GOOGLE_DIR") or "var/google"))
    raise ValueError(f"CALENDAR 只能是 off / fake / google，现在是 {kind!r}")


if __name__ == "__main__":  # 授权一次：uv run python -m server.calendar
    from google_auth_oauthlib.flow import InstalledAppFlow

    folder = Path(os.environ.get("GOOGLE_DIR") or "var/google")
    flow = InstalledAppFlow.from_client_secrets_file(str(folder / "credentials.json"), SCOPES)
    (folder / "token.json").write_text(flow.run_local_server(port=0).to_json(), encoding="utf-8")
    print("连好了：", folder / "token.json")
