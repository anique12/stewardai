from stewardai.agent.chat.tools import CiteRegistry, build_read_tools


class _Resp:
    def __init__(self, d):
        self.data = d


class _Q:
    def __init__(s, rows):
        s.rows = rows

    def select(s, *a, **k):
        return s

    def eq(s, *a, **k):
        return s

    def order(s, *a, **k):
        return s

    def limit(s, *a, **k):
        return s

    async def execute(s):
        return _Resp(s.rows)


class _Client:
    def __init__(s, rows):
        s.rows = rows

    def table(s, name):
        return _Q(s.rows)


class _LLM:
    async def aembed(self, texts, *, query=False):
        return [[0.0] * 768 for _ in texts]


async def test_kb_search_returns_provenance(monkeypatch):
    import stewardai.agent.chat.tools as T

    async def fake_retrieve(client, llm, *, user_id, query, space_id=None, k=8):
        return [
            {
                "text": "ship July 17",
                "meeting_id": "m1",
                "source_seq": 3,
                "kind": "fact",
                "similarity": 0.9,
            }
        ]

    monkeypatch.setattr(T, "retrieve", fake_retrieve)
    tools = build_read_tools(_Client([]), _LLM(), user_id="u1")
    names = {t.name for t in tools}
    assert {"kb_search", "list_spaces", "list_meetings", "lookup_entity"} <= names
    kb = next(t for t in tools if t.name == "kb_search")
    out = await kb.ainvoke({"query": "when ship?"})
    assert out["passages"][0]["meeting_id"] == "m1" and out["passages"][0]["n"] == 1


async def test_kb_search_numbers_are_turn_global_across_shared_registry(monkeypatch):
    """Two kb_search calls sharing one cite_registry must NOT both restart
    numbering at n=1 -- the model sees these numbers directly and later cites
    [n] in its answer, so a per-call reset makes [n] ambiguous/wrong once a
    turn makes more than one kb_search call. Numbers must continue across
    calls, and a repeated (meeting_id, source_seq) must reuse its first n."""
    import stewardai.agent.chat.tools as T

    calls: list[list[dict]] = [
        [
            {"text": "a1", "meeting_id": "m1", "source_seq": 1, "kind": "fact"},
            {"text": "a2", "meeting_id": "m1", "source_seq": 2, "kind": "fact"},
        ],
        [
            {"text": "a1 again", "meeting_id": "m1", "source_seq": 1, "kind": "fact"},
            {"text": "b1", "meeting_id": "m2", "source_seq": 5, "kind": "fact"},
        ],
    ]

    async def fake_retrieve(client, llm, *, user_id, query, space_id=None, k=8):
        return calls.pop(0)

    monkeypatch.setattr(T, "retrieve", fake_retrieve)
    registry = CiteRegistry()
    tools = build_read_tools(_Client([]), _LLM(), user_id="u1", cite_registry=registry)
    kb = next(t for t in tools if t.name == "kb_search")

    out1 = await kb.ainvoke({"query": "first"})
    assert [p["n"] for p in out1["passages"]] == [1, 2]

    out2 = await kb.ainvoke({"query": "second"})
    # The repeat of (m1, 1) reuses n=1; the new (m2, 5) continues at n=3.
    assert [p["n"] for p in out2["passages"]] == [1, 3]


async def test_kb_search_falls_back_to_scope_space_id(monkeypatch):
    """When the session is scoped to a space (composer's scope selector), the
    space filter must apply even if the model's kb_search call omits/forgets
    its own space_id -- see build_read_tools's scope_space_id kwarg."""
    import stewardai.agent.chat.tools as T

    captured: dict = {}

    async def fake_retrieve(client, llm, *, user_id, query, space_id=None, k=8):
        captured["space_id"] = space_id
        return []

    monkeypatch.setattr(T, "retrieve", fake_retrieve)
    tools = build_read_tools(_Client([]), _LLM(), user_id="u1", scope_space_id="s-scoped")
    kb = next(t for t in tools if t.name == "kb_search")

    await kb.ainvoke({"query": "anything"})
    assert captured["space_id"] == "s-scoped"

    # An explicit space_id from the model still wins over the session scope.
    await kb.ainvoke({"query": "anything", "space_id": "s-explicit"})
    assert captured["space_id"] == "s-explicit"


async def test_list_spaces_and_meetings_are_user_scoped():
    rows = [{"id": "s1", "name": "Acme", "kind": "client", "status": "active"}]
    tools = build_read_tools(_Client(rows), _LLM(), user_id="u1")
    list_spaces = next(t for t in tools if t.name == "list_spaces")
    out = await list_spaces.ainvoke({})
    assert out["spaces"] == rows

    meeting_rows = [
        {
            "id": "m1",
            "title": "Kickoff",
            "start_time": "2026-07-01",
            "space_id": "s1",
            "bot_status": "done",
        }
    ]
    tools2 = build_read_tools(_Client(meeting_rows), _LLM(), user_id="u1")
    list_meetings = next(t for t in tools2 if t.name == "list_meetings")
    out2 = await list_meetings.ainvoke({})
    assert out2["meetings"] == meeting_rows


async def test_get_meeting_flags_not_started_and_returns_invitees():
    """A meeting that hasn't run must come back as lifecycle='not_started' with
    its calendar people surfaced as `invitees` (not attendance) -- this is what
    stops the agent saying people "were in" a meeting that hasn't happened."""
    rows = [
        {
            "id": "m1",
            "title": "Daily Upwork proposals",
            "start_time": "2099-01-01T09:00:00Z",  # firmly in the future
            "bot_status": "scheduled",
            "attendees": [
                {"name": "Humayun", "email": "h@x.com", "responseStatus": "accepted"},
                {"name": "Zeshan", "email": "z@x.com", "responseStatus": "needsAction"},
            ],
        }
    ]
    tools = build_read_tools(_Client(rows), _LLM(), user_id="u1")
    assert "get_meeting" in {t.name for t in tools}
    get_meeting = next(t for t in tools if t.name == "get_meeting")
    out = await get_meeting.ainvoke({"meeting_id": "m1"})
    m = out["meeting"]
    assert m["lifecycle"] == "not_started"
    assert [i["name"] for i in m["invitees"]] == ["Humayun", "Zeshan"]
    # `invitees` is the only participant field -- there is no "attended" list for
    # a meeting that has not occurred.
    assert "attendees" not in m


async def test_get_meeting_missing_returns_none():
    tools = build_read_tools(_Client([]), _LLM(), user_id="u1")
    get_meeting = next(t for t in tools if t.name == "get_meeting")
    out = await get_meeting.ainvoke({"meeting_id": "nope"})
    assert out["meeting"] is None


async def test_lookup_entity_filters_by_name_substring():
    rows = [
        {
            "id": "e1",
            "kind": "person",
            "name": "Jane Doe",
            "email": "jane@acme.com",
            "domain": None,
        },
        {
            "id": "e2",
            "kind": "company",
            "name": "Acme Corp",
            "email": None,
            "domain": "acme.com",
        },
    ]
    tools = build_read_tools(_Client(rows), _LLM(), user_id="u1")
    lookup_entity = next(t for t in tools if t.name == "lookup_entity")
    out = await lookup_entity.ainvoke({"name": "acme"})
    names = {e["name"] for e in out["entities"]}
    assert names == {"Acme Corp"}
