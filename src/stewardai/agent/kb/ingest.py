# src/stewardai/agent/kb/ingest.py
"""Orchestrate post-meeting KB ingestion: extract -> resolve entities -> decide
filing -> persist. Pure decisions live in filing.py; DB writes in persistence.py.
Best-effort: any failure is logged, never raised into the meeting teardown path.
"""
from __future__ import annotations

from dataclasses import dataclass

from stewardai.agent.kb import persistence as kbp
from stewardai.agent.kb.entities import resolve_entities
from stewardai.agent.kb.extraction import extract_entities_and_facts
from stewardai.agent.kb.filing import decide_filing, score_candidates
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.ingest")


@dataclass(frozen=True)
class MeetingMeta:
    recurring_event_id: str | None
    attendee_emails: list[str]
    title: str


def _domains(emails: list[str]) -> list[str]:
    out = []
    for e in emails:
        if "@" in e:
            d = e.split("@", 1)[1].strip().lower()
            if d:
                out.append(d)
    return sorted(set(out))


def _new_thread_name(extracted: dict) -> str | None:
    """Name a brand-new Space from a named company only.

    Deliberately does NOT fall back to the meeting title: filing every unmatched
    one-off by its title would spawn a Space per meeting. No company + no candidate
    -> the meeting stays unfiled (or 'suggested' if a weak candidate exists) and
    waits in the tray.
    """
    for ent in extracted.get("entities", []):
        if ent.get("kind") == "company" and (ent.get("name") or "").strip():
            return ent["name"].strip()
    return None


async def _hint_scores(client, *, user_id: str, attendee_emails: list[str], domains: list[str]) -> dict:
    """Aggregate filing_hints into {space_id: score in [0,1]}.

    Sum matched hint weights per space, normalized by the number of signals we
    looked up, so a space matched by both the domain and an attendee scores higher.
    """
    signals = [("attendee_email", e.lower()) for e in attendee_emails] + \
              [("domain", d) for d in domains]
    if not signals:
        return {}
    totals: dict[str, float] = {}
    for kind, value in signals:
        resp = await (
            client.table("filing_hints").select("space_id,weight")
            .eq("user_id", user_id).eq("kind", kind).eq("value", value).execute()
        )
        for row in resp.data or []:
            totals[row["space_id"]] = totals.get(row["space_id"], 0.0) + float(row["weight"])
    if not totals:
        return {}
    denom = float(len(signals))
    return {sid: min(1.0, w / denom) for sid, w in totals.items()}


async def _recurring_space_id(client, *, user_id: str, recurring_event_id: str | None) -> str | None:
    if not recurring_event_id:
        return None
    resp = await (
        client.table("meetings").select("space_id")
        .eq("user_id", user_id).eq("recurring_event_id", recurring_event_id).execute()
    )
    for row in resp.data or []:
        if row.get("space_id"):
            return row["space_id"]
    return None


async def ingest_meeting_kb(client, llm, *, user_id: str, meeting_id: str,
                            transcript: list[str], meta: MeetingMeta) -> None:
    try:
        extracted = await extract_entities_and_facts(llm, transcript)
        entity_ids = await resolve_entities(client, user_id=user_id, extracted=extracted["entities"])
        await kbp.link_meeting_entities(client, user_id=user_id, meeting_id=meeting_id, entity_ids=entity_ids)
        await kbp.set_meeting_tags(client, user_id=user_id, meeting_id=meeting_id, tags=extracted["tags"])

        domains = _domains(meta.attendee_emails)
        recurring = await _recurring_space_id(client, user_id=user_id,
                                              recurring_event_id=meta.recurring_event_id)
        scores = await _hint_scores(client, user_id=user_id,
                                    attendee_emails=meta.attendee_emails, domains=domains)
        candidates = score_candidates(hint_scores=scores)
        decision = decide_filing(recurring_space_id=recurring, candidates=candidates,
                                 new_thread_name=_new_thread_name(extracted))

        space_id = decision.space_id
        if decision.action == "auto_created" and decision.new_space_name:
            space_id = await kbp.create_space(client, user_id=user_id, name=decision.new_space_name)

        await kbp.set_meeting_space(client, user_id=user_id, meeting_id=meeting_id,
                                    space_id=space_id, confidence=decision.confidence,
                                    source=decision.action)

        if space_id:
            await kbp.insert_facts(client, user_id=user_id, space_id=space_id,
                                   meeting_id=meeting_id, facts=extracted["facts"])
            # Only reinforce hints when we actually committed to a space (not 'suggested').
            if decision.action in ("auto", "auto_created", "recurring"):
                await kbp.record_filing_hints(client, user_id=user_id, space_id=space_id,
                                              attendee_emails=meta.attendee_emails, domains=domains)
        _log.info("kb_ingested", meeting_id=meeting_id, action=decision.action,
                  space_id=space_id, facts=len(extracted["facts"]), entities=len(entity_ids))
    except Exception as exc:  # noqa: BLE001 - KB ingest must never break teardown
        _log.warning("kb_ingest_failed", meeting_id=meeting_id, error=str(exc))
