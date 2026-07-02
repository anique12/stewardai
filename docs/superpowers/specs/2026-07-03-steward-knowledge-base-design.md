# Steward Knowledge Base — Design

**Status:** Design approved (brainstorm), pending spec review → planning
**Date:** 2026-07-03
**Type:** Product design (north-star architecture + v1 scope)

## Problem

Today Steward knows a meeting. It does not know the *work*. Context is trapped
per-meeting: each transcript, summary, and action-item list stands alone. The
boss's world is not a list of meetings — it's a handful of ongoing threads
("the Acme renewal," "hiring," "the Q3 launch"), each spanning many meetings,
people, and decisions over time.

We want Steward to hold the **complete, organized context** of everything the
boss is working on, segregated the way the boss actually thinks — by work /
client / team / topic — so it can brief before a meeting, answer anytime,
participate live with full background, and proactively track threads.

## Framing constraints (from brainstorm)

- **Multi-tenant SaaS.** Every user's mental model differs — one thinks in
  clients, another in projects, another in topics. The structure must adapt,
  not hard-code one taxonomy.
- **The boss is busy.** Organizing must be near-zero effort or it won't happen
  and the knowledge base rots. Automation is the default; manual is the escape
  hatch.
- **Trust is the product.** An assistant that files and asserts things on its
  own must be correctable and sourced, or a single wrong guess erodes belief in
  the whole thing.
- **"Everything" is opt-in.** Meetings + calendar are the always-on base; every
  other source (email, docs, Slack) flows only when the user toggles it on.

## North star: four layers, built bottom-up

The knowledge base is one system in four layers. Each is useful on its own and
shippable before the next; "knowing" deepens as you go up. The four product
surfaces are not four features — they are four *reads* of this stack.

| Layer | What it is | Powers |
|---|---|---|
| **L0 · Capture + Spaces** | Every meeting (+ calendar, + toggled sources) lands, is filed into a Space (confidence-graduated) and tagged. The skeleton. | The organizing structure |
| **L1 · Index + search** | All content chunked + embedded, retrievable. The substrate. | Raw search |
| **L2 · Ask / on-demand synthesis** | Retrieve across a Space/tag/entity and synthesize a sourced answer live. | Ask-anytime recall; on-demand pre-meeting briefing |
| **L3 · Living brief + facts** | After each meeting, update a per-Space state: narrative brief + maintained facts. The curated brain. | Instant briefing; live participation; proactive tracking |

**Why this ordering is the trick:** L3 (the "it just knows" layer) is expensive
and drift-prone if built naively. Sitting on L1+L2 it stays cheap and honest —
every brief line links to its source and can be re-derived from the index.

**Build sequence:** L0 → L1 → L2 → L3, each a releasable milestone.

## Data model (five concepts)

The minimum that supports everything above.

1. **Space** — the flexible, nestable container; the *home* for meetings.
   - Name + optional parent (`Acme › Q3 Renewal`). Optional cosmetic label
     ("client"/"project"/"topic") that changes nothing but how it reads.
   - Status (active/archived). Owns the living brief and rolled-up facts (L3).
   - A meeting lives in **exactly one** Space (its home).

2. **Meeting** — already captured (transcript, summary, action items, attendees,
   time, recurrence). Gains: a home Space, tags, and mentions of entities. Its
   content feeds the Space's brief.

3. **Entities: People & Companies** — **global**, not per-Space. "Jane at Acme"
   is the same Jane everywhere. Auto-extracted; linked to the meetings/Spaces
   that mention them. Unlocks the cross-Space slice: "my whole history with Jane
   / with Globex," which Spaces alone cannot give.

4. **Tags** — free-form **topic/theme** labels (`#pricing`, `#hiring`), many per
   meeting, for slicing by subject. People/companies are entities (above), so
   tags stay clean and don't duplicate names.

5. **Structured facts (maintained per Space)** — the deduped roll-up the brief is
   built from: **open action items · decisions · key dates · open questions /
   risks**. Every fact **links back to the exact meeting/moment it came from.**

```
Space: Acme › Q3 Renewal
 ├─ Meetings (home here) ──mention──▶ People: Jane, Tom   Company: Acme  (global)
 │                        ──carry───▶ Tags: #pricing #renewal
 ├─ Facts (rolled up):  open items · decisions · dates · risks ──link──▶ source meeting
 └─ Living brief: narrative state, rebuilt from facts + recent meetings
```

