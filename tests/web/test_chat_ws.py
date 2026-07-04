# tests/web/test_chat_ws.py
"""Tests for the /ws/chat endpoint: streamed agentic-chat events over a
websocket, gated by a Supabase bearer token passed as a ?token= query param
(browsers can't set headers on a websocket).

C2 refactored ``ws_chat`` from the one-shot ``run_chat_turn`` (C1) onto a
per-thread ``ChatSession`` (built fresh per ``user_message``, reused across a
suspended turn's ``permission_decision``/``connect_done`` resume) -- so
``run_chat_turn`` is no longer imported by ``web.app`` and these tests
monkeypatch ``webapp.ChatSession`` (a scripted fake session class) instead of
``webapp.run_chat_turn``.
"""
from __future__ import annotations

import web.app as webapp
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

_DEFAULT_STREAM_EVENTS = [
    {"type": "token", "delta": "Hi"},
    {"type": "done", "answer": "Hi", "citations": []},
]


def _install_fake_chat_session(monkeypatch, *, stream_events=None, resume_events=None):
    """Monkeypatch ``webapp.ChatSession`` with a fake whose ``stream_turn``
    yields ``stream_events`` (default: token + done) and whose ``resume``
    yields ``resume_events`` (default: empty). An ``Exception`` instance in
    either list is raised instead of yielded, to script a mid-turn error."""
    stream_events = stream_events if stream_events is not None else _DEFAULT_STREAM_EVENTS
    resume_events = resume_events if resume_events is not None else []

    class _FakeChatSession:
        def __init__(self, client, llm, *, user_id, thread_id, tools, tz=None):
            self.user_id = user_id
            self.thread_id = thread_id
            self.tools = tools
            self.tz = tz

        async def stream_turn(self, message, history):
            for item in stream_events:
                if isinstance(item, Exception):
                    raise item
                yield item

        async def resume(self, decision):
            for item in resume_events:
                if isinstance(item, Exception):
                    raise item
                yield item

    monkeypatch.setattr(webapp, "ChatSession", _FakeChatSession)
    return _FakeChatSession


def _client(monkeypatch, *, user_id, owned_thread_ids=frozenset()):
    async def fake_user_id_from_bearer(authorization, client):
        return user_id

    async def fake_create_thread(client, *, user_id, title):
        return "t1"

    async def fake_get_thread_messages(client, *, user_id, thread_id):
        return []

    async def fake_append_message(client, *, user_id, thread_id, role, parts):
        return None

    async def fake_thread_owned(client, *, user_id, thread_id):
        return thread_id in owned_thread_ids

    monkeypatch.setattr(webapp, "user_id_from_bearer", fake_user_id_from_bearer)
    _install_fake_chat_session(monkeypatch)
    monkeypatch.setattr(webapp, "create_thread", fake_create_thread)
    monkeypatch.setattr(webapp, "get_thread_messages", fake_get_thread_messages)
    monkeypatch.setattr(webapp, "append_message", fake_append_message)
    monkeypatch.setattr(webapp, "thread_owned", fake_thread_owned)

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


def test_ws_chat_malformed_frame_does_not_close_socket(monkeypatch):
    """A non-JSON text frame must not tear down the connection: the client
    gets an error event and the socket stays usable for the next message."""
    client = _client(monkeypatch, user_id="u1")
    with client.websocket_connect("/ws/chat?token=x") as ws:
        ws.send_text("this is not json")
        err = ws.receive_json()
        assert err == {"type": "error", "text": "could not parse message"}

        # The socket is still alive: a valid message right after still works.
        ws.send_json({"type": "user_message", "text": "hello"})
        messages = [ws.receive_json(), ws.receive_json(), ws.receive_json()]

    assert [m["type"] for m in messages][-1] == "done"


