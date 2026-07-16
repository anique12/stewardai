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
        {
            "title": "Weekly Sync",
            "app_url": "https://app.example",
            "meeting_id": "m-1",
        },
    )
    assert "Your notes for" in subject
    assert "Weekly Sync" in subject
    assert "https://app.example/app/meetings/m-1" in html


def test_meeting_notes_shared_variant_renders_host_and_signup_cta():
    subject, html = render(
        "meeting_notes",
        {
            "title": "Weekly Sync",
            "app_url": "https://app.example",
            "meeting_id": "m-1",
            "shared": True,
            "host_name": "Jane Host",
            "tldr": "We aligned on the roadmap.",
            "decisions": ["Ship the v2 API"],
            "action_items": [{"owner": "Bob", "task": "Write the doc", "due": "2026-01-01"}],
        },
    )
    assert "Jane Host" in subject
    assert "Weekly Sync" in subject
    assert "Jane Host" in html
    assert "https://app.example/app/meetings/m-1" in html
    # Signup CTA points at the bare app_url.
    assert 'href="https://app.example"' in html
    assert "Try MeetBase free" in html
    # Content sections render when present.
    assert "We aligned on the roadmap." in html
    assert "Ship the v2 API" in html
    assert "Write the doc" in html
    assert "due 2026-01-01" in html
