#!/usr/bin/env python3
"""Per-turn latency breakdown from a steward agent log.

Reads the turn_eou / turn_stt / turn_llm / turn_tts metric lines the meeting
runner emits and prints one row per real turn (a turn = a response, i.e. it has
an LLM call): the endpointer wait, STT transcription delay, LLM time-to-first-
token, TTS time-to-first-audio, and an approximate end-of-speech -> first-audio
total. A summary line shows the LLM ttft spread, which is the variable part.

Usage:
  python scripts/turn_latency.py [LOGFILE] [N]
    LOGFILE  default /tmp/steward-agent.log
    N        show the last N turns (default 20)
"""
from __future__ import annotations

import json
import sys


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/steward-agent.log"
    last_n = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    turns: list[dict] = []
    cur: dict | None = None

    def flush() -> None:
        nonlocal cur
        if cur and cur.get("llm") is not None:  # only real turns (a response happened)
            turns.append(cur)
        cur = None

    try:
        fh = open(path)  # noqa: SIM115
    except FileNotFoundError:
        print(f"no such log: {path}")
        return
    with fh:
        for raw in fh:
            raw = raw.strip()
            if not raw.startswith("{"):
                continue
            try:
                e = json.loads(raw)
            except ValueError:
                continue
            ev = e.get("event")
            if ev == "turn_eou":
                flush()
                cur = {
                    "ts": e.get("timestamp", ""),
                    "eou": e.get("eou_delay_ms"),
                    "trans": e.get("transcription_delay_ms"),
                }
            elif ev == "turn_llm":
                cur = cur or {"ts": e.get("timestamp", "")}
                cur["llm"] = e.get("ttft_ms")
            elif ev == "turn_tts":
                cur = cur or {"ts": e.get("timestamp", "")}
                cur["tts"] = e.get("ttfb_ms")
                flush()
    flush()

    def cell(v) -> str:  # noqa: ANN001
        return f"{v:>7}" if isinstance(v, int) else "      -"

    rows = turns[-last_n:]
    print(f"{'time':<9} {'eou_wait':>8} {'stt':>7} {'llm_ttft':>8} {'tts_ttfb':>8} {'~resp':>7}")
    print("-" * 54)
    for t in rows:
        # perceived response latency ~= endpointer wait + LLM first token + TTS first audio
        total = sum(t[k] for k in ("eou", "llm", "tts") if isinstance(t.get(k), int))
        ts = (t.get("ts") or "")[11:19]
        print(f"{ts:<9} {cell(t.get('eou'))} {cell(t.get('trans'))} "
              f"{cell(t.get('llm'))} {cell(t.get('tts'))} {total:>5}ms")
    if not rows:
        print("(no completed turns yet — talk to the agent, then re-run)")
        return
    llms = [t["llm"] for t in rows if isinstance(t.get("llm"), int)]
    if llms:
        ordered = sorted(llms)
        print("-" * 54)
        print(f"llm_ttft over {len(llms)} turns:  min={min(llms)}ms  "
              f"median={ordered[len(ordered) // 2]}ms  max={max(llms)}ms  "
              f"(this is the variable part)")


if __name__ == "__main__":
    main()
