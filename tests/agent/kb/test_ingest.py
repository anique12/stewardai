# tests/agent/kb/test_ingest.py
from unittest.mock import AsyncMock, patch

from stewardai.agent.kb.ingest import MeetingMeta, ingest_meeting_kb


def _llm_yielding(text):
    class _LLM:
        async def complete(self, messages, *, system=None, temperature=0.4):
            yield text
    return _LLM()


async def test_high_confidence_domain_files_into_existing_space():
    # filing_hints resolves the attendee domain to space s1 with strong weight.
    async def fake_hint_scores(client, *, user_id, attendee_emails, domains):
        return {"s1": 0.9}

    llm = _llm_yielding('{"entities":[{"kind":"company","name":"Acme","email":null}],'
                        '"tags":["pricing"],"facts":[{"kind":"decision","text":"D","source_line":1,"due":null}]}')
    client = object()
    with patch("stewardai.agent.kb.ingest.resolve_entities", AsyncMock(return_value=["e1"])), \
         patch("stewardai.agent.kb.ingest._hint_scores", side_effect=fake_hint_scores), \
         patch("stewardai.agent.kb.ingest.kbp") as kbp:
        kbp.create_space = AsyncMock(return_value="new")
        kbp.set_meeting_space = AsyncMock()
        kbp.link_meeting_entities = AsyncMock()
        kbp.set_meeting_tags = AsyncMock()
        kbp.insert_facts = AsyncMock(return_value=1)
        kbp.record_filing_hints = AsyncMock()
        await ingest_meeting_kb(client, llm, user_id="u1", meeting_id="m1",
                                transcript=["[a]: hi"],
                                meta=MeetingMeta(None, ["jane@acme.com"], "Acme sync"))
        kbp.set_meeting_space.assert_awaited_once()
        assert kbp.set_meeting_space.await_args.kwargs["space_id"] == "s1"
        assert kbp.set_meeting_space.await_args.kwargs["source"] == "auto"
        kbp.create_space.assert_not_awaited()
        kbp.insert_facts.assert_awaited_once()


async def test_new_thread_auto_creates_space_named_from_company():
    async def no_hints(client, *, user_id, attendee_emails, domains):
        return {}

    llm = _llm_yielding('{"entities":[{"kind":"company","name":"Globex","email":null}],'
                        '"tags":[],"facts":[]}')
    with patch("stewardai.agent.kb.ingest.resolve_entities", AsyncMock(return_value=["e1"])), \
         patch("stewardai.agent.kb.ingest._hint_scores", side_effect=no_hints), \
         patch("stewardai.agent.kb.ingest.kbp") as kbp:
        kbp.create_space = AsyncMock(return_value="s-new")
        kbp.set_meeting_space = AsyncMock()
        kbp.link_meeting_entities = AsyncMock()
        kbp.set_meeting_tags = AsyncMock()
        kbp.insert_facts = AsyncMock(return_value=0)
        kbp.record_filing_hints = AsyncMock()
        await ingest_meeting_kb(object(), llm, user_id="u1", meeting_id="m1",
                                transcript=["[a]: hi"],
                                meta=MeetingMeta(None, ["x@globex.io"], "Globex intro"))
        kbp.create_space.assert_awaited_once()
        assert kbp.create_space.await_args.kwargs["name"] == "Globex"
        assert kbp.set_meeting_space.await_args.kwargs["space_id"] == "s-new"
        assert kbp.set_meeting_space.await_args.kwargs["source"] == "auto_created"


async def test_low_confidence_leaves_meeting_unfiled_no_facts():
    async def no_hints(client, *, user_id, attendee_emails, domains):
        return {}

    llm = _llm_yielding('{"entities":[],"tags":[],"facts":[{"kind":"risk","text":"r","source_line":0,"due":null}]}')
    with patch("stewardai.agent.kb.ingest.resolve_entities", AsyncMock(return_value=[])), \
         patch("stewardai.agent.kb.ingest._hint_scores", side_effect=no_hints), \
         patch("stewardai.agent.kb.ingest.kbp") as kbp:
        kbp.create_space = AsyncMock()
        kbp.set_meeting_space = AsyncMock()
        kbp.link_meeting_entities = AsyncMock()
        kbp.set_meeting_tags = AsyncMock()
        kbp.insert_facts = AsyncMock(return_value=0)
        kbp.record_filing_hints = AsyncMock()
        await ingest_meeting_kb(object(), llm, user_id="u1", meeting_id="m1",
                                transcript=["[a]: hi"], meta=MeetingMeta(None, [], "Sync"))
        # no company + no hints -> unfiled: no space set, no facts, no hints recorded
        kbp.create_space.assert_not_awaited()
        assert kbp.set_meeting_space.await_args.kwargs["space_id"] is None
        assert kbp.set_meeting_space.await_args.kwargs["source"] == "unfiled"
        kbp.insert_facts.assert_not_awaited()
        kbp.record_filing_hints.assert_not_awaited()
