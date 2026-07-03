# src/stewardai/agent/kb/chunking.py
"""Pure: turn a meeting's transcript + summary + facts into embeddable chunks.

Each chunk is a small dict {kind, text, source_seq}. Transcript lines are grouped
into ~1500-char windows so we embed coherent passages (not one utterance each),
bounding embedding cost while keeping provenance (source_seq = the window's first
transcript index). Summary and facts become their own chunks. No I/O, no LLM.
"""
from __future__ import annotations

_WINDOW_CHARS = 1500
_FACT_KINDS = frozenset({"action_item", "decision", "date", "risk", "open_question"})


def _transcript_windows(transcript: list[str]) -> list[dict]:
    out: list[dict] = []
    buf: list[str] = []
    start = 0
    size = 0
    for i, line in enumerate(transcript):
        line = (line or "").strip()
        if not line:
            continue
        if buf and size + len(line) > _WINDOW_CHARS:
            out.append({"kind": "segment", "text": "\n".join(buf), "source_seq": start})
            buf, size, start = [], 0, i
        if not buf:
            start = i
        buf.append(line)
        size += len(line)
    if buf:
        out.append({"kind": "segment", "text": "\n".join(buf), "source_seq": start})
    return out


def _coerce_seq(value) -> int | None:  # noqa: ANN001
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def build_chunks(transcript: list[str], summary_tldr: str | None,
                 facts: list[dict]) -> list[dict]:
    chunks: list[dict] = list(_transcript_windows(transcript or []))
    if summary_tldr and summary_tldr.strip():
        chunks.append({"kind": "summary", "text": summary_tldr.strip(), "source_seq": None})
    for f in facts or []:
        if f.get("kind") in _FACT_KINDS and (f.get("text") or "").strip():
            chunks.append({
                "kind": "fact",
                "text": f["text"].strip(),
                "source_seq": _coerce_seq(f.get("source_line")),
            })
    return chunks
