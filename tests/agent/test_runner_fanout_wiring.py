from unittest.mock import AsyncMock, MagicMock, patch

from stewardai.agent import meeting_runner as mr


class _Sess:
    """Minimal stand-in exposing just what _fanout_results reads."""

    def __init__(self):
        self._supabase = MagicMock()
        self._llm = MagicMock()
        self._composio = MagicMock()
        self._s = MagicMock(email_enabled=True)
        self.native_meeting_id = "abc"
        self._meeting_uuid = "m-1"  # the lead
        self._last_summary = {"tldr": "x"}
        self._user_timezone = "UTC"
        self._admitted = True


async def test_fanout_results_targets_followers_and_all_for_email():
    sess = _Sess()
    group = [
        {"id": "m-1", "user_id": "u-1"},  # lead
        {"id": "m-2", "user_id": "u-2"},  # follower
    ]
    with patch.object(mr, "_fanout_mod") as mod:
        mod.resolve_group_meetings = AsyncMock(return_value=group)
        mod.fanout_shared_artifacts = AsyncMock()
        mod.fanout_per_user_actions = AsyncMock()
        mod.fanout_notes_emails = AsyncMock()
        await mr._fanout_results(sess, ["[A]: hi"])

    # Followers only (excludes the lead m-1) for artifacts + actions.
    followers = mod.fanout_shared_artifacts.await_args.args[1]
    assert [m["id"] for m in followers] == ["m-2"]
    mod.fanout_per_user_actions.assert_awaited_once()
    # Emails for the WHOLE group (lead + follower).
    emailed = mod.fanout_notes_emails.await_args.args[2]
    assert [m["id"] for m in emailed] == ["m-1", "m-2"]


async def test_fanout_results_noop_without_summary():
    sess = _Sess()
    sess._last_summary = None
    with patch.object(mr, "_fanout_mod") as mod:
        mod.resolve_group_meetings = AsyncMock(return_value=[])
        mod.fail_grouped_followers = AsyncMock()
        await mr._fanout_results(sess, ["t"])
    mod.resolve_group_meetings.assert_not_awaited()
    mod.fail_grouped_followers.assert_awaited_once_with(
        sess._supabase, sess.native_meeting_id, exclude_meeting_uuid=sess._meeting_uuid
    )


async def test_fanout_results_fails_followers_when_not_admitted():
    """A bot that never got admitted (no-show) must NOT fan out artifacts/emails
    even if it produced a (falsely) truthy summary — coherently fail followers
    instead of stranding them or emailing "notes ready"."""
    sess = _Sess()
    sess._admitted = False
    with patch.object(mr, "_fanout_mod") as mod:
        mod.resolve_group_meetings = AsyncMock()
        mod.fanout_shared_artifacts = AsyncMock()
        mod.fail_grouped_followers = AsyncMock()
        await mr._fanout_results(sess, ["t"])

    mod.resolve_group_meetings.assert_not_awaited()
    mod.fanout_shared_artifacts.assert_not_awaited()
    mod.fail_grouped_followers.assert_awaited_once_with(
        sess._supabase, sess.native_meeting_id, exclude_meeting_uuid=sess._meeting_uuid
    )