**Decisions locked:**
- People/Companies are **global entities**, not tags (cross-Space history works).
- A meeting has **one home Space** but **unlimited tags** ("where does this
  live?" stays unambiguous while still cross-cutting).

## Ingestion flow

Runs right after a meeting's summary is ready (already produced today), so briefs
are current *before* the next meeting.

1. **Extract** — one LLM pass over transcript+summary pulls entities
   (people/companies), topic tags, and facts. Facts extend today's action-item
   extraction with *decisions, key dates, open questions/risks.*
2. **Resolve entities** — match extracted people/companies to existing global
   ones (via email/domain/name) or create new.
3. **File into a Space — confidence-graduated:**

   | Signal | Action |
   |---|---|
   | Recurring series | Inherit the series' home Space. Silent, automatic. |
   | High confidence (attendees / email domain / title / entities strongly point to one Space) | Auto-file, with a quiet *"Filed under Acme › Q3 Renewal — change."* |
   | Brand-new thread, high confidence (new domain/company, no match) | Auto-**create** a Space, named from the company/topic. |
   | Low / ambiguous | Land in an **Unfiled tray**; surface one-tap *"Looks like Acme › Q3 Renewal? [Yes] [Other] [New]."* |

4. **Roll up facts** — merge into the Space: **dedupe** repeats, **update**
   statuses (last week's open item now done), **supersede** reversed decisions.
   Each fact keeps its source link.
5. **Update the living brief** — patch the Space's narrative state from the new
   facts. The same diff produces **proactive signals**: *new open item ·
   contradicts the Apr 3 decision · deadline in 2 days.*
6. **Learn** — every correction (moved meeting, fixed tag, merged person) teaches
   this user's filing (their attendees→Space and domain→client mappings), so
   confidence climbs over time.

**Decisions locked:**
- An **Unfiled tray** exists — the trust backstop for auto-filing.
- Steward auto-**creates** Spaces (not just files into existing ones) at high
  confidence, so a new client/project needs no manual setup first.

## The four surfaces (reads of the stack)

| Surface | Reads | What the boss sees |
|---|---|---|
| Ask-anytime recall | L2 | Chat: *"where are we with Acme?"* → retrieves across the Space/entity, answers with sourced citations. |
| Pre-meeting briefing | L3 (instant) / L2 (generated) | 15 min before an event: state, open items (with owners), last decision, who's who. |
| Smarter live participation | L3 | Space brief + facts injected into the **voice agent's** context so it speaks with full background and never contradicts a past decision. |
| Proactive thread-tracking | L3 diffs | Nudges computed at ingestion; delivered via the portal now, messaging (WhatsApp/Telegram) later. |

**Priority sequence (approved):**
1. **Recall + on-demand briefing** — nearly free once L1+L2 exist; first "wow."
2. **Living brief page + instant briefing + live voice injection** — needs L3.
3. **Proactive nudges** — needs trustworthy L3 diffs + a delivery channel.

A lightweight *live participation* could ride L2 (retrieve at meeting start) in
step 1 if desired sooner; the full version wants L3 and lands in step 2.

## Trust guardrails

- **Provenance everywhere** — every fact and brief line links to its exact
  source meeting/moment. No unsourced assertions.
- **Regenerable, never a black box** — the brief rebuilds from facts + index, so
  it can't silently drift into fiction.
- **Cheap correction that teaches** — move a meeting, merge/split a person,
  dismiss a wrong fact; each correction improves future filing.
- **Unfiled tray** — ambiguous meetings wait for a tap; nothing important is
  silently mis-filed.
- **Privacy = tenant boundary + per-source toggles** — each user's Spaces are
  isolated; non-meeting sources flow only when toggled on.

## v1 scope (the foundation + first "wow")

**In: L0 + L1 + L2 + Recall.**

- **L0** — Spaces (create/nest/rename/archive); tags; confidence-graduated
  auto-filing + Unfiled tray; global People/Company entities auto-extracted.
- **L1** — index/embed all meeting content.
- **L2** — **Ask**: query a Space/entity/tag → synthesized, **sourced** answer;
  on-demand pre-meeting briefing.
- **Sources** — meetings + calendar. Per-source toggle scaffolding in place;
  other connectors later.
- **Extraction** — add decisions / key dates / risks to the action items already
  extracted.

**Explicitly later (each its own spec → plan):** L3 living-brief page, live voice
injection, proactive nudges, email/docs/Slack ingestion, sharing Spaces across
teammates.

## Decomposition

This is a multi-milestone effort; the layer/surface sequence *is* the
decomposition. This spec covers the **foundation + v1 (L0+L1+L2+Recall)** in
enough detail to plan. Later milestones (L3, live injection, proactive, extra
sources) each get their own spec → plan → implementation cycle when reached.

## Honest risks (named, not solved here)

- **Entity resolution accuracy** — merging the wrong "John" pollutes the
  cross-Space history. Needs a conservative match threshold + easy split/merge.
- **Per-meeting extraction cost** — an extra LLM pass per meeting. Watch token
  cost; batch/limit where possible.
- **Meetings that genuinely span two threads** — resolved by one home Space +
  tag the other; revisit a multi-home model only if it proves necessary (YAGNI).

## Open questions for planning

- Exact confidence thresholds for auto-file vs. auto-create vs. Unfiled (tune
  empirically against real meetings).
- Whether the v1 "Ask" surface lives in the existing portal or as a new view.
- Reuse vs. extend the existing embeddings/persona machinery for L1 (to be
  checked at planning time against the current code — deliberately not assumed
  here).
