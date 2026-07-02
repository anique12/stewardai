#!/usr/bin/env python3
"""Synthesize the scripted-meeting lines with Deepgram Aura TTS, distinct voice
per participant, one WAV per line (ordered) so they can be played into a live
Meet test. Reads DEEPGRAM_API_KEY from the env / .env. Never prints the key.

Usage: python scripts/generate_meeting_audio.py
Output: evals/meetings/audio/NN_speaker.wav  (+ a per-speaker/ subdir)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

from stewardai.config import get_settings

# Aura-1 voices (one distinct voice per participant).
VOICE = {
    "sarah": "aura-asteria-en",   # female, lead
    "marcus": "aura-orion-en",    # male
    "priya": "aura-luna-en",      # female (distinct from Sarah)
}

# The script, in spoken order. (Steward's interjection/summary are produced live
# by the agent, so they are NOT synthesized here.)
LINES: list[tuple[str, str]] = [
    ("sarah", "Morning everyone. Let's lock the v2 launch plan. I'm thinking we ship Friday."),
    ("marcus", "Frontend checkout is basically done. I still need to wire the new error states."),
    ("priya", "I'll get the final checkout mockups over to Marcus by tomorrow morning."),
    ("marcus", "Perfect — once I have those I can finish the error states by Thursday."),
    ("priya", "And the payments migration on the backend still needs testing. I'll have that done by Wednesday."),
    ("sarah", "Great. So we're good for a Friday launch."),
    ("priya", "Wait — didn't we agree last week on Monday, to give QA the weekend?"),
    ("sarah", "Good catch. Let's confirm Monday then. Priya, can you also draft the launch announcement?"),
    ("priya", "Sure, I'll have the announcement drafted by Friday."),
    ("sarah", "Steward, can you summarize what we decided and the action items?"),
]

OUT_DIR = "evals/meetings/audio"


def synth(text: str, voice: str, api_key: str) -> bytes:
    url = (
        f"https://api.deepgram.com/v1/speak?model={voice}"
        "&encoding=linear16&container=wav&sample_rate=24000"
    )
    req = urllib.request.Request(  # noqa: S310 - fixed https host
        url,
        data=json.dumps({"text": text}).encode(),
        headers={"Authorization": f"Token {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        return resp.read()


def main() -> None:
    key = get_settings().deepgram_api_key or os.environ.get("DEEPGRAM_API_KEY")
    if not key:
        print("ERROR: DEEPGRAM_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    os.makedirs(OUT_DIR, exist_ok=True)
    for spk in VOICE:
        os.makedirs(os.path.join(OUT_DIR, spk), exist_ok=True)
    for i, (spk, text) in enumerate(LINES, start=1):
        audio = synth(text, VOICE[spk], key)
        flat = os.path.join(OUT_DIR, f"{i:02d}_{spk}.wav")
        per = os.path.join(OUT_DIR, spk, f"{i:02d}.wav")
        for p in (flat, per):
            with open(p, "wb") as f:
                f.write(audio)
        print(f"{i:02d} {spk:<6} {VOICE[spk]:<16} {len(audio):>7}B -> {flat}")
    print(f"\nDone: {len(LINES)} lines in {OUT_DIR}/ (flat ordered + per-speaker subdirs).")


if __name__ == "__main__":
    main()
