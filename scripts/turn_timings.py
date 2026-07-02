#!/usr/bin/env python3
"""Per-turn latency from the multiplexer log — ONE LINE PER SPOKEN REPLY.

Unlike meeting_stats.py (which prints averages), this prints every turn so you can
eyeball outliers:

    3. stt=451ms  eou=180ms  llmttft=468ms  tts=145ms   total=793ms

It reads the combined ``turn_latency`` event the agent emits once per reply (fields
stt_ms / eou_ms / llm_ttft_ms / tts_ttfb_ms / reply_total_ms). The agent also emits a
follow-up ``turn_latency`` for each extra sentence of a reply (those have no llm/stt),
so we keep only the real turn-start rows (llm_ttft_ms present).

  stt     = whisper transcription time
  eou     = end-of-utterance wait (turn detection)
  llmttft = LLM time-to-first-token
  tts     = TTS time-to-first-byte (first sentence)
  total   = reply_total_ms = eou + llmttft + tts = stop-talking -> bot-starts-talking

Usage:
    python3 scripts/turn_timings.py [MEETING_ID] [LOG_PATH]

    MEETING_ID  Vexa int meeting id (e.g. 10). Omit = most recent meeting.
    LOG_PATH    defaults to /tmp/steward-mux.log
"""
from __future__ import annotations

import json
import sys


def main() -> None:
    want_mid = sys.argv[1] if len(sys.argv) > 1 else None
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

    # Keep only real turn-starts (a full reply row has the LLM timing). The extra
    # per-sentence rows have llm_ttft_ms = None — drop them.
    rows = [r for r in rows if r.get("llm_ttft_ms") is not None]
    if not rows:
        print(f"no complete turns (turn_latency) in {path}")
        return

    if want_mid is None:
        want_mid = str(rows[-1].get("meeting"))
        print(f"(meeting {want_mid} — most recent)\n")
    rows = [r for r in rows if str(r.get("meeting")) == str(want_mid)]
    if not rows:
        print(f"no turns for meeting {want_mid}")
        return

    def ms(v) -> str:
        return f"{int(v)}ms" if isinstance(v, (int, float)) else "-"

    print(f"meeting {want_mid}: {len(rows)} turns\n")
    for i, r in enumerate(rows, 1):
        total = r.get("reply_total_ms")
        flag = "  <-- SLOW" if isinstance(total, (int, float)) and total > 3000 else ""
        print(
            f"  {i:>3}. stt={ms(r.get('stt_ms')):>7}  eou={ms(r.get('eou_ms')):>7}  "
            f"llmttft={ms(r.get('llm_ttft_ms')):>7}  tts={ms(r.get('tts_ttfb_ms')):>7}   "
            f"total={ms(total)}{flag}"
        )


if __name__ == "__main__":
    main()
