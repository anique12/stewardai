"""Deterministic dedup keys for email_outbox (also used as Resend idempotency keys)."""

from __future__ import annotations


def dedup_key_for(kind: str, **parts: str) -> str:
    return ":".join([kind, *[str(v) for v in parts.values()]])
