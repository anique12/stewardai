from stewardai.scheduler import meeting_scheduler as ms


def _m(id, native=None, url=None, attendees=None, created=None):
    return {
        "id": id,
        "user_id": f"u-{id}",
        "meet_url": url,
        "native_meeting_id": native,
        "attendees": attendees or [],
        "created_at": created,
    }


def test_group_key_prefers_native_then_derives_from_url():
    assert ms._group_key(_m("a", native="abc")) == "abc"
    assert ms._group_key(_m("b", url="https://meet.google.com/xyz-defg-hij")) == "xyz-defg-hij"
    assert ms._group_key(_m("c")) is None


def test_partition_groups_shared_key_and_isolates_keyless():
    rows = [
        _m("1", native="abc"),
        _m("2", url="https://meet.google.com/abc"),  # same key as #1 via url
        _m("3", native="zzz"),
        _m("4"),  # keyless singleton
    ]
    groups, singletons = ms._partition_due(rows)
    keyed = {tuple(sorted(m["id"] for m in g)) for g in groups}
    assert ("1", "2") in keyed
    assert ("3",) in keyed
    assert [m["id"] for m in singletons] == ["4"]


def test_is_organizer_reads_self_organizer_attendee():
    org = _m("1", attendees=[{"self": True, "organizer": True}])
    non = _m("2", attendees=[{"self": True, "organizer": False}])
    assert ms._is_organizer(org) is True
    assert ms._is_organizer(non) is False


def test_pick_lead_prefers_organizer_then_attendee_count_then_created():
    organizer = _m(
        "1",
        native="k",
        attendees=[{"self": True, "organizer": True}],
        created="2026-01-02",
    )
    most = _m(
        "2", native="k", attendees=[{}, {}, {}], created="2026-01-01"
    )
    assert ms._pick_lead([most, organizer])["id"] == "1"  # organizer wins

    a = _m("3", native="k", attendees=[{}, {}], created="2026-01-02")
    b = _m("4", native="k", attendees=[{}], created="2026-01-01")
    assert (
        ms._pick_lead([b, a])["id"] == "3"
    )  # more attendees wins (no organizer)

    e1 = _m("5", native="k", attendees=[{}], created="2026-01-01")
    e2 = _m("6", native="k", attendees=[{}], created="2026-01-02")
    assert (
        ms._pick_lead([e2, e1])["id"] == "5"
    )  # earliest created wins on tie
