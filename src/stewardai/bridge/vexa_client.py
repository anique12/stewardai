"""Thin Vexa control client.

``speak`` posts a TTS request to Vexa's bot speak endpoint. ``mute`` / ``unmute``
toggle a PulseAudio sink/source via ``pactl`` (no-op + warning when pactl is
absent, e.g. on Mac dev). LIGHT: only httpx (a base dep) + subprocess.
"""

from __future__ import annotations

import shutil
import subprocess

import httpx

from stewardai.common.logging import get_logger

_log = get_logger("bridge.vexa_client")


class VexaClient:
    """Client for Vexa's bot HTTP API."""

    def __init__(self, base_url: str, api_key: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    async def speak(
        self,
        platform: str,
        meeting_id: str,
        *,
        text: str | None = None,
        audio_url: str | None = None,
        audio_b64: str | None = None,
        fmt: str = "wav",
        sample_rate: int = 24000,
    ) -> dict:
        """POST a speak request to ``/bots/{platform}/{meeting_id}/speak``.

        Exactly one of ``text`` / ``audio_url`` / ``audio_b64`` should be set.
        Returns the parsed JSON response (or an empty dict if none).
        """
        url = f"{self.base_url}/bots/{platform}/{meeting_id}/speak"
        body: dict = {}
        if text is not None:
            body["text"] = text
        if audio_url is not None:
            body["audio_url"] = audio_url
        if audio_b64 is not None:
            body["audio_b64"] = audio_b64
            body["format"] = fmt
            body["sample_rate"] = sample_rate

        _log.info(
            "vexa_speak",
            platform=platform,
            meeting_id=meeting_id,
            mode="text" if text is not None else ("url" if audio_url else "b64"),
        )
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=body, headers=self._headers())
            resp.raise_for_status()
            try:
                return resp.json()
            except ValueError:
                return {}

    def mute(self, sink: str = "tts_sink") -> None:
        """Mute a PulseAudio sink (e.g. to silence the agent while a human speaks)."""
        self._pactl("set-sink-mute", sink, "1")

    def unmute(self, sink: str = "tts_sink") -> None:
        """Unmute a PulseAudio sink."""
        self._pactl("set-sink-mute", sink, "0")

    def mute_source(self, source: str) -> None:
        """Mute a PulseAudio source."""
        self._pactl("set-source-mute", source, "1")

    def unmute_source(self, source: str) -> None:
        """Unmute a PulseAudio source."""
        self._pactl("set-source-mute", source, "0")

    def _pactl(self, *args: str) -> None:
        if shutil.which("pactl") is None:
            _log.warning("pactl_missing_noop", args=list(args))
            return
        try:
            subprocess.run(["pactl", *args], check=True, capture_output=True)
        except subprocess.CalledProcessError as exc:
            _log.warning(
                "pactl_failed",
                args=list(args),
                returncode=exc.returncode,
                stderr=exc.stderr.decode(errors="replace") if exc.stderr else "",
            )
