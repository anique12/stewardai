from stewardai.email.keys import dedup_key_for


def test_dedup_key_joins_kind_and_parts_in_order():
    assert dedup_key_for("welcome", user_id="u1") == "welcome:u1"
    assert dedup_key_for("meeting_notes", meeting_id="m1", email="a@b.com") == \
        "meeting_notes:m1:a@b.com"
