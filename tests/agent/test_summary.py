import json

import pytest

from stewardai.agent.summary import generate_summary, write_summary


class _FakeLLM:
    name = "fake"
    async def complete(self, messages, *, system=None, temperature=0.4):
        yield json.dumps({
            "tldr": "Planned v2 launch.",
            "decisions": ["Launch moved to Monday"],
            "action_items": [{"owner": "Sarah", "task": "test payments migration", "due": "Wed"}],
            "discrepancies": ["Friday vs Monday launch date"],
        })


@pytest.mark.asyncio
async def test_generate_summary_parses_json():
    out = await generate_summary(_FakeLLM(), ["[Anique]: ship friday", "[Sarah]: I thought monday"])
    assert out["action_items"][0]["owner"] == "Sarah"
    assert "Monday" in out["decisions"][0]


def test_write_summary_creates_files(tmp_path):
    summary = {"tldr": "x", "decisions": ["d"], "action_items": [], "discrepancies": []}
    md, js = write_summary("99", summary, out_dir=str(tmp_path))
    assert md.endswith("meeting-99-summary.md") and js.endswith("meeting-99-summary.json")
    assert "## Action items" in open(md).read()
