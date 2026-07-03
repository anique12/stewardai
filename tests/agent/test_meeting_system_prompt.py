"""build_meeting_system — current-date injection.

Regression for the live-meeting bug where the agent scheduled a calendar event in
2024 and didn't know today's date: the meeting system prompt never told the model
what "today" is, so time-relative requests resolved to the model's training prior.
"""

from __future__ import annotations

from stewardai.agent.assembly import build_meeting_system


def test_includes_today_when_provided():
    prompt = build_meeting_system("Steward", today="Friday, July 03, 2026")
    assert "Friday, July 03, 2026" in prompt
    # and it's framed as the anchor for time-relative requests
    assert "today" in prompt.lower()


def test_omits_date_line_when_not_provided():
    prompt = build_meeting_system("Steward")
    assert "Today's date is" not in prompt


def test_date_line_is_present_alongside_tools_note():
    # the date must survive regardless of tool availability (calendar scheduling
    # is exactly when the date matters most)
    prompt = build_meeting_system("Steward", tools_available=True, today="Monday, January 05, 2026")
    assert "Monday, January 05, 2026" in prompt
