from stewardai.agent.kb.extraction import extract_entities_and_facts


def _llm_yielding(text: str):
    class _LLM:
        async def complete(self, messages, *, system=None, temperature=0.4):
            yield text
    return _LLM()


async def test_parses_entities_tags_and_facts():
    payload = (
        '{"entities":[{"kind":"person","name":"Jane Doe","email":"jane@acme.com"},'
        '{"kind":"company","name":"Acme","email":null}],'
        '"tags":["pricing","renewal"],'
        '"facts":[{"kind":"decision","text":"Dropped tier-3 scope","source_line":4,"due":null},'
        '{"kind":"date","text":"Contract ends","source_line":6,"due":"2026-07-31"}]}'
    )
    out = await extract_entities_and_facts(_llm_yielding(payload), ["[Jane]: hi", "..."])
    assert out["entities"][0] == {"kind": "person", "name": "Jane Doe", "email": "jane@acme.com"}
    assert out["tags"] == ["pricing", "renewal"]
    assert out["facts"][1] == {"kind": "date", "text": "Contract ends", "source_line": 6, "due": "2026-07-31"}


async def test_strips_markdown_fences():
    payload = '```json\n{"entities":[],"tags":[],"facts":[]}\n```'
    out = await extract_entities_and_facts(_llm_yielding(payload), ["x"])
    assert out == {"entities": [], "tags": [], "facts": []}


async def test_malformed_json_returns_empty_shape():
    out = await extract_entities_and_facts(_llm_yielding("not json at all"), ["x"])
    assert out == {"entities": [], "tags": [], "facts": []}


async def test_empty_transcript_short_circuits_without_calling_llm():
    class _Boom:
        async def complete(self, *a, **k):
            raise AssertionError("LLM should not be called for empty transcript")
            yield ""  # pragma: no cover
    assert await extract_entities_and_facts(_Boom(), []) == {"entities": [], "tags": [], "facts": []}
