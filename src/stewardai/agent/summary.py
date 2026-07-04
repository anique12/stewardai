"""Generate a meeting summary + action items from a speaker-labeled transcript."""
from __future__ import annotations

import json
import os

from stewardai.common.audio import Message
from stewardai.common.logging import get_logger
from stewardai.observability.usage_context import usage_scope

_log = get_logger("agent.summary")

_SUMMARY_SYSTEM = (
    "You summarize a meeting from a speaker-labeled transcript (lines look like "
    "'[Anique]: ...'). Respond with ONLY a JSON object, no prose, with keys: "
    "tldr (string, 2-3 sentences), decisions (array of strings), action_items "
    "(array of {owner, task, due, source_line} where due may be null and "
    "source_line is the 0-based index of the transcript line that produced the "
    "item — an integer shown as 'N:' at the start of each line — or null), "
    "discrepancies (array of strings describing contradictions raised). "
    "Attribute action items to the speaker responsible by name."
)


async def generate_summary(
    llm, transcript: list[str], *, user_id: str | None = None  # noqa: ANN001
) -> dict:
    body = (
        "\n".join(f"{i}: {line}" for i, line in enumerate(transcript))
        if transcript
        else "(no transcript captured)"
    )
    chunks = []
    with usage_scope(feature="summary", user_id=user_id):
        async for delta in llm.complete(
            [Message(role="user", content=body)], system=_SUMMARY_SYSTEM, temperature=0.2
        ):
            if delta:
                chunks.append(delta)
    raw = "".join(chunks).strip()
    if raw.startswith("```"):  # strip markdown fences if the model adds them
        raw = raw.strip("`")
        idx = raw.find("{")
        raw = raw[idx:] if idx != -1 else raw
    try:
        return json.loads(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        _log.warning("summary_parse_failed", error=str(exc))
        return {"tldr": raw[:500], "decisions": [], "action_items": [], "discrepancies": []}


def append_transcript_line(path: str, line: str) -> None:
    """Append one labeled transcript line to ``path`` (created if needed).

    Crash-safe persistence: the full transcript lands on disk turn-by-turn, so it
    survives even if the agent stops before any summary is generated. Best-effort
    at the call site — callers wrap this in ``contextlib.suppress``.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a") as f:
        f.write(line.rstrip("\n") + "\n")


def write_summary(meeting_id: str, summary: dict, out_dir: str = "evals/out") -> tuple[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    js = os.path.join(out_dir, f"meeting-{meeting_id}-summary.json")
    md = os.path.join(out_dir, f"meeting-{meeting_id}-summary.md")
    with open(js, "w") as f:
        json.dump(summary, f, indent=2)
    lines = [
        "# Meeting Summary",
        f"TL;DR: {summary.get('tldr', '')}",
        "\n## Decisions",
        *[f"- {d}" for d in summary.get("decisions", [])],
        "\n## Action items",
        *[
            f"- {a.get('owner')} → {a.get('task')}"
            + (f" ({a['due']})" if a.get("due") else "")
            for a in summary.get("action_items", [])
        ],
        "\n## Open questions / discrepancies",
        *[f"- {d}" for d in summary.get("discrepancies", [])],
    ]
    with open(md, "w") as f:
        f.write("\n".join(lines) + "\n")
    _log.info("summary_written", meeting=meeting_id, md=md, json=js)
    return md, js
