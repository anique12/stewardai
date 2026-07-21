# Meeting wake-gating hardening (prompt-only)

**Date:** 2026-07-21
**Status:** Design — awaiting review
**Scope:** `src/stewardai/agent/assembly.py` → `build_meeting_system` prompt only. No code, config, or state changes.

## Problem

In meeting `22f65313-…` (internal id 60) — a 2-person human demo (John Reilly + Zeeshan Ashraf) — the bot spoke twice, unprompted:

- seq 74 `[StewardAI] So, John, what is your goal for the next 60 to 90 days?` — it echoed a question **Zeeshan asked John** (seq 66-67).
- seq 76 `[StewardAI] No, that's Carla…` — explaining confusion not aimed at it.

The humans noticed: seq 72 *"Why is this thing speaking?"*, seq 75 *"How did I ever unleash that?"*

### Root cause

The per-turn gate ran correctly (Loki shows `stay_silent` on nearly every turn), but the gating LLM **misjudged 2 turns** and streamed text. The current wake rule (`assembly.py:407`) contains a loophole:

> "You WAKE when someone addresses you by name (`{name}`) **or clearly directs a question or request at you**."

In a multi-person meeting, a question aimed at *another human* ("what's your goal, John?") matches "a question directed at you," so the bot woke on ambient, name-less conversation. There is no participant-count awareness and no requirement for the wake name.

## Goal

Harden the wake logic so the bot only speaks when genuinely addressed, judged entirely by the gating LLM from the transcript it already receives. No mechanical counters or code state — the LLM has the full transcript and can tell whether the conversation is with it.

**Deferred (not in this change):** "single human present → assume addressed / speak normally." This will be added and enabled after the hardened version is validated.

## Design

Prompt-only. Rewrite the wake/gating rules in `build_meeting_system` to encode:

**Speak when:**
1. Someone says the bot's name (`{name}`) — the wake word opens a conversation.
2. The bot is already in an ongoing exchange with that person (visible in the transcript): their immediate follow-ups continue the same conversation and don't need to repeat the name (including a check like "can you hear me?").
3. A **material discrepancy** (a statement contradicting a fact/decision stated earlier in this meeting) — unchanged.

**Stay silent when (any of these):**
1. A question or request does **not** include the bot's name and isn't a follow-up in an ongoing exchange with it — even if it sounds like a direct question. It's the humans talking to each other.
2. Someone addresses **another participant by name** — that question is for them.
3. A **general question** is asked that isn't aimed at the bot.
4. The bot thought a question was for it, but **another participant answers it** — it was theirs; don't also answer.
5. The **topic changes** or the discussion moves to other people talking to each other — the conversation is no longer with the bot; wait until someone says its name again.
6. Default: when in doubt, stay silent.

The key change is **removing the "or clearly directs a question or request at you" clause** and replacing it with the explicit, name-anchored rule set above. The existing "follow-up continuity," "topic moved → go quiet," and "material discrepancy" clauses are preserved and sharpened.

### What does NOT change

- The gate mechanism (native `chat_with_tools` streaming gate with `stay_silent`) is unchanged.
- No new config keys, no per-session state, no thread counter, no deterministic guard.
- `_addressed_by_name` / error-fallback / filler behavior unchanged.

## Testing

The decision is LLM judgment, so validation is behavioral rather than a unit test of pure logic:

1. **Transcript-replay eval (heavy):** feed the meeting-60 transcript up to seq 73 into the gate and assert the model calls `stay_silent` on the name-less "what is your goal…" turn (the seq-74 trigger). Add a positive case: a turn containing the wake name → speaks; a valid follow-up → speaks; a follow-up after another participant is named → silent. Runs under the existing `heavy` marker (needs the LLM).
2. **Prompt snapshot test (light):** assert `build_meeting_system(...)` no longer contains the "clearly directs a question" loophole and contains the new rules — guards against regressions to the wording.
3. **Manual QA on the hardened/QA environment first** (per rollout below) with a 2-person meeting: confirm the bot stays silent on ambient Q&A and wakes on the name.

## Rollout

1. Deploy to the hardened/QA environment; run a 2-person meeting and confirm no ambient wake + correct wake-on-name + follow-up continuity.
2. Once validated, promote to production.
3. Later: design + add the deferred "single human present → assume addressed" behavior on top of this hardened base.

## Risks

- Prompt-only relies on the gating LLM following the rules; a rare misfire is still possible (accepted trade-off vs. a deterministic guard, per decision on 2026-07-21). If misfires persist in QA, revisit a deterministic name guard.
- Over-tightening could make the bot miss a legitimate name-less follow-up; mitigated by the explicit "follow-up continuity" rule and QA before production.
