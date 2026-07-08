#!/usr/bin/env python
"""Live end-to-end smoke for the agentic chat core (Plan C1).

Runs a real chat turn through the LangGraph agent against the live Supabase +
Gemini: the agent reasons, calls the `kb_search` tool over the seeded knowledge
base, and streams a source-cited answer. This is C1's acceptance test — it
exercises T1–T4 together with no mocks.

Prereqs: .env with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY; the
KB seeded (scripts/seed_kb_test_meeting.py). Does NOT need migration 0011.

Usage:
  ./.venv/bin/python scripts/chat_smoke.py
  ./.venv/bin/python scripts/chat_smoke.py --q "who owns the reconciliation work?"
"""
# ruff: noqa: E501 — console script
from __future__ import annotations

import argparse
import asyncio

from stewardai.agent.chat.graph import run_chat_turn
from stewardai.config import get_settings
from stewardai.factory import make_llm
from stewardai.integrations.supabase_client import create_service_client

DEFAULT_Q = "Where are we with Acme, and what's still open?"


async def _resolve_user_id(client, explicit: str | None) -> str:
    if explicit:
        return explicit
    resp = await client.table("meetings").select("user_id").limit(1).execute()
    rows = resp.data or []
    if not rows:
        raise SystemExit("No user_id — pass --user-id <uuid> (no meetings to infer from).")
    return rows[0]["user_id"]


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--user-id", default=None)
    ap.add_argument("--q", default=DEFAULT_Q)
    args = ap.parse_args()

    settings = get_settings()
    client = await create_service_client(settings)
    llm = make_llm(settings)
    user_id = await _resolve_user_id(client, args.user_id)

    print(f"user_id: {user_id}")
    print(f"Q: {args.q}\n--- stream ---")
    answer = ""
    citations: list[dict] = []
    async for ev in run_chat_turn(client, llm, user_id=user_id, history=[], message=args.q):
        t = ev.get("type")
        if t == "token":
            print(ev.get("delta", ""), end="", flush=True)
        elif t == "activity":
            print(f"\n  [{ev.get('kind')}:{ev.get('name','')} {ev.get('status','')}]", flush=True)
        elif t == "done":
            answer = ev.get("answer", "")
            citations = ev.get("citations", [])
    print("\n--- done ---")
    print(f"answer chars: {len(answer)}")
    print(f"citations: {len(citations)}")
    for c in citations[:8]:
        print(f"  meeting={c.get('meeting_id')} seq={c.get('source_seq')} kind={c.get('kind')}: {str(c.get('text',''))[:70]}")


if __name__ == "__main__":
    asyncio.run(main())
