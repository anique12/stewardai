# tests/web/test_ask_api.py
import web.app as webapp
from fastapi.testclient import TestClient


def _client(monkeypatch, *, user_id, answer):
    async def fake_user_id_from_bearer(authorization, client):
        return user_id

    async def fake_answer_question(client, llm, *, user_id, query, space_id=None):
        return answer

    monkeypatch.setattr(webapp, "user_id_from_bearer", fake_user_id_from_bearer)
    monkeypatch.setattr(webapp, "answer_question", fake_answer_question)
    app = webapp.app
    app.state.llm = object()
    app.state.supabase = object()
    return TestClient(app)


def test_ask_returns_answer_for_valid_token(monkeypatch):
    payload = {"answer": "We ship Friday [1].",
               "citations": [{"n": 1, "meeting_id": "m1", "source_seq": 3,
                              "kind": "segment", "snippet": "we ship Friday"}]}
    client = _client(monkeypatch, user_id="u1", answer=payload)
    r = client.post("/api/ask", json={"query": "when?", "space_id": None},
                    headers={"Authorization": "Bearer good"})
    assert r.status_code == 200
    assert r.json()["answer"] == "We ship Friday [1]."


def test_ask_rejects_missing_or_invalid_token(monkeypatch):
    client = _client(monkeypatch, user_id=None, answer={})
    r = client.post("/api/ask", json={"query": "when?"})
    assert r.status_code == 401
