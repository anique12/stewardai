#!/usr/bin/env python3
"""Per-turn STT / LLM-ttft / TTS-ttfb from the multiplexer log — ONE LINE PER TURN.

Unlike meeting_stats.py (which prints averages), this prints every turn so you can
eyeball outliers:

    stt=451ms  llmttft=468ms  tts=145ms   -> first-audio ~1064ms

A "turn" = one spoken reply. It is delimited by each ``turn_stt`` event; the
``turn_llm`` (ttft) and the FIRST ``turn_tts`` (ttfb) that follow belong to it.
"first-audio" = stt + llmttft + tts = roughly how long after you stop talking
until the bot starts speaking.

Usage:
    python3 scripts/turn_timings.py [MEETING_ID] [LOG_PATH]

    MEETING_ID  Vexa int meeting id (e.g. 10). Omit = most recent meeting.
    LOG_PATH    defaults to /tmp/steward-mux.log
"""
from __future__ import annotations

import json
import sys

_EVENTS = ("turn_stt", "turn_llm", "turn_tts")


def main() -> None:
    want_mid = sys.argv[1] if len(sys.argv) > 1 else None
    path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/steward-mux.log"

    rows: list[dict] = []
    try:
        with open(path) as f:
            for line in f:
                if not any(f'"event": "{e}"' in line for e in _EVENTS):
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
    except FileNotFoundError:
        print(f"log not found: {path}")
        return

    if not rows:
        print(f"no turn events in {path}")
        return

    if want_mid is None:
        want_mid = str(rows[-1].get("meeting"))
        print(f"(meeting {want_mid} — most recent)\n")
    rows = [r for r in rows if str(r.get("meeting")) == str(want_mid)]
    if not rows:
        print(f"no turns for meeting {want_mid}")
        return

    # Group by turn_stt boundaries: a new turn_stt flushes the previous turn.
    turns: list[dict] = []
    cur: dict | None = None
    for r in rows:
        ev = r.get("event")
        if ev == "turn_stt":
            if cur is not None:
                turns.append(cur)
            cur = {"stt": r.get("duration_ms"), "llmttft": None, "tts": None}
        elif ev == "turn_llm":
            if cur is None:
                cur = {"stt": None, "llmttft": None, "tts": None}
            if cur["llmttft"] is None:
                cur["llmttft"] = r.get("ttft_ms")
        elif ev == "turn_tts":
            if cur is None:
                cur = {"stt": None, "llmttft": None, "tts": None}
            if cur["tts"] is None:  # first sentence's time-to-first-byte
                cur["tts"] = r.get("ttfb_ms")
    if cur is not None:
        turns.append(cur)

    def ms(v) -> str:
        return f"{int(v)}ms" if isinstance(v, (int, float)) else "-"

    print(f"meeting {want_mid}: {len(turns)} turns\n")
    for i, t in enumerate(turns, 1):
        total = sum(v for v in (t["stt"], t["llmttft"], t["tts"]) if isinstance(v, (int, float)))
        flag = "  <-- SLOW" if total > 3000 else ""
        print(f"  {i:>3}. stt={ms(t['stt']):>7}  llmttft={ms(t['llmttft']):>7}  "
              f"tts={ms(t['tts']):>7}   first-audio~{total}ms{flag}")


if __name__ == "__main__":
    main()
