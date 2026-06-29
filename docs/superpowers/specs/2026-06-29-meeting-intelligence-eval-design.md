# Meeting Intelligence v1 — Named Diarization, Decide Policy, Summary + Eval

**Date:** 2026-06-29
**Status:** Design (approved in brainstorming, pending spec review)

## Goal

Let the StewardAI meeting agent (a) know **who said what** in a multi-person
meeting, (b) decide on its own when to speak vs stay silent, and (c) produce a
**summary + action items** attributed to real participants — then evaluate all
of this with a repeatable scripted test.

## Scope

**In scope (v1 — testable with 3–4 live accounts):**
1. **Named diarization** — every transcript segment is labeled with the real
   participant name.
2. **Meeting-aware decide policy** — LLM-driven `speak` / `stay_silent` per
   turn: speak only when directly addressed **or** when it detects a material
   discrepancy with something said earlier.
3. **Simple summary + action items** — a text artifact per meeting (TL;DR,
   decisions, action items `[owner → task]`), produced on "Steward, summarize"
   (spoken back) and at meeting end (written to file).
4. **Scripted test meeting + scoring** — a fixed 4-person script with planted
   action items and one deliberate discrepancy, plus a scoring checklist.

**Deferred (separate, later specs — explicitly NOT in v1):**
- Slack / Discord / Google Calendar / Gmail integrations.
- Robust tool-calling / autonomous actions (creating calendar events, sending
  emails, etc.).
- Rich delivery (posting to Meet chat, email digests, dashboards).
- Long-meeting transcript compaction / rolling summarization.

## Background / current reality

- The Vexa bot's steward tap captures the **combined room mix** (all
  participants summed to one mono 16 kHz stream) → our Deepgram STT → a **single
  transcript with no speaker labels**. The agent currently has **no** speaker
  attribution.
- Vexa **already detects the active speaker by name** from the Google Meet DOM
  (observed in bot logs: `SpeakerDebug: SPEAKING START: Anique Sabir` /
  `SPEAKING END: Anique Sabir`). This data exists in the bot but is not
  forwarded to our agent.
- The agent already has a gated `decide()` path (`build_llm_node(gated=True)`,
  `_MEETING_DECIDE_SYSTEM`) that was built earlier and is currently disabled
  (the meeting runs `gated=False`). v1 re-enables and extends it.
- Control plane between agent and bot: the agent **publishes** mic commands to
  Redis channel `bot_commands:meeting:<id>`; the bot **subscribes**. v1 adds a
  reverse channel for speaker events.

## Architecture

### A. Named diarization

**Transport:** the bot **publishes** active-speaker events to a new Redis
channel `steward_speaker:meeting:<id>`; the agent **subscribes**. This reuses
the Redis control plane already in place (no new socket/transport), so the bot
patch is minimal.

- **Bot patch:** at the existing speaker-detection site in the Vexa bot
  (where `SPEAKING START/END: <name>` is logged), also
  `redis.publish("steward_speaker:meeting:<id>", {speaker, event:"start"|"end", ts})`.
  Gated behind the existing `STEWARD_BRIDGE_ENABLED` flag.
- **Agent:** a subscriber (mirroring `RedisControl`) tracks the **current active
  speaker** and a short history of `(speaker, start_ts, end_ts)`.
- **Labeling (per-turn, not per-word):** the agent already processes one
  **turn** at a time (LiveKit fires end-of-utterance, then the finalized
  transcript for that turn). v1 labels at that granularity: tag the finalized
  turn with the participant who **held the floor during it** — the speaker whose
  Vexa active-window overlaps the turn (in practice the most recent
  `SPEAKING START` without a matching `END` when the turn closes). Inject as the
  message content `"[<Name>]: <transcript>"`. The decide LLM and the summary LLM
  therefore both see a **speaker-labeled** transcript. This sidesteps fragile
  word-level timestamp alignment.
- **Overlap handling (v1):** if two participants overlap within one turn, label
  with the one who held the floor longest in that window; ties → most recent
  `start`. Cross-talk mislabels are acceptable in v1 (meetings are mostly
  turn-taking); logged, not specially handled.
- **Clock reference:** the agent timestamps speaker events on receipt
  (monotonic) and compares against the turn's open/close times it observes
  locally — so there is no bot/agent clock-skew dependency. Bridge latency is
  small (measured ~20 ms, p95 ~26 ms), well under turn granularity.

### B. Decide policy (in-meeting behavior)

Re-enable gated decide for the meeting (`gated=True`) with a new
`_MEETING_SYSTEM` prompt (replacing the old wake-word-only
`_MEETING_DECIDE_SYSTEM`):

