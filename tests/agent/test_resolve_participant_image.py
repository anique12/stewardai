from stewardai.agent.meeting_runner import resolve_participant_image

IMG = "https://lh3.googleusercontent.com/a/PHOTO=s192-c-mo"


def test_matches_meet_display_name_to_email_localpart_calendar_name():
    # Calendar attendee name is the email localpart (Google invite had no
    # display name); Vexa roster keys by the Meet display name.
    roster = {"Ahmad Mursal": IMG}
    assert resolve_participant_image("ahmadmursal968", roster) == IMG
    assert resolve_participant_image("aniquesabir65", {"Anique Sabir": IMG}) == IMG


def test_exact_normalized_match_still_works():
    assert resolve_participant_image("John  Doe", {"john doe": IMG}) == IMG


def test_no_false_positive_for_short_or_unrelated_names():
    assert resolve_participant_image("ahmadmursal968", {"Jane Smith": IMG}) is None
    # Short names must not containment-match (avoids "al" in "Alice").
    assert resolve_participant_image("al", {"Alice Cooper": IMG}) is None


def test_empty_inputs_return_none():
    assert resolve_participant_image("", {"Ahmad Mursal": IMG}) is None
    assert resolve_participant_image("ahmadmursal968", {}) is None
