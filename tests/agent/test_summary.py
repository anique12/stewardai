import json

import pytest

from stewardai.agent.summary import append_transcript_line, generate_summary, write_summary


def test_append_transcript_line_persists_each_line(tmp_path):
    p = str(tmp_path / "sub" / "meeting-x-transcript.txt")
    append_transcript_line(p, "[Sarah]: ship friday")
    append_transcript_line(p, "[Marcus]: error states\n")  # trailing newline normalized
    assert open(p).read() == "[Sarah]: ship friday\n[Marcus]: error states\n"


class _FakeLLM:
    name = "fake"
    async def complete(self, messages, *, system=None, temperature=0.4):
        yield json.dumps({
            "tldr": "Planned v2 launch.",
            "decisions": ["Launch moved to Monday"],
            "action_items": [{"owner": "Sarah", "task": "test payments migration", "due": "Wed"}],
            "discrepancies": ["Friday vs Monday launch date"],
        })


class _BadLLM:
    name = "bad"
    async def complete(self, messages, *, system=None, temperature=0.4):
        yield "not json at all"


@pytest.mark.asyncio
async def test_generate_summary_parses_json():
    out = await generate_summary(_FakeLLM(), ["[Anique]: ship friday", "[Sarah]: I thought monday"])
    assert out["action_items"][0]["owner"] == "Sarah"
    assert "Monday" in out["decisions"][0]


@pytest.mark.asyncio
async def test_generate_summary_degrades_on_bad_json():
    out = await generate_summary(_BadLLM(), ["[Anique]: hi"])
    assert out["tldr"] == "not json at all"
    assert out["decisions"] == []
    assert out["action_items"] == []
    assert out["discrepancies"] == []


def test_write_summary_creates_files(tmp_path):
    summary = {"tldr": "x", "decisions": ["d"], "action_items": [], "discrepancies": []}
    md, js = write_summary("99", summary, out_dir=str(tmp_path))
    assert md.endswith("meeting-99-summary.md") and js.endswith("meeting-99-summary.json")
    assert "## Action items" in open(md).read()


def test_summary_system_requests_source_line():
    from stewardai.agent.summary import _SUMMARY_SYSTEM
    assert "source_line" in _SUMMARY_SYSTEM


class _CapturingLLM:
    name = "capturing"

    def __init__(self):
        self.received = None

    async def complete(self, messages, *, system=None, temperature=0.4):
        self.received = messages
        yield json.dumps(
            {"tldr": "t", "decisions": [], "action_items": [], "discrepancies": []}
        )


@pytest.mark.asyncio
async def test_generate_summary_numbers_transcript_lines():
    llm = _CapturingLLM()
    await generate_summary(llm, ["[Anique]: hi", "[Sarah]: yo"])
    assert llm.received[0].content == "0: [Anique]: hi\n1: [Sarah]: yo"
