# tests/agent/kb/test_briefing.py
from stewardai.agent.kb.briefing import build_meeting_brief


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table, client):
        self._table = table
        self._client = client

    def select(self, *_a):
        return self

    def eq(self, *_a):
        return self

    def in_(self, *_a):
        return self

    def is_(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    async def execute(self):
        return _Resp(self._client._next(self._table))


class _FakeClient:
    """Table -> queue of responses, popped in call order per table."""

    def __init__(self, table_responses: dict):
        self._responses = {k: list(v) for k, v in table_responses.items()}

    def table(self, name):
        return _Query(name, self)

    def _next(self, name):
        q = self._responses.get(name)
        if not q:
            return []
        return q.pop(0)


class _BoomClient:
    def table(self, _name):
        raise RuntimeError("boom")


async def test_resolves_space_via_recurring_event_id_and_formats_brief():
    meeting = {
        "id": "m1",
        "space_id": None,
        "recurring_event_id": "rec1",
        "attendees": [{"email": "a@acme.com"}],
    }
    client = _FakeClient({
        # 1) _recurring_space_id resolves the series -> space "s1"
        # 2) recent done meetings in space "s1"
        # 3) recent done meetings in the recurring series
        "meetings": [
            [{"space_id": "s1"}],
            [{"id": "m0", "end_time": "2026-07-01"}],
            [{"id": "m-1", "end_time": "2026-06-24"}],
        ],
        "space_facts": [[
            {"kind": "decision", "text": "Ship on Fridays", "created_at": "2026-07-01"},
            {"kind": "open_question", "text": "Who owns billing?", "created_at": "2026-07-01"},
            {"kind": "risk", "text": "Vendor delay", "created_at": "2026-07-01"},
        ]],
        "summaries": [
            [{"tldr": "Discussed pricing.", "meeting_id": "m0"}],
            [{"tldr": "Kicked off the project.", "meeting_id": "m-1"}],
        ],
        "action_items": [[
            {"task": "Send contract", "owner": "a@acme.com", "done": False},
        ]],
    })

    brief = await build_meeting_brief(client, user_id="u1", meeting=meeting)

    assert "Ship on Fridays" in brief
    assert "Who owns billing?" in brief
    assert "Vendor delay" in brief
    assert "Send contract" in brief
    assert "Discussed pricing." in brief
    assert "Kicked off the project." in brief
    assert brief.startswith("Context from earlier related meetings")
    assert len(brief) <= 1500


async def test_returns_empty_when_no_space_no_series_no_data():
    meeting = {"id": "m1", "space_id": None, "recurring_event_id": None, "attendees": []}
    client = _FakeClient({})

    brief = await build_meeting_brief(client, user_id="u1", meeting=meeting)

    assert brief == ""


async def test_returns_empty_on_any_failure():
    meeting = {"id": "m1", "space_id": "s1", "recurring_event_id": None, "attendees": []}
    brief = await build_meeting_brief(_BoomClient(), user_id="u1", meeting=meeting)
    assert brief == ""


async def test_missing_client_or_user_id_or_meeting_short_circuits():
    assert await build_meeting_brief(None, user_id="u1", meeting={"id": "m1"}) == ""
    assert await build_meeting_brief(_FakeClient({}), user_id="", meeting={"id": "m1"}) == ""
    assert await build_meeting_brief(_FakeClient({}), user_id="u1", meeting={}) == ""
