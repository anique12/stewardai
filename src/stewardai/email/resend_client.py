"""Thin Resend HTTP client (httpx). No SDK dependency."""

from __future__ import annotations

import httpx

from stewardai.common.logging import get_logger

_log = get_logger("email.resend_client")
_API = "https://api.resend.com/emails"


class ResendClient:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def send(
        self,
        *,
        sender: str,
        to: str,
        subject: str,
        html: str,
        reply_to: str | None = None,
        headers: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        """POST one email to Resend. Returns the message id; raises on non-2xx."""
        body: dict = {"from": sender, "to": [to], "subject": subject, "html": html}
        if reply_to:
            body["reply_to"] = reply_to
        if headers:
            body["headers"] = headers
        req_headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if idempotency_key:
            req_headers["Idempotency-Key"] = idempotency_key
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(_API, json=body, headers=req_headers)
            resp.raise_for_status()
            data = resp.json()
        return str(data.get("id") or "")
