"""VexaClient.speak request-building test (httpx mocked via monkeypatch)."""

from __future__ import annotations

import httpx

from stewardai.bridge.vexa_client import VexaClient


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


async def test_speak_posts_text_to_correct_url(monkeypatch):
    captured: dict = {}

    async def fake_post(self, url, *, json=None, headers=None):  # noqa: A002 - mirror httpx
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return _FakeResponse({"ok": True})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = VexaClient("https://vexa.example.com/api/", api_key="secret")
    result = await client.speak("google_meet", "abc-defg-hij", text="Hello team")

    assert result == {"ok": True}
    assert captured["url"] == (
        "https://vexa.example.com/api/bots/google_meet/abc-defg-hij/speak"
    )
    assert captured["json"]["text"] == "Hello team"
    assert captured["headers"]["X-API-Key"] == "secret"


async def test_speak_audio_b64_includes_format_and_rate(monkeypatch):
    captured: dict = {}

    async def fake_post(self, url, *, json=None, headers=None):  # noqa: A002
        captured["json"] = json
        return _FakeResponse({})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = VexaClient("http://localhost:8000")
    await client.speak(
        "zoom", "12345", audio_b64="AAAA", fmt="wav", sample_rate=24000
    )

    assert captured["json"]["audio_b64"] == "AAAA"
    assert captured["json"]["format"] == "wav"
    assert captured["json"]["sample_rate"] == 24000
