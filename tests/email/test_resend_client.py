from __future__ import annotations

import httpx

from stewardai.email.resend_client import ResendClient


class _Resp:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("err", request=None, response=None)

    def json(self):
        return self._p


async def test_send_posts_to_resend_with_auth_and_idempotency(monkeypatch):
    captured = {}

    async def fake_post(self, url, *, json=None, headers=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return _Resp({"id": "msg_123"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    client = ResendClient("re_test")
    mid = await client.send(
        sender="Steward <notes@x.ai>",
        to="a@b.com",
        subject="Hi",
        html="<p>Hi</p>",
        reply_to="owner@x.ai",
        idempotency_key="welcome:u1",
    )

    assert mid == "msg_123"
    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["headers"]["Authorization"] == "Bearer re_test"
    assert captured["headers"]["Idempotency-Key"] == "welcome:u1"
    assert captured["json"]["from"] == "Steward <notes@x.ai>"
    assert captured["json"]["to"] == ["a@b.com"]
    assert captured["json"]["reply_to"] == "owner@x.ai"
