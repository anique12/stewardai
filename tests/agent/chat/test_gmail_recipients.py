from stewardai.agent.chat.composio_tools import _normalize_gmail_recipients as norm


def test_comma_separated_splits_into_primary_plus_extra():
    r = norm("GMAIL_SEND_EMAIL", {"recipient_email": "a@x.com, b@y.com, c@z.com", "subject": "s"})
    assert r["recipient_email"] == "a@x.com"
    assert r["extra_recipients"] == ["b@y.com", "c@z.com"]
    assert r["subject"] == "s"


def test_single_recipient_untouched():
    assert norm("GMAIL_SEND_EMAIL", {"recipient_email": "a@x.com"}) == {"recipient_email": "a@x.com"}


def test_to_alias_semicolons_and_merges_dedupes_existing_extra():
    r = norm(
        "GMAIL_SEND_EMAIL",
        {"to": "a@x.com; b@y.com", "extra_recipients": ["b@y.com", "d@w.com"]},
    )
    assert "to" not in r
    assert r["recipient_email"] == "a@x.com"
    assert r["extra_recipients"] == ["b@y.com", "d@w.com"]  # primary not duplicated, existing kept


def test_list_recipient_email():
    r = norm("GMAIL_SEND_EMAIL", {"recipient_email": ["a@x.com", "b@y.com"]})
    assert r["recipient_email"] == "a@x.com"
    assert r["extra_recipients"] == ["b@y.com"]


def test_non_gmail_action_untouched():
    assert norm("SLACK_SENDS_A_MESSAGE", {"recipient_email": "a,b"}) == {"recipient_email": "a,b"}