> You are **Steward**, an assistant participating in a live multi-person
> meeting. You receive a running transcript where each line is labeled with the
> speaker's name. On each turn decide whether to speak:
> - Call `speak(text)` ONLY when **(a)** someone directly addresses you (by name
>   "Steward" or an explicit request to you), **or (b)** you notice a **material
>   discrepancy** — something just said contradicts a decision or fact stated
>   earlier in this meeting. When flagging a discrepancy, name both sides
>   (e.g., "Earlier Anique said Friday, but Sarah just said Monday — which is
>   it?"). Be concise; speak as if out loud.
> - Otherwise call `stay_silent()`. Do NOT chime in on normal discussion,
>   agreement, small talk, or minor wording differences. Silence is the default.

- The decide context = the **speaker-labeled** running transcript (so it can
  attribute "who said what then vs now").
- Existing `decide()` tool-calling (`speak` / `stay_silent`) is reused
  unchanged; only the system prompt and the labeled context are new.

### C. Summary + action items

A separate prompt over the **full speaker-labeled transcript** produces a text
artifact `evals/out/meeting-<id>-summary.md` (and a parallel `.json` for
scoring):

```
# Meeting Summary
TL;DR: <2-3 sentences>
## Decisions
- <decision>
## Action items
- <owner> → <task> (<due if stated>)
## Open questions / discrepancies raised
- <...>
```

- **Triggers:** (1) on "Steward, summarize" → the decide path recognizes the
  request, generates the summary, and **speaks a short version** while writing
  the full artifact; (2) at **meeting end** (bot leave / session close) → write
  the artifact.
- v1 keeps generation as a single LLM call over the whole transcript (fine for
  short eval meetings; long-meeting compaction is deferred).

## Data flow

```
Meet audio ─(combined mix)→ bot tap → TCP bridge → agent STT (Deepgram) ─┐
Meet DOM ─(active speaker)→ bot ─(Redis steward_speaker:<id>)→ agent ─────┤
                                                                          ▼
                                            align segment ↔ active speaker
                                                                          ▼
                                        speaker-labeled running transcript
                                              │                     │
                                     decide() per turn        summary on
                                  (speak / stay_silent)   request + meeting end
                                              │                     │
                                     speak → TTS → bot      write artifact
```

## Test scenario (scripted, 4 participants, ~5 min)

A sprint-planning standup. Hand each participant their lines. Planted: 3 action
items with distinct owners, and **one deliberate discrepancy** (launch date),
plus one direct address to Steward.

**Participants:** Anique (lead), Sarah (backend), Marcus (frontend), Priya (design).

```
Anique:  Morning everyone. Goal today: lock the v2 launch plan. I'm thinking we
         ship Friday.
Sarah:   Backend's mostly there. The payments migration still needs testing —
         I'll have that done by Wednesday.
Marcus:  Frontend checkout is done. I still need to wire the new error states.
Priya:   I'll get the final checkout mockups to Marcus by tomorrow morning.
Marcus:  Great, once I have those I can finish the error states by Thursday.
Anique:  Perfect. So Friday launch holds.
Sarah:   Wait — I thought last week we agreed launch was Monday, not Friday,
         to give QA the weekend?                        ← DISCREPANCY trigger
   (Steward should interject: Anique said Friday, Sarah recalls Monday.)
Anique:  Good catch. Let's confirm Monday then. Priya, can you also prep the
         launch announcement?
Priya:   Yes, I'll draft the announcement by Friday.
Anique:  Steward, can you summarize what we've decided and the action items?
   (Steward should speak a short summary aloud.)
Anique:  Thanks. That's it — Steward, summarize the meeting.
   (Steward writes the full artifact on close.)
```

**Expected outputs (the scoring targets):**
- **Diarization:** each line attributed to the correct speaker.
- **Discrepancy:** Steward interjects after Sarah's line, naming both the Friday
  (Anique) and Monday (Sarah) claims.
- **Action items extracted:**
  - Sarah → finish payments migration testing (Wed)
  - Priya → final checkout mockups to Marcus (tomorrow AM)
  - Marcus → wire checkout error states (Thu)
  - Priya → draft launch announcement (Fri)
- **Decision:** launch moved Friday → **Monday**.

## Datasets (offline, repeatable eval — primary use is later)

- **AMI Meeting Corpus** (Hugging Face, e.g. `edinburghnlp/ami`-style mirrors):
  real multi-party meetings with **speaker labels + abstractive summaries +
  extractive/action-item annotations** — the gold standard for diarization +
  summary + action items together.
- **QMSum** (`pszemraj/qmsum-cleaned`) and **MeetingBank**
  (`microsoft/MeetingBank-QA-Summary`): query-focused + general meeting
  summarization references (from the earlier dataset research).
- For v1 the **live scripted test is primary**; the datasets are for repeatable,
  automated scoring once the live loop is validated.

## Eval / scoring (v1)

- **Live scripted run:** a checklist scored against the script above —
  diarization accuracy (% lines correctly attributed), discrepancy caught
  (yes/no + quality), action items (precision/recall on owner+task), decision
  captured (yes/no).
- **Summary quality:** an LLM-judge (faithfulness + coverage) over the artifact
  vs the script's expected outputs.
- Extend `scripts/turn_latency.py`-style tooling with a `scripts/score_meeting.py`
  that takes the summary `.json` + the script's expected `.json` and reports the
  checklist.

## Components / files affected

- **Vexa bot patch** (`services/vexa-bot/core/src/...`): publish speaker events to
  `steward_speaker:meeting:<id>` (behind `STEWARD_BRIDGE_ENABLED`). Rebuild the
  `vexaai/vexa-bot:steward` image.
- **Agent** (`src/stewardai/...`):
  - new Redis subscriber for speaker events (mirror of `bridge/vexa_control.py`);
  - transcript-labeling step (inject `[Name]:` into chat context);
  - `meeting_runner.py`: switch to `gated=True`, wire the speaker subscriber;
  - `agent/assembly.py`: new `_MEETING_SYSTEM` decide prompt;
  - summary generation module + artifact writer;
  - `scripts/score_meeting.py` scoring helper.
- **Config**: speaker-channel name; summary output dir.

## Error handling

- No speaker events arriving (bot patch off / Redis down) → fall back to
  **unlabeled** transcript (`[Speaker]:`), log a warning; decide + summary still
  run, just without names. Never block the meeting.
- Summary LLM failure → log + write a partial artifact noting the failure; never
  crash the session.
- Speaker/segment misalignment → best-effort label; never raise.

## Open questions (resolved in brainstorming)

- Attribution = **real names** ✅ · Speaker transport = **Redis side-channel** ✅
- In-meeting behavior = **addressed-only + discrepancy, LLM-decided** ✅
- Summary triggers (on-demand + end) kept simple for v1; richer delivery deferred ✅
