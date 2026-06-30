"""Demo-token gate on /ws/pipeline: token verification + rejection when gated.

Mirrors the portal's signing scheme (HS256 JWT, key = bytes.fromhex(secret),
purpose="demo", exp). We sign test tokens with PyJWT using the same key bytes;
HS256 is standard so a portal (jose) token verifies identically.
"""

from __future__ import annotations

import os
import time

import jwt
import pytest
from fastapi.testclient import TestClient
from web.demo_auth import verify_demo_token

SECRET_HEX = "e28f6fbdd750e2210f2d64307787ba8c044316ced91f919469cd4791d632818a"


def _sign(purpose: str = "demo", *, exp_offset: int = 300) -> str:
    key = bytes.fromhex(SECRET_HEX)
    now = int(time.time())
    return jwt.encode(
        {"purpose": purpose, "iat": now, "exp": now + exp_offset},
        key,
        algorithm="HS256",
    )


def test_verify_accepts_fresh_token():
    assert verify_demo_token(_sign(), SECRET_HEX) is True


def test_verify_rejects_expired_token():
    assert verify_demo_token(_sign(exp_offset=-10), SECRET_HEX) is False


def test_verify_rejects_wrong_secret():
    other = "00" * 32
    assert verify_demo_token(_sign(), other) is False


def test_verify_rejects_empty_and_malformed():
    assert verify_demo_token("", SECRET_HEX) is False
    assert verify_demo_token("not.a.jwt", SECRET_HEX) is False


def test_verify_rejects_wrong_purpose():
    assert verify_demo_token(_sign(purpose="other"), SECRET_HEX) is False


@pytest.fixture()
def gated_client():
    keys = ("STT_BACKEND", "TTS_BACKEND", "LLM_BACKEND", "DEMO_TOKEN_SECRET")
    prev = {k: os.environ.get(k) for k in keys}
    os.environ.update(
        STT_BACKEND="stub", TTS_BACKEND="stub", LLM_BACKEND="stub", DEMO_TOKEN_SECRET=SECRET_HEX
    )
    from stewardai.config import get_settings

    get_settings.cache_clear()
    from web.app import app

    try:
        with TestClient(app) as c:
            assert c.app.state.settings.demo_token_secret == SECRET_HEX
            yield c
    finally:
        for k, v in prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        get_settings.cache_clear()


def test_ws_pipeline_rejects_missing_token(gated_client):
    # No ?token= -> handler accepts then sends an error and closes (never reaches the
    # heavy livekit import). The error frame is delivered before the close.
    with gated_client.websocket_connect("/ws/pipeline") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "error"
    assert "token" in msg["text"].lower()


def test_ws_pipeline_rejects_invalid_token(gated_client):
    with gated_client.websocket_connect("/ws/pipeline?token=garbage") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "error"
