from stewardai.agent.chat.tools import build_read_tools


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