def test_ws_chat_ignores_thread_id_not_owned_by_user(monkeypatch):
    """A client-supplied thread_id that doesn't belong to this user must be
    treated as absent -- a fresh thread is created instead of writing into it."""
    seen_thread_ids: list = []
    client = _client(monkeypatch, user_id="u1", owned_thread_ids=set())

    async def capturing_get_thread_messages(c, *, user_id, thread_id):
        seen_thread_ids.append(thread_id)
        return []

    monkeypatch.setattr(webapp, "get_thread_messages", capturing_get_thread_messages)

    with client.websocket_connect("/ws/chat?token=x") as ws:
        ws.send_json(
            {"type": "user_message", "text": "hello", "thread_id": "someone-elses-thread"}
        )
        messages = [ws.receive_json(), ws.receive_json(), ws.receive_json()]

    types = [m["type"] for m in messages]
    assert "thread" in types  # a fresh thread was created
    thread_event = next(m for m in messages if m["type"] == "thread")
    assert thread_event["id"] == "t1"  # fake create_thread's id, never the untrusted one
    assert seen_thread_ids == ["t1"]


def test_ws_chat_uses_owned_thread_id_as_is(monkeypatch):
    """A client-supplied thread_id that IS owned by this user is used
    directly -- no new thread is created."""
    seen_thread_ids: list = []
    client = _client(monkeypatch, user_id="u1", owned_thread_ids={"my-thread"})

    async def capturing_get_thread_messages(c, *, user_id, thread_id):
        seen_thread_ids.append(thread_id)
        return []

    monkeypatch.setattr(webapp, "get_thread_messages", capturing_get_thread_messages)

    with client.websocket_connect("/ws/chat?token=x") as ws:
        ws.send_json({"type": "user_message", "text": "hello", "thread_id": "my-thread"})
        messages = [ws.receive_json(), ws.receive_json()]

    types = [m["type"] for m in messages]
    assert "thread" not in types
    assert types[-1] == "done"
    assert seen_thread_ids == ["my-thread"]


def test_ws_chat_turn_error_sends_generic_text_not_raw_exception(monkeypatch):
    """An exception mid-turn must not leak its raw text to the client."""
    client = _client(monkeypatch, user_id="u1")
    _install_fake_chat_session(
        monkeypatch,
        stream_events=[RuntimeError("supabase: relation chat_messages leaked detail")],
    )

    with client.websocket_connect("/ws/chat?token=x") as ws:
        ws.send_json({"type": "user_message", "text": "hello"})
        messages = [ws.receive_json(), ws.receive_json()]

    err = next(m for m in messages if m["type"] == "error")
    assert err["text"] == "something went wrong on this turn"
    assert "supabase" not in err["text"]
    assert "leaked detail" not in err["text"]


def test_ws_chat_permission_round_trip(monkeypatch):
    """A write-tool interrupt suspends the turn as `permission_request`; the
    client's `permission_decision` resumes the SAME session via `resume`,
    which streams the rest of the turn (token, then done)."""
    client = _client(monkeypatch, user_id="u1")
    _install_fake_chat_session(
        monkeypatch,
        stream_events=[
            {"type": "token", "delta": "Sure, "},
            {
                "type": "permission_request",
                "call_id": "t1",
                "kind": "permission",
                "tool": "send_email",
            },
        ],
        resume_events=[
            {"type": "token", "delta": "done."},
            {"type": "done", "answer": "Sure, done.", "citations": []},
        ],
    )

    with client.websocket_connect("/ws/chat?token=x") as ws:
        ws.send_json({"type": "user_message", "text": "email bob"})
        thread_msg = ws.receive_json()
        assert thread_msg == {"type": "thread", "id": "t1"}

        token_msg = ws.receive_json()
        assert token_msg == {"type": "token", "delta": "Sure, "}

        permission_msg = ws.receive_json()
        assert permission_msg["type"] == "permission_request"

        ws.send_json({"type": "permission_decision", "decision": "approve"})

        resumed_token = ws.receive_json()
        assert resumed_token == {"type": "token", "delta": "done."}

        done_msg = ws.receive_json()
        assert done_msg["type"] == "done"
        assert done_msg["answer"] == "Sure, done."

    types = [thread_msg["type"], token_msg["type"], permission_msg["type"],
             resumed_token["type"], done_msg["type"]]
    assert types == ["thread", "token", "permission_request", "token", "done"]
