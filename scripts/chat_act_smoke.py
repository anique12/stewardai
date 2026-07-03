#!/usr/bin/env python
"""Live acceptance smoke for the agentic chat ACTING path (Plan C2).

Drives two real action turns against the live Supabase:
  1. "create a space" — a reversible product-op → executes automatically (no gate).
  2. "archive that space" — an outward op → PAUSES for approval (interrupt); we
     feed resume("approve") and it completes.
Verifies the DB actually changed, then cleans up (deletes the space). Proves
write_tools + permission gate (interrupt/resume) end-to-end. Needs GEMINI + Supabase;
does NOT need migration 0011/0012 (permissions best-effort → outward still gates).
"""
# ruff: noqa: E501 — console script
from __future__ import annotations

import argparse
import asyncio
import uuid

from stewardai.agent.chat.session import ChatSession
from stewardai.agent.chat.tools import build_read_tools
from stewardai.agent.chat.write_tools import build_write_tools
from stewardai.config import get_settings
from stewardai.factory import make_llm
from stewardai.integrations.supabase_client import create_service_client

SPACE_NAME = "C2 Smoke Test"


async def _uid(client, explicit):
    if explicit:
        return explicit
    r = await client.table("meetings").select("user_id").limit(1).execute()
    if not (r.data or []):
        raise SystemExit("no user_id; pass --user-id")
    return r.data[0]["user_id"]


async def _find_space(client, user_id):
    r = await client.table("spaces").select("id,name,status").eq("user_id", user_id).execute()
    return [s for s in (r.data or []) if s.get("name") == SPACE_NAME]


async def _drain(gen, label):
    """Consume an event stream, print, return (events, suspended?)."""
    events = []
    async for ev in gen:
        events.append(ev)
        t = ev.get("type")
        if t == "token":
            print(ev.get("delta", ""), end="", flush=True)
        else:
            print(f"\n  [{t}] {({k: v for k, v in ev.items() if k != 'type'})}", flush=True)
    print()
    return events


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user-id", default=None)
    args = ap.parse_args()
    s = get_settings()
    client = await create_service_client(s)
    llm = make_llm(s)
    user_id = await _uid(client, args.user_id)
    tools = build_read_tools(client, llm, user_id=user_id) + build_write_tools(client, user_id=user_id)
    print(f"user_id: {user_id}")

    # --- Turn 1: create (reversible → auto) ---
    print("\n=== TURN 1: create a space ===")
    sess1 = ChatSession(client, llm, user_id=user_id, thread_id=f"smoke-{uuid.uuid4()}", tools=tools)
    await _drain(sess1.stream_turn(f"Create a new space called '{SPACE_NAME}'.", []), "create")
    found = await _find_space(client, user_id)
    print(f"  -> space exists in DB: {bool(found)} {found[:1]}")
    if not found:
        print("!! create FAILED — no space row")
        return
    space_id = found[0]["id"]

    # --- Turn 2: archive (outward → interrupt → approve) ---
    print("\n=== TURN 2: archive it (should ask approval) ===")
    sess2 = ChatSession(client, llm, user_id=user_id, thread_id=f"smoke-{uuid.uuid4()}", tools=tools)
    evs = await _drain(sess2.stream_turn(f"Archive the space named '{SPACE_NAME}'.", []), "archive")
    if any(e.get("type") == "permission_request" for e in evs):
        print("  -> got permission_request; approving…")
        await _drain(sess2.resume("approve"), "resume")
    else:
        print("  -> NOTE: no permission_request seen (agent may not have called archive_space)")
    after = await _find_space(client, user_id)
    status = after[0]["status"] if after else "?"
    print(f"  -> space status now: {status}")

    # --- cleanup ---
    await client.table("spaces").delete().eq("id", space_id).eq("user_id", user_id).execute()
    print(f"\ncleanup: deleted space {space_id}")
    print("=== C2 SMOKE DONE ===")


if __name__ == "__main__":
    asyncio.run(main())
