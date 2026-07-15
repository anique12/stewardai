from stewardai.email.templates import render


def test_welcome_render_has_subject_and_name():
    subject, html = render("welcome", {"name": "Anique", "app_url": "https://app.x.ai"})
    assert "MeetingBase" in subject
    assert "Anique" in html
    assert "https://app.x.ai" in html


def test_bot_failed_render_includes_meeting_title():
    subject, html = render("bot_failed", {"title": "Daily Standup", "app_url": "https://app.x.ai"})
    assert "Daily Standup" in html
    assert subject
