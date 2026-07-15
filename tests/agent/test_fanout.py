from unittest.mock import AsyncMock, MagicMock, patch

from stewardai.agent import fanout


def _client(rows=None):
    client = MagicMock()
    sel = MagicMock()
    sel.execute = AsyncMock(return_value=MagicMock(data=rows or []))
    sel.eq.return_value = sel
    sel.limit.return_value = sel
    upd = MagicMock()
    upd.execute = AsyncMock(return_value=MagicMock(data=[{}]))
    upd.eq.return_value = upd
    table = MagicMock()
    table.select.return_value = sel
    table.update.return_value = upd
    client.table.return_value = table
    return client


async def test_resolve_group_meetings_filters_by_status():
    rows = [
        {"id": "m-1", "user_id": "u-1", "bot_status": "in_meeting"},
        {"id": "m-2", "user_id": "u-2", "bot_status": "grouped"},
        {"id": "m-3", "user_id": "u-3", "bot_status": "pending"},   # excluded
        {"id": "m-4", "user_id": "u-4", "bot_status": "failed"},    # excluded
    ]
    client = _client(rows)
    out = await fanout.resolve_group_meetings(client, "abc")
    assert sorted(m["id"] for m in out) == ["m-1", "m-2"]


async def test_fanout_shared_artifacts_persists_each_and_marks_done():
    client = _client()
    siblings = [{"id": "m-2", "user_id": "u-2"}, {"id": "m-3", "user_id": "u-3"}]
    with patch.object(fanout, "persist_meeting_artifacts", AsyncMock()) as persist:
        await fanout.fanout_shared_artifacts(client, siblings, ["[A]: hi"], {"tldr": "x"})
    assert persist.await_count == 2
    assert {c.args[1] for c in persist.await_args_list} == {"m-2", "m-3"}


async def test_fanout_per_user_actions_runs_extraction_per_user():
    client = _client()
    siblings = [{"id": "m-2", "user_id": "u-2"}, {"id": "m-3", "user_id": None}]
    with patch.object(fanout, "extract_post_meeting_actions", AsyncMock(return_value=1)) as ex, \
         patch.object(fanout, "AgentActionsWriter", MagicMock()):
        await fanout.fanout_per_user_actions(MagicMock(), MagicMock(), client, siblings, ["t"])
    # Only the sibling with a user_id runs (m-3 skipped: no user_id).
    assert ex.await_count == 1
    assert ex.await_args.kwargs["user_id"] == "u-2"
    assert ex.await_args.kwargs["meeting_id"] == "m-2"


async def test_fanout_per_user_actions_uses_each_followers_own_timezone():
    """Each follower's OWN profiles.timezone must drive their action extraction,
    not the lead's default_timezone (a follower in another tz otherwise gets
    wrong calendar due-dates)."""
    # u-2 has a profile timezone set; u-3's is empty and must fall back.
    tz_rows = {"u-2": [{"timezone": "America/Los_Angeles"}], "u-3": []}

    def _profiles_table():
        table = MagicMock()

        def _select(*_a, **_k):
            chain = MagicMock()
            chain.limit.return_value = chain

            def _eq(field, value):
                chain.execute = AsyncMock(
                    return_value=MagicMock(data=tz_rows.get(value, []))
                )
                return chain

            chain.eq.side_effect = _eq
            return chain

        table.select.side_effect = _select
        return table

    client = MagicMock()
    client.table.side_effect = lambda name: _profiles_table() if name == "profiles" else MagicMock()

    siblings = [
        {"id": "m-2", "user_id": "u-2"},
        {"id": "m-3", "user_id": "u-3"},
    ]
    with patch.object(fanout, "extract_post_meeting_actions", AsyncMock(return_value=1)) as ex, \
         patch.object(fanout, "AgentActionsWriter", MagicMock()):
        await fanout.fanout_per_user_actions(
            MagicMock(), MagicMock(), client, siblings, ["t"], default_timezone="UTC"
        )

    assert ex.await_count == 2
    tz_by_call = {c.kwargs["user_id"]: c.kwargs["default_timezone"] for c in ex.await_args_list}
    assert tz_by_call["u-2"] == "America/Los_Angeles"
    assert tz_by_call["u-3"] == "UTC"  # empty profile timezone falls back


async def test_fanout_notes_emails_enqueues_owner_per_meeting():
    client = _client()
    group = [
        {
            "id": "m-1", "user_id": "u-1", "title": "Sync",
            "notes_recipients": "only_me", "attendees": [],
        },
        {
            "id": "m-2", "user_id": "u-2", "title": "Sync",
            "notes_recipients": "only_me", "attendees": [],
        },
    ]
    settings = MagicMock(email_enabled=True)
    with patch.object(fanout, "resolve_owner_email", AsyncMock(return_value="o@x.com")), \
         patch.object(fanout, "enqueue_meeting_notes", AsyncMock(return_value=True)) as enq:
        await fanout.fanout_notes_emails(client, settings, group)
    assert enq.await_count == 2
    assert {c.kwargs["meeting_id"] for c in enq.await_args_list} == {"m-1", "m-2"}


async def test_fail_grouped_followers_marks_non_excluded_rows_failed():
    rows = [{"id": "m-2"}, {"id": "m-3"}, {"id": "m-1"}]  # m-1 is the lead
    client = _client(rows)
    await fanout.fail_grouped_followers(client, "abc", exclude_meeting_uuid="m-1")

    update_calls = client.table.return_value.update.call_args_list
    assert all(c.args[0] == {"bot_status": "failed"} for c in update_calls)
    eq_calls = client.table.return_value.update.return_value.eq.call_args_list
    updated_ids = {c.args[1] for c in eq_calls}
    assert updated_ids == {"m-2", "m-3"}


async def test_fanout_notes_emails_everyone_also_enqueues_attendees():
    client = _client()
    group = [{
        "id": "m-1", "user_id": "u-1", "title": "Sync", "notes_recipients": "everyone",
        "attendees": [{"email": "guest@x.com", "self": False}, {"email": "me@x.com", "self": True}],
    }]
    settings = MagicMock(email_enabled=True)
    with patch.object(fanout, "resolve_owner_email", AsyncMock(return_value="o@x.com")), \
         patch.object(fanout, "enqueue_meeting_notes", AsyncMock(return_value=True)) as enq:
        await fanout.fanout_notes_emails(client, settings, group)
    tos = {c.kwargs["to_email"] for c in enq.await_args_list}
    # owner + non-self attendee; the self attendee is not double-sent.
    assert "o@x.com" in tos and "guest@x.com" in tos and "me@x.com" not in tos
