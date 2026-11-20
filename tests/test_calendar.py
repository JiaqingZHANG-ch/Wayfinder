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
