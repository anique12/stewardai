#!/usr/bin/env python3
"""Per-meeting STT/EOU/LLM/TTS latency stats from the multiplexer log.

Reads the ``turn_latency`` events (one per spoken reply) and prints avg / p95 / max
for each pipeline stage.

Usage:
    python3 scripts/meeting_stats.py [MEETING_ID] [LOG_PATH]

    MEETING_ID  Vexa int meeting id, e.g. 157. Omit to use the most recent meeting.
    LOG_PATH    defaults to /tmp/steward-mux.log
"""
from __future__ import annotations

import json
import sys

_STAGES = [
    ("stt_ms", "STT"),
    ("eou_ms", "EOU-wait"),
    ("llm_ttft_ms", "LLM-ttft"),
    ("tts_ttfb_ms", "TTS-ttfb"),
    ("reply_total_ms", "TOTAL"),
]


def main() -> None:
    mid = sys.argv[1] if len(sys.argv) > 1 else None
    path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/steward-mux.log"

    rows: list[dict] = []
    try:
        with open(path) as f:
            for line in f:
                if '"event": "turn_latency"' not in line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
    except FileNotFoundError:
        print(f"log not found: {path}")
        return

    if not rows:
        print(f"no turn_latency events in {path}")
        return

    if mid is None:
        mid = str(rows[-1].get("meeting"))
        print(f"(no meeting id given — using most recent: {mid})")

    rows = [d for d in rows if str(d.get("meeting")) == str(mid)]
    if not rows:
        print(f"no replies logged for meeting {mid}")
        return

    def stat(key: str) -> str:
        vals = sorted(d[key] for d in rows if isinstance(d.get(key), (int, float)))
        if not vals:
            return "n/a"
        p95 = vals[min(len(vals) - 1, int(len(vals) * 0.95))]
        return f"avg={round(sum(vals) / len(vals))}ms  p95={p95}ms  max={max(vals)}ms"

    print(f"meeting {mid}: {len(rows)} replies")
    for key, label in _STAGES:
        print(f"  {label:9} {stat(key)}")


if __name__ == "__main__":
    main()
