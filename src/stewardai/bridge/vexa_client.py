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


def extract_participant_images(payload: object) -> dict[str, str]:
    """Pull a ``{display_name: image_url}`` map out of a Vexa ``/transcripts``
    response. Reads the fork's additive ``participant_details`` list
    (``[{"name","image"}]``); if that's absent (older/upstream Vexa build) it
    falls back to reconstructing the map from the raw ``speaker_events``
    (``{"participant_name","participant_image"}``) the bot persists. Both are
    looked for at the top level AND nested under ``data`` (the transcripts proxy
    shape varies). Only entries with a truthy image are returned. Pure + never
    raises: any unexpected shape yields ``{}``."""
    out: dict[str, str] = {}
    if not isinstance(payload, dict):
        return out
    # The meeting fields may sit at the top level or under a nested "data".
    scopes = [payload]
    nested = payload.get("data")
    if isinstance(nested, dict):
        scopes.append(nested)

    for scope in scopes:
        details = scope.get("participant_details")
        if isinstance(details, list):
            for d in details:
                if not isinstance(d, dict):
                    continue
                name = (d.get("name") or "").strip()
                image = d.get("image")
                if name and image and name not in out:
                    out[name] = str(image)
    if out:
        return out

    # Fallback: rebuild from raw speaker_events when participant_details is absent.
    for scope in scopes:
        events = scope.get("speaker_events")
        if isinstance(events, list):
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                name = (ev.get("participant_name") or "").strip()
                image = ev.get("participant_image")
                if name and image and name not in out:
                    out[name] = str(image)
    return out


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

    async def fetch_participant_images(
        self, platform: str, native_meeting_id: str
    ) -> dict[str, str]:
        """Best-effort ``{display_name: image_url}`` for a meeting's participants,
        read from ``GET /transcripts/{platform}/{native_meeting_id}``. Returns an
        empty dict on any error OR when the running Vexa build doesn't expose
        participant images yet (upstream/older bot) — callers treat "" as "no
        real photo, keep the existing fallback". Never raises."""
        url = f"{self.base_url}/transcripts/{platform}/{native_meeting_id}"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, headers=self._headers(), timeout=8.0)
                resp.raise_for_status()
                payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            _log.debug(
                "vexa_participant_images_unavailable",
                platform=platform,
                native_meeting_id=native_meeting_id,
                error=str(exc),
            )
            return {}
        images = extract_participant_images(payload)
        _log.info(
            "vexa_participant_images_fetched",
            platform=platform,
            native_meeting_id=native_meeting_id,
            count=len(images),
        )
        return images

    async def list_bots(self) -> list[dict]:
        """Recent meetings/bots for this API key, from ``GET /bots``.

        Each item carries at least ``native_meeting_id`` and ``status`` (Vexa's
        MeetingStatus). Used to reconcile our meetings.bot_status against Vexa's
        authoritative lifecycle (a bot that left / was left alone shows a terminal
        status there). Best-effort — returns [] on any error; never raises."""
        url = f"{self.base_url}/bots"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, headers=self._headers(), timeout=8.0)
                resp.raise_for_status()
                payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            _log.warning("vexa_list_bots_failed", error=str(exc))
            return []
        # The gateway may return a bare list or wrap it (e.g. {"meetings": [...]}).
        if isinstance(payload, dict):
            for key in ("meetings", "bots", "data", "items"):
                if isinstance(payload.get(key), list):
                    return payload[key]
            return []
        return payload if isinstance(payload, list) else []

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
