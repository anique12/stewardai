"""VexaClient.speak request-building test (httpx mocked via monkeypatch)."""

from __future__ import annotations

import httpx

from stewardai.bridge.vexa_client import VexaClient, extract_participant_images


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


def test_extract_participant_images_from_details_top_level():
    payload = {
        "participant_details": [
            {"name": "Jane Doe", "image": "https://img/jane.png"},
            {"name": "No Photo", "image": None},  # dropped: no image
        ]
    }
    assert extract_participant_images(payload) == {"Jane Doe": "https://img/jane.png"}


def test_extract_participant_images_nested_under_data():
    payload = {"data": {"participant_details": [{"name": "Sam", "image": "u"}]}}
    assert extract_participant_images(payload) == {"Sam": "u"}


def test_extract_participant_images_falls_back_to_speaker_events():
    # No participant_details -> reconstruct from raw speaker_events.
    payload = {
        "speaker_events": [
            {"participant_name": "Al", "participant_image": "a.png"},
            {"participant_name": "Al", "participant_image": "a2.png"},  # first wins
            {"participant_name": "Bo"},  # no image -> dropped
        ]
    }
    assert extract_participant_images(payload) == {"Al": "a.png"}


def test_extract_participant_images_empty_on_bad_shape():
    assert extract_participant_images(None) == {}
    assert extract_participant_images({"unrelated": 1}) == {}
    assert extract_participant_images({"participant_details": "nope"}) == {}


async def test_fetch_participant_images_returns_empty_on_http_error(monkeypatch):
    async def fake_get(self, url, *, headers=None, timeout=None):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    client = VexaClient("http://localhost:8056", api_key="k")
    assert await client.fetch_participant_images("google_meet", "abc") == {}


async def test_fetch_participant_images_parses_transcripts_response(monkeypatch):
    captured: dict = {}

    async def fake_get(self, url, *, headers=None, timeout=None):
        captured["url"] = url
        return _FakeResponse(
            {"participant_details": [{"name": "Jane Doe", "image": "https://img/jane.png"}]}
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    client = VexaClient("http://localhost:8056/", api_key="k")
    result = await client.fetch_participant_images("google_meet", "abc-defg-hij")

    assert result == {"Jane Doe": "https://img/jane.png"}
    assert captured["url"] == "http://localhost:8056/transcripts/google_meet/abc-defg-hij"
