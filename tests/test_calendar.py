from datetime import date

import pytest

from server.calendar import CalendarAuthError, FakeCalendar, GoogleCalendar, events_for, make_calendar


def test_events_only_for_what_wayfinder_planned():
    blocks = [{"title": "数学", "start": "08:00", "end": "10:00", "kind": "class"},
              {"title": "晚饭", "start": "18:30", "end": "19:00", "kind": "life"},
              {"title": "看书", "start": "20:00", "end": "20:30", "kind": "must"}]
    assert events_for(date(2026, 11, 20), blocks, "Europe/Paris") == [{
        "summary": "看书",
        "start": {"dateTime": "2026-11-20T20:00:00", "timeZone": "Europe/Paris"},
        "end": {"dateTime": "2026-11-20T20:30:00", "timeZone": "Europe/Paris"},
        "extendedProperties": {"private": {"wayfinder_day": "2026-11-20"}}}]


def test_google_without_token_asks_to_connect(tmp_path):
    with pytest.raises(CalendarAuthError):
        GoogleCalendar(tmp_path).write_day(date(2026, 11, 20), [], "Europe/Paris")


def test_make_calendar():
    assert make_calendar({}) is None
    assert isinstance(make_calendar({"CALENDAR": "fake"}), FakeCalendar)
    assert isinstance(make_calendar({"CALENDAR": "google", "GOOGLE_DIR": "x"}), GoogleCalendar)
    with pytest.raises(ValueError):
        make_calendar({"CALENDAR": "outlook"})


class FakeGoogle:
    """够用的假 Google 日历服务：calendars().insert、events().list/delete/insert。"""

    def __init__(self):
        import time
        self.sleep, self.made, self.events_by_cal = time.sleep, [], {}

    def _call(self, fn):
        return type("Req", (), {"execute": lambda _self: fn()})()

    def calendars(self):
        def insert(body):
            def go():
                cid = f"cal-{len(self.made)}"
                self.made.append(cid)
                self.events_by_cal[cid] = []
                return {"id": cid}
            return self._call(go)
        return type("C", (), {"insert": lambda _self, body: insert(body)})()

    def events(self):
        from googleapiclient.errors import HttpError
        from httplib2 import Response

        def evs(cid):
            if cid not in self.events_by_cal:
                raise HttpError(Response({"status": 404}), b"not found")
            return self.events_by_cal[cid]

        def list_(calendarId, privateExtendedProperty, singleEvents):
            def go():
                found = list(evs(calendarId))
                self.sleep(0.05)  # 让两个请求有机会交错
                return {"items": [dict(e) for e in found]}
            return self._call(go)

        def delete(calendarId, eventId):
            return self._call(lambda: self.events_by_cal[calendarId].remove(
                next(e for e in self.events_by_cal[calendarId] if e["id"] == eventId)))

        def insert(calendarId, body):
            return self._call(lambda: evs(calendarId).append({**body, "id": str(id(body))}))
        return type("E", (), {"list": lambda _s, **k: list_(**k), "delete": lambda _s, **k: delete(**k),
                              "insert": lambda _s, **k: insert(**k)})()


BLOCKS = [{"title": "看书", "start": "20:00", "end": "20:30", "kind": "must"},
          {"title": "背单词", "start": "21:00", "end": "21:20", "kind": "must"}]


def google(tmp_path, svc):
    cal = GoogleCalendar(tmp_path)
    cal._service = lambda: svc
    return cal


def test_double_confirm_at_once_writes_one_set_in_one_calendar(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    svc = FakeGoogle()
    cal = google(tmp_path, svc)
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda _: cal.write_day(date(2026, 11, 20), BLOCKS, "Europe/Paris"), range(2)))
    assert len(svc.made) == 1 and len(svc.events_by_cal["cal-0"]) == 2


def test_calendar_deleted_in_google_is_recreated(tmp_path):
    svc = FakeGoogle()
    cal = google(tmp_path, svc)
    cal.write_day(date(2026, 11, 20), BLOCKS, "Europe/Paris")
    del svc.events_by_cal["cal-0"]  # 用户在 Google 里把日历删了
    cal.write_day(date(2026, 11, 20), BLOCKS, "Europe/Paris")
    assert svc.made == ["cal-0", "cal-1"] and len(svc.events_by_cal["cal-1"]) == 2
