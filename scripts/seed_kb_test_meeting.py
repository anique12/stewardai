#!/usr/bin/env python
"""Seed a realistic meeting (transcript + summary) into Supabase, run the REAL KB
ingest (extract facts -> resolve entities -> file -> embed into kb_chunks), then run a
demo Ask so you can watch embedding -> retrieval -> cited answer end-to-end.

This proves the pgvector round-trip the unit tests can't (they use fake clients):
if kb_chunks fills and the Ask returns a sourced answer, L1+L2 work against the live DB.

Prereqs: .env with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, and
migration 0010 applied to the target Supabase project.

Usage (run with the project venv):
  ./.venv/bin/python scripts/seed_kb_test_meeting.py
  ./.venv/bin/python scripts/seed_kb_test_meeting.py --user-id <auth.users uuid>
  ./.venv/bin/python scripts/seed_kb_test_meeting.py --ask "when do we ship Acme?"
"""
from __future__ import annotations

import argparse
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from stewardai.agent.kb.ask import answer_question
from stewardai.agent.kb.teardown import run_kb_ingest
from stewardai.config import get_settings
from stewardai.factory import make_llm
from stewardai.integrations.supabase_client import create_service_client

# A realistic multi-turn meeting: a named company (drives auto-filing), people, a
# decision, a date, a risk, and an open question — so extraction yields varied facts
# and Ask has real content to cite.
TRANSCRIPT: list[tuple[str, str]] = [
    ("Anique", "Alright, let's kick off the Acme integration sync. Priya, where are we with the API work?"),
    ("Priya", "The core endpoints are done — we finished auth and the orders sync this week."),
    ("Anique", "Great. What's left before we can ship to Acme?"),
    ("Priya", "The webhook retries and the reconciliation job. I'd estimate about a week."),
    ("Anique", "Okay. Let's commit to shipping the Acme integration on July 17th, then."),
    ("Priya", "Works for me. One risk: Acme's staging environment has been flaky, which could block our end-to-end testing."),
    ("Anique", "Noted. Can you raise that with their team? We don't want it to slip the date."),
    ("Priya", "Will do — I'll email Rahul at Acme today."),
    ("Anique", "One open question: do we need SOC2 sign-off before go-live, or can that follow?"),
    ("Priya", "I'm not sure — I'll check with legal and confirm."),
    ("Anique", "So action items: Priya finishes webhook retries and reconciliation, raises the staging issue with Acme, and checks the SOC2 requirement."),
    ("Priya", "Got it."),
]

SUMMARY_TLDR = (
    "Acme integration sync: core API (auth + orders sync) is done; remaining work is "
    "webhook retries and the reconciliation job (~1 week). Team committed to shipping "
    "the Acme integration on July 17th. Risk: Acme's flaky staging could block E2E "
    "testing. Open question: whether SOC2 sign-off is required before go-live."
)
SUMMARY_DECISIONS = ["Ship the Acme integration on July 17th."]

DEFAULT_ASK = "What did we decide about the Acme integration, and what are the risks?"


async def _resolve_user_id(client, explicit: str | None) -> str:
    if explicit:
        return explicit
    resp = await client.table("meetings").select("user_id").limit(1).execute()
    rows = resp.data or []
    if not rows:
        raise SystemExit(
            "No user_id found — pass --user-id <auth.users uuid> "
            "(no existing meetings to infer the owner from)."
        )
    return rows[0]["user_id"]


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--user-id", default=None,
                    help="auth.users UUID (default: first existing meetings.user_id)")
    ap.add_argument("--ask", default=DEFAULT_ASK, help="demo question to Ask after seeding")
    args = ap.parse_args()

    settings = get_settings()
    client = await create_service_client(settings)
    llm = make_llm(settings)

    user_id = await _resolve_user_id(client, args.user_id)
    print(f"user_id: {user_id}")

    # 1) The meeting row.
    now = datetime.now(timezone.utc)
    meeting_row = {
        "user_id": user_id,
        "google_event_id": f"kb-seed-{uuid.uuid4()}",
        "title": "Acme integration sync",
        "start_time": (now - timedelta(hours=1)).isoformat(),
        "end_time": now.isoformat(),
        "bot_status": "done",
        "opted_in": True,
    }
    mresp = await client.table("meetings").insert(meeting_row).execute()
    meeting_id = mresp.data[0]["id"]
    print(f"meeting_id: {meeting_id}  ({meeting_row['title']})")

    # 2) transcript_segments (for portal display) + the flat transcript list passed to
    #    ingest. SAME text and order so fact source_line / chunk source_seq map to seq.
    transcript: list[str] = []
    seg_rows = []
    for i, (speaker, text) in enumerate(TRANSCRIPT):
        transcript.append(f"{speaker}: {text}")
        seg_rows.append({"meeting_id": meeting_id, "seq": i, "speaker": speaker, "text": text})
    await client.table("transcript_segments").insert(seg_rows).execute()
    print(f"transcript_segments: {len(seg_rows)}")

    # 3) summary (index_meeting_chunks reads summaries.tldr for the summary chunk).
    await client.table("summaries").insert({
        "meeting_id": meeting_id, "tldr": SUMMARY_TLDR,
        "decisions": SUMMARY_DECISIONS, "discrepancies": [],
    }).execute()
    print("summary: inserted")

    # 4) The REAL KB ingest: extract facts -> resolve entities -> file -> embed to kb_chunks.
    print("running KB ingest (LLM extraction + embedding)...")
    await run_kb_ingest(
        client=client, llm=llm, user_id=user_id, meeting_id=meeting_id,
        transcript=transcript, recurring_event_id=None,
        attendee_emails=["priya@acme.com", "anique@propellus.co"],
        title=meeting_row["title"],
    )

    # 5) What landed.
    kb = await client.table("kb_chunks").select("kind").eq("meeting_id", meeting_id).execute()
    kinds = [r["kind"] for r in (kb.data or [])]
    facts = await client.table("space_facts").select("kind").eq("meeting_id", meeting_id).execute()
    m = await client.table("meetings").select(
        "space_id,space_source,space_confidence").eq("id", meeting_id).execute()
    print("---")
    print(f"kb_chunks: {len(kinds)}  "
          f"(segment={kinds.count('segment')}, summary={kinds.count('summary')}, fact={kinds.count('fact')})")
    print(f"space_facts: {len(facts.data or [])}")
    if m.data:
        row = m.data[0]
        print(f"filing: space_id={row['space_id']} source={row['space_source']} conf={row['space_confidence']}")

    if not kinds:
        print("\n!! kb_chunks is EMPTY — the vector round-trip did NOT work.")
        print("   Check the ingest log lines above for kb_ingest_failed / kb_index_*.")
        return

    # 6) Demo Ask — embedding -> retrieval -> synthesis, with provenance.
    print("---")
    print(f"Q: {args.ask}")
    result = await answer_question(client, llm, user_id=user_id, query=args.ask)
    print(f"A: {result['answer']}")
    print("citations:")
    for c in result["citations"]:
        print(f"  [{c['n']}] ({c['kind']}) meeting={c['meeting_id']} seq={c['source_seq']}: {c['snippet']}")


if __name__ == "__main__":
    asyncio.run(main())
