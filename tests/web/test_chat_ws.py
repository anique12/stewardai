# tests/web/test_chat_ws.py
"""Tests for the /ws/chat endpoint: streamed agentic-chat events over a
websocket, gated by a Supabase bearer token passed as a ?token= query param
(browsers can't set headers on a websocket)."""
from __future__ import annotations

import web.app as webapp
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


async def _fake_run_chat_turn(client, llm, *, user_id, history, message):
    yield {"type": "token", "delta": "Hi"}
    yield {"type": "done", "answer": "Hi", "citations": []}


def _client(monkeypatch, *, user_id):
    async def fake_user_id_from_bearer(authorization, client):
        return user_id

    async def fake_create_thread(client, *, user_id, title):
        return "t1"

    async def fake_get_thread_messages(client, *, user_id, thread_id):
        return []

    async def fake_append_message(client, *, user_id, thread_id, role, parts):
        return None

    monkeypatch.setattr(webapp, "user_id_from_bearer", fake_user_id_from_bearer)
    monkeypatch.setattr(webapp, "run_chat_turn", _fake_run_chat_turn)
    monkeypatch.setattr(webapp, "create_thread", fake_create_thread)
    monkeypatch.setattr(webapp, "get_thread_messages", fake_get_thread_messages)
    monkeypatch.setattr(webapp, "append_message", fake_append_message)

    app = webapp.app
    app.state.supabase = object()
    app.state.llm = object()
    return TestClient(app)


def test_ws_chat_streams_thread_and_done(monkeypatch):
    client = _client(monkeypatch, user_id="u1")
    with client.websocket_connect("/ws/chat?token=x") as ws:
        ws.send_json({"type": "user_message", "text": "hello"})
        messages = [ws.receive_json(), ws.receive_json(), ws.receive_json()]

    types = [m["type"] for m in messages]
    assert "thread" in types
    assert "token" in types
    assert types[-1] == "done"
    done = next(m for m in messages if m["type"] == "done")
    assert done["answer"] == "Hi"
    assert done["citations"] == []


def test_ws_chat_rejects_missing_or_invalid_token(monkeypatch):
    client = _client(monkeypatch, user_id=None)
    try:
        with client.websocket_connect("/ws/chat?token=bad") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "error"
            assert "unauthorized" in msg["text"].lower()
    except WebSocketDisconnect:
        pass
