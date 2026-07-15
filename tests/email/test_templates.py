from stewardai.email.templates import render


def test_welcome_render_has_subject_and_name():
    subject, html = render("welcome", {"name": "Anique", "app_url": "https://app.x.ai"})
    assert "MeetBase" in subject
    assert "Anique" in html
    assert "https://app.x.ai" in html


def test_bot_failed_render_includes_meeting_title():
    subject, html = render("bot_failed", {"title": "Daily Standup", "app_url": "https://app.x.ai"})
    assert "Daily Standup" in html
    assert subject


def test_meeting_notes_template_renders_subject_and_body():
    subject, html = render(
        "meeting_notes",
        {"title": "Weekly Sync", "app_url": "https://app.example"},
    )
    assert "Weekly Sync" in subject
    assert "https://app.example/app/meetings" in html
