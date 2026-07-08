# tests/agent/kb/test_chunking.py
from stewardai.agent.kb.chunking import build_chunks


def test_summary_and_facts_become_chunks_with_provenance():
    chunks = build_chunks(
        transcript=[],
        summary_tldr="We agreed to ship Friday.",
        facts=[
            {"kind": "decision", "text": "Ship Friday", "source_line": 3},
            {"kind": "risk", "text": "Vendor may slip", "source_line": None},
            {"kind": "bogus", "text": "ignored", "source_line": 1},  # invalid kind → skipped
            {"kind": "date", "text": "", "source_line": 2},          # empty text → skipped
        ],
    )
    kinds = [(c["kind"], c["text"], c["source_seq"]) for c in chunks]
    assert ("summary", "We agreed to ship Friday.", None) in kinds
    assert ("fact", "Ship Friday", 3) in kinds
    assert ("fact", "Vendor may slip", None) in kinds
    assert all(c["text"] for c in chunks)                 # no empty-text chunks
    assert not any(c["text"] == "ignored" for c in chunks)  # invalid kind dropped


def test_transcript_windows_group_consecutive_lines_and_carry_first_seq():
    # Lines long enough that ~1500-char windows split into two groups.
    transcript = [("x" * 400) for _ in range(8)]  # 8 * ~401 chars ≈ 3200 chars
    chunks = [c for c in build_chunks(transcript, None, []) if c["kind"] == "segment"]
    assert len(chunks) >= 2                 # split into multiple windows
    assert chunks[0]["source_seq"] == 0     # first window starts at line 0
    assert chunks[1]["source_seq"] > 0      # second window starts later
    # windows respect the cap (+ one overflow line)
    assert all(len(c["text"]) <= 1600 for c in chunks)


def test_empty_inputs_yield_no_chunks():
    assert build_chunks([], None, []) == []
    assert build_chunks([], "", []) == []   # empty summary string is not a chunk
