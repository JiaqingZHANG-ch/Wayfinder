import pytest

from mentor.reminders import REMINDERS
from mentor.tone import banned_hits


@pytest.mark.parametrize("kind", REMINDERS)
def test_reminder_copy_passes_banned_phrases(kind):
    # 第 5 周循环 ③：改 reminders.py 里的文案时，这个测试要保持绿
    title, body, url = REMINDERS[kind]
    assert banned_hits(title) == [] and banned_hits(body) == []
    assert url.startswith("/") and len(body) <= 30  # 通知栏里一眼看完