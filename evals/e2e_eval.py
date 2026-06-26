"""End-to-end eval on the stub pipeline.

Builds synthetic utterances (StubTTS tone framed at 20 ms, followed by trailing
silence), streams the frames through :class:`SilenceEndpointer`, and on each
detected end-of-turn runs STT -> LLM -> TTS. Measures:

  * endpointer behavior  — utterances detected vs. expected (one per synthetic
    utterance), plus the number of frames consumed before firing.
  * simulated voice-to-voice latency — STT + LLM-time-to-first-token +
    TTS-time-to-first-audio per turn (the compute path; capture/playback I/O is
    out of scope for the stub harness).

All stub backends: no heavy deps, no network.
"""

from __future__ import annotations

import time

from stewardai.common.audio import (
    BYTES_PER_FRAME,
    FRAME_MS,
    SAMPLES_PER_FRAME,
    Message,
    chunk_pcm,
)
from stewardai.config import Settings
from stewardai.factory import make_llm, make_stt, make_tts
from stewardai.turn.endpointer import SilenceEndpointer

from .stt_eval import _percentile

UTTERANCES: list[str] = [
    "Hello, are you there?",
    "What did we decide about the launch date?",
    "Thanks, that is all for now.",
]

_SILENCE_FRAME = b"\x00\x00" * SAMPLES_PER_FRAME


def _eval_settings(settings: Settings | None) -> Settings:
    if settings is not None:
        return settings
    return Settings(_env_file=None, stt_backend="stub", tts_backend="stub", llm_backend="stub")


async def _utterance_frames(tts, text: str) -> list[bytes]:
    """Render `text` to a list of 20 ms PCM frames (padded to full frame size)."""
    pcm = b"".join([frame.pcm async for frame in tts.synthesize(text)])
    frames: list[bytes] = []
    for chunk in chunk_pcm(pcm, BYTES_PER_FRAME):
        if len(chunk) < BYTES_PER_FRAME:
            chunk = chunk + b"\x00" * (BYTES_PER_FRAME - len(chunk))
        frames.append(chunk)
    return frames


async def run_e2e_eval(
    utterances: list[str] | None = None,
    settings: Settings | None = None,
    *,
    silence_ms: int = 600,
) -> dict:
    """Drive the stub pipeline; return aggregate v2v latency + endpointer metrics."""
    utterances = utterances if utterances is not None else UTTERANCES
    s = _eval_settings(settings)
    stt = make_stt(s)
    llm = make_llm(s)
    tts = make_tts(s)

    # Enough trailing silence to cross the endpointer's threshold, plus a margin.
    trailing_silence_frames = (silence_ms // FRAME_MS) + 3

    per_turn: list[dict] = []
    v2v_latencies: list[float] = []
    detected = 0
    try:
        for text in utterances:
            endpointer = SilenceEndpointer(silence_ms=silence_ms)
            speech_frames = await _utterance_frames(tts, text)
            stream = speech_frames + [_SILENCE_FRAME] * trailing_silence_frames

            utterance_pcm: bytes | None = None
            frames_to_eou = 0
            for frame in stream:
                frames_to_eou += 1
                result = endpointer.feed(frame)
                if result is not None:
                    utterance_pcm = result
                    break

            if utterance_pcm is None:
                per_turn.append({"text": text, "detected": False})
                continue

            detected += 1

            # STT (batch transcribe of the endpointed buffer)
            t_stt0 = time.perf_counter()
            transcript = await stt.transcribe(utterance_pcm)
            t_stt = (time.perf_counter() - t_stt0) * 1000.0

            # LLM time-to-first-token
            messages = [Message(role="user", content=transcript.text)]
            t_llm0 = time.perf_counter()
            llm_ttft: float | None = None
            reply_parts: list[str] = []
            async for delta in llm.complete(messages):
                if llm_ttft is None:
                    llm_ttft = (time.perf_counter() - t_llm0) * 1000.0
                reply_parts.append(delta)
            reply = "".join(reply_parts).strip()
            llm_ttft = llm_ttft if llm_ttft is not None else 0.0

            # TTS time-to-first-audio
            t_tts0 = time.perf_counter()
            tts_ttfa: float | None = None
            out_frames = 0
            async for _frame in tts.synthesize(reply):
                if tts_ttfa is None:
                    tts_ttfa = (time.perf_counter() - t_tts0) * 1000.0
                out_frames += 1
            tts_ttfa = tts_ttfa if tts_ttfa is not None else 0.0

            v2v = t_stt + llm_ttft + tts_ttfa
            v2v_latencies.append(v2v)
            per_turn.append(
                {
                    "text": text,
                    "detected": True,
                    "frames_to_eou": frames_to_eou,
                    "transcript": transcript.text,
                    "reply": reply,
                    "out_frames": out_frames,
                    "t_stt_ms": round(t_stt, 2),
                    "t_llm_ttft_ms": round(llm_ttft, 2),
                    "t_tts_ttfa_ms": round(tts_ttfa, 2),
                    "v2v_ms": round(v2v, 2),
                }
            )
    finally:
        await stt.aclose()
        await llm.aclose()
        await tts.aclose()

    return {
        "utterances": len(utterances),
        "detected": detected,
        "endpointer_recall": round(detected / len(utterances), 4) if utterances else 0.0,
        "p50_v2v_ms": round(_percentile(v2v_latencies, 50), 2),
        "per_turn": per_turn,
    }
