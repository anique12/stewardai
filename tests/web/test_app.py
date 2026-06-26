"""Web test-page smoke tests — boot the app with stub backends (no heavy deps)."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from tests.conftest import silence_frame, speech_frame


@pytest.fixture(scope="module")
def client():
    # Force all-stub backends so the suite never touches the network.
    os.environ["STT_BACKEND"] = "stub"
    os.environ["TTS_BACKEND"] = "stub"
    os.environ["LLM_BACKEND"] = "stub"
    from stewardai.config import get_settings

    get_settings.cache_clear()

    from web.app import app

    with TestClient(app) as c:  # triggers lifespan startup/shutdown
        yield c


def test_index_ok(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "StewardAI" in res.text


def test_pages_served(client):
    for path in ("/stt", "/tts", "/pipeline"):
        res = client.get(path)
        assert res.status_code == 200
        assert "<html" in res.text.lower()


def test_voices_contains_stub(client):
    res = client.get("/api/voices")
    assert res.status_code == 200
    voices = res.json()["voices"]
    assert "stub" in voices


def test_tts_returns_wav(client):
    res = client.post("/api/tts", json={"text": "hi", "voice": "stub"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    # WAV files begin with the RIFF magic.
    assert res.content[:4] == b"RIFF"


def test_ws_stt_yields_transcript(client):
    # Speech (loud frames) followed by >600 ms of silence triggers one utterance.
    speech = speech_frame()
    silence = silence_frame()
    with client.websocket_connect("/ws/stt") as ws:
        for _ in range(15):  # ~300 ms of speech (> min_speech_ms)
            ws.send_bytes(speech)
        for _ in range(35):  # ~700 ms of silence (> silence_ms)
            ws.send_bytes(silence)
        msg = ws.receive_json()
    assert msg["type"] == "transcript"
    assert msg["text"]  # stub returns a fixed non-empty transcript
    assert "t_stt_ms" in msg
