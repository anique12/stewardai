# Meeting Intelligence v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the StewardAI meeting agent named speaker attribution, an addressed-only + discrepancy decide policy, and a simple summary + action-items artifact — plus a scripted test and scorer.

**Architecture:** The Vexa bot publishes per-utterance speaker events (name + start/end) to Redis. The agent subscribes and keeps a `SpeakerTracker` of who currently holds the floor. A `MeetingAgent` (LiveKit `Agent` subclass) labels each finalized user turn with the active speaker via `on_user_turn_completed` (STT-backend-agnostic — works with the cloud Deepgram plugin) and appends it to an in-memory labeled transcript. The gated `decide()` LLM (new `_MEETING_SYSTEM` prompt) sees the labeled transcript and speaks only when addressed or on a material discrepancy. At session close (and on a "summarize" request) a summary module turns the labeled transcript into a markdown + JSON artifact. A scorer compares the JSON to a scripted-meeting expectation file.

**Tech Stack:** Python 3.12, livekit-agents 1.6.4, redis.asyncio, LiteLLM/Gemini, pytest; TypeScript (Vexa bot patch) + Redis `node-redis`.

## Global Constraints

- Speaker transport: Redis pub/sub channel `steward_speaker:meeting:<id>`, JSON `{speaker, event:"start"|"end", ts}` (ms epoch). Bot publishes; agent subscribes.
- Bot patch gated behind the existing env flag `STEWARD_BRIDGE_ENABLED === 'true'`.
- Speaker labeling is **per-turn**, injected into the message content as the exact prefix `"[<Name>]: "` (note the single space after the colon).
- Fallback prefix when no speaker is known: `"[Speaker]: "`. Missing speaker events must NEVER block the meeting — degrade to unlabeled and log a warning.
- Summary artifacts: `evals/out/meeting-<id>-summary.md` and `evals/out/meeting-<id>-summary.json`.
- All livekit imports stay LAZY (inside functions/methods), matching `agent/assembly.py` and `agent/nodes.py`.
- Agent backend selection unchanged (meeting runs `STT_BACKEND=deepgram`, `TTS_BACKEND=cartesia`, `PREEMPTIVE_GENERATION` controlled by env). `decide()` is NOT compatible with preemptive_generation — when gated, the runner must pass `preemptive_generation=False` regardless of env (preemptive speculates on partials; decide needs the committed turn). Add this guard in Task 4.
- Run tooling from the stewardai venv: `cd /Users/aniquesabir/projects/stewardai && source .venv/bin/activate`.

---

### Task 1: Vexa bot publishes per-utterance speaker events to Redis

**Files:**
- Modify: `/Users/aniquesabir/vexa/services/vexa-bot/core/src/platforms/googlemeet/recording.ts` (the `SPEAKING START`/`SPEAKING END` emit sites, ~line 361 / ~367)
- Modify: `/Users/aniquesabir/vexa/services/vexa-bot/core/src/index.ts` (Node-side handler that publishes to Redis, near the existing `redisPublisher` at ~line 150 and the `logBot`/exposeFunction bridge)
- Rebuild image: `vexaai/vexa-bot:steward`

**Interfaces:**
- Produces: Redis PUBLISH on `steward_speaker:meeting:<meeting_id>` of `{"speaker": "<name>", "event": "start"|"end", "ts": <ms epoch>}`.

**Context:** Speaker detection runs in the browser page (`recording.ts`) and surfaces to Node via `window.logBot`. There is already a `redisPublisher` (`index.ts:150`) and a `SegmentPublisher` writing a `speaker_events_relative` stream, but the granular per-utterance start/end are only logged. We add an explicit page→Node bridge function and publish from Node (so we control the channel + format exactly).

- [ ] **Step 1: Expose a page→Node bridge for speaker events.** In `index.ts`, near the other `page.exposeFunction` registrations (where `STEWARD_BRIDGE_ENABLED` is checked), add:

```ts
if (process.env.STEWARD_BRIDGE_ENABLED === 'true') {
  await page.exposeFunction('__stewardSpeakerEvent',
    async (speaker: string, event: 'start' | 'end', ts: number) => {
      try {
        if (!redisPublisher) return;
        const meetingId = currentBotConfig?.meeting_id ?? 'unknown';
        await redisPublisher.publish(
          `steward_speaker:meeting:${meetingId}`,
          JSON.stringify({ speaker, event, ts })
        );
      } catch (e: any) { log(`[StewardSpeaker] publish failed: ${e?.message || e}`); }
    });
}
```

- [ ] **Step 2: Call the bridge from the speaker-detection site.** In `recording.ts`, immediately after each `logBot("[SpeakerDebug] SPEAKING START: ...")` and `SPEAKING END`, call the exposed fn (guard on its existence so non-steward runs are unaffected):

```ts
// after SPEAKING START
if ((window as any).__stewardSpeakerEvent) (window as any).__stewardSpeakerEvent(participantName, 'start', Date.now());
// after SPEAKING END
if ((window as any).__stewardSpeakerEvent) (window as any).__stewardSpeakerEvent(participantName, 'end', Date.now());
```

- [ ] **Step 3: Rebuild the patched bot image.**

Run: `cd /Users/aniquesabir/vexa && docker build -t vexaai/vexa-bot:steward services/vexa-bot/core`
Expected: build succeeds; image `vexaai/vexa-bot:steward` updated.

- [ ] **Step 4: Verify events on the wire (manual, no unit test for the browser patch).** Start a meeting bot (existing join flow), then in another shell:

Run: `docker exec vexa-redis-1 redis-cli PSUBSCRIBE 'steward_speaker:meeting:*'`
Expected: when a participant speaks, lines like `{"speaker":"Anique Sabir","event":"start","ts":...}` then `...,"event":"end",...` appear.

- [ ] **Step 5: Commit (in the vexa repo).**

```bash
cd /Users/aniquesabir/vexa && git add services/vexa-bot/core/src/platforms/googlemeet/recording.ts services/vexa-bot/core/src/index.ts
git commit -m "feat(steward): publish per-utterance speaker events to Redis"
```

---

### Task 2: Agent-side SpeakerTracker + Redis subscriber

**Files:**
- Create: `src/stewardai/bridge/speaker_events.py`
- Test: `tests/bridge/test_speaker_events.py`

**Interfaces:**
- Produces:
  - `class SpeakerTracker` with `on_event(speaker: str, event: str, ts_ms: int) -> None` and `current_speaker() -> str | None` (the speaker whose most recent `start` has no matching `end`; if multiple are open, the most recently started).
  - `class SpeakerSubscriber(redis_url: str, meeting_id: str, tracker: SpeakerTracker)` with `async def start() -> None` (spawns a background task subscribing to `steward_speaker:meeting:<id>`, feeding `tracker.on_event`) and `async def aclose() -> None`.

- [ ] **Step 1: Write the failing test for SpeakerTracker.**

```python
# tests/bridge/test_speaker_events.py
from stewardai.bridge.speaker_events import SpeakerTracker


def test_tracker_reports_open_speaker():
    t = SpeakerTracker()
    assert t.current_speaker() is None
    t.on_event("Anique", "start", 1000)
    assert t.current_speaker() == "Anique"
    t.on_event("Anique", "end", 2000)
    assert t.current_speaker() is None


def test_tracker_most_recent_open_speaker_wins_on_overlap():
    t = SpeakerTracker()
    t.on_event("Anique", "start", 1000)
    t.on_event("Sarah", "start", 1500)  # overlap
    assert t.current_speaker() == "Sarah"
    t.on_event("Sarah", "end", 1800)
    assert t.current_speaker() == "Anique"  # Anique still open
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `python -m pytest tests/bridge/test_speaker_events.py -v`
Expected: FAIL with `ModuleNotFoundError`/`ImportError` (module not yet created).

- [ ] **Step 3: Implement SpeakerTracker + SpeakerSubscriber.**

```python
# src/stewardai/bridge/speaker_events.py
"""Subscribe to Vexa's per-utterance speaker events and track the active speaker.

The bot publishes JSON {speaker, event:"start"|"end", ts} to the Redis channel
``steward_speaker:meeting:<id>``. ``redis`` is imported lazily (no hard dep).
"""
from __future__ import annotations

import asyncio
import contextlib
import json

from stewardai.common.logging import get_logger

_log = get_logger("bridge.speaker_events")


class SpeakerTracker:
    """Tracks who currently holds the floor from start/end events."""

    def __init__(self) -> None:
        # ordered list of currently-open speakers (by start order)
        self._open: list[str] = []

    def on_event(self, speaker: str, event: str, ts_ms: int) -> None:  # noqa: ARG002
        if event == "start":
            if speaker in self._open:
                self._open.remove(speaker)
            self._open.append(speaker)  # most-recent at the end
        elif event == "end":
            with contextlib.suppress(ValueError):
                self._open.remove(speaker)

    def current_speaker(self) -> str | None:
        return self._open[-1] if self._open else None


class SpeakerSubscriber:
    """Background Redis subscriber feeding a SpeakerTracker."""

    def __init__(self, redis_url: str, meeting_id: str, tracker: SpeakerTracker) -> None:
        self.channel = f"steward_speaker:meeting:{meeting_id}"
        self._redis_url = redis_url
        self._tracker = tracker
        self._client = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        import redis.asyncio as redis  # noqa: PLC0415 — lazy

        self._client = redis.from_url(self._redis_url)
        pubsub = self._client.pubsub()
        await pubsub.subscribe(self.channel)
        self._task = asyncio.create_task(self._run(pubsub))
        _log.info("speaker_subscribed", channel=self.channel)

    async def _run(self, pubsub) -> None:  # noqa: ANN001
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    data = json.loads(msg["data"])
                    self._tracker.on_event(data["speaker"], data["event"], int(data.get("ts", 0)))
                except Exception as exc:  # noqa: BLE001 - never die on a bad event
                    _log.warning("speaker_event_bad", error=str(exc))
        except asyncio.CancelledError:
            raise

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._client is not None:
            with contextlib.suppress(Exception):
                await self._client.aclose()
            self._client = None
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `python -m pytest tests/bridge/test_speaker_events.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit.**

```bash
git add src/stewardai/bridge/speaker_events.py tests/bridge/test_speaker_events.py
git commit -m "feat(meeting): speaker tracker + redis subscriber for diarization"
```

---

### Task 3: MeetingAgent labels each turn with the active speaker

**Files:**
- Modify: `src/stewardai/agent/assembly.py` (add `MeetingAgent`, a `build_meeting_agent(tracker, transcript)` factory, and `_MEETING_SYSTEM`)
- Test: `tests/agent/test_meeting_agent.py`

**Interfaces:**
- Consumes: `SpeakerTracker` (Task 2).
- Produces:
  - `_MEETING_SYSTEM: str` (decide prompt).
  - `build_meeting_agent(settings, *, tracker, transcript)` returning a livekit `Agent` subclass instance whose `on_user_turn_completed(turn_ctx, new_message)` prepends `"[<name>]: "` to the message text and appends the labeled line to `transcript` (a `list[str]`).
  - Labeling helper `label_text(tracker, text) -> str` (pure, testable without livekit).

- [ ] **Step 1: Write the failing test for the pure labeler.**

```python
# tests/agent/test_meeting_agent.py
from stewardai.agent.assembly import label_text
from stewardai.bridge.speaker_events import SpeakerTracker


def test_label_text_prefixes_active_speaker():
    t = SpeakerTracker()
    t.on_event("Anique", "start", 1)
    assert label_text(t, "ship it friday") == "[Anique]: ship it friday"


def test_label_text_falls_back_when_unknown():
    t = SpeakerTracker()
    assert label_text(t, "hello") == "[Speaker]: hello"
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `python -m pytest tests/agent/test_meeting_agent.py -v`
Expected: FAIL with `ImportError: cannot import name 'label_text'`.

- [ ] **Step 3: Implement `label_text`, `_MEETING_SYSTEM`, and `build_meeting_agent`** in `agent/assembly.py`:

```python
def label_text(tracker, text: str) -> str:  # noqa: ANN001 - SpeakerTracker (duck-typed)
    name = tracker.current_speaker() if tracker is not None else None
    return f"[{name}]: {text}" if name else f"[Speaker]: {text}"


_MEETING_SYSTEM = (
    "You are Steward, an assistant participating in a live multi-person meeting. "
    "You receive a running transcript where each line is prefixed with the "
    "speaker's name in brackets, e.g. '[Anique]: ...'. On each turn decide whether "
    "to speak.\n"
    "- Call speak ONLY when (a) someone directly addresses you by name (\"Steward\") "
    "or clearly asks you something, OR (b) you notice a MATERIAL discrepancy: "
    "something just said contradicts a decision or fact stated earlier in THIS "
    "meeting. When flagging a discrepancy, name both sides (e.g. \"Earlier Anique "
    "said Friday, but Sarah just said Monday — which is it?\"). Keep it to one or "
    "two spoken sentences.\n"
    "- Otherwise call stay_silent. Do NOT chime in on normal discussion, agreement, "
    "small talk, or minor wording differences. Silence is the default.\n"
    "- Never read the bracketed name prefixes aloud; they are only for your context."
)


def build_meeting_agent(settings=None, *, tracker=None, transcript=None):  # noqa: ANN001
    """Agent that labels each finalized user turn with the active speaker and
    records it to ``transcript`` (a list[str]) for later summarization."""
    from livekit.agents import Agent  # type: ignore

    class MeetingAgent(Agent):  # type: ignore[misc, valid-type]
        def __init__(self) -> None:
            super().__init__(instructions=_MEETING_SYSTEM)
            self._tracker = tracker
            self._transcript = transcript if transcript is not None else []

        async def on_user_turn_completed(self, turn_ctx, new_message) -> None:  # noqa: ANN001
            # Prepend the active speaker's name so the decide LLM sees "[Name]: ..."
            raw = getattr(new_message, "text_content", None) or ""
            if raw:
                labeled = label_text(self._tracker, raw)
                with contextlib.suppress(Exception):
                    new_message.content = [labeled]
                self._transcript.append(labeled)

    return MeetingAgent()
```

(`contextlib` is already imported in `assembly.py`; if not, add `import contextlib`.)

- [ ] **Step 4: Run the test to verify it passes.**

Run: `python -m pytest tests/agent/test_meeting_agent.py -v`
Expected: PASS (2 passed). (The livekit-dependent `build_meeting_agent` is not exercised here — the pure `label_text` is.)

- [ ] **Step 5: Commit.**

```bash
git add src/stewardai/agent/assembly.py tests/agent/test_meeting_agent.py
git commit -m "feat(meeting): MeetingAgent labels turns by speaker + records transcript"
```

> **Verify-on-box note:** confirm the livekit-agents 1.6.4 `Agent.on_user_turn_completed(self, turn_ctx, new_message)` signature and that setting `new_message.content = [str]` is honored before the LLM node runs (it is the documented hook for augmenting the user turn). If the attribute differs, adjust the setter only — the labeling logic is unchanged.

---

### Task 4: Wire diarization + gated decide into the meeting runner

**Files:**
- Modify: `src/stewardai/agent/meeting_runner.py`

**Interfaces:**
- Consumes: `SpeakerTracker`, `SpeakerSubscriber` (Task 2); `build_meeting_agent`, `_MEETING_SYSTEM` (Task 3); `build_session(..., gated=True)` (existing).

- [ ] **Step 1: Build the tracker, subscriber, transcript, and gated session.** In `run_meeting`, replace the agent/session construction:

```python
from stewardai.bridge.speaker_events import SpeakerSubscriber, SpeakerTracker
from stewardai.agent.assembly import build_meeting_agent  # add to existing import line

tracker = SpeakerTracker()
transcript: list[str] = []
llm_backend = make_llm(s)
# decide() needs the committed turn, not partials -> force preemptive off when gated.
session = build_session(
    s, stt_backend=None, llm_backend=llm_backend, tts_backend=None, gated=True
)
agent = build_meeting_agent(s, tracker=tracker, transcript=transcript)
```

Add the preemptive guard inside `build_session` (Task 4 Step 2) so gated never runs preemptive.

- [ ] **Step 2: Force preemptive off when gated** in `agent/assembly.py` `build_session`, where preemptive is set:

```python
if s.preemptive_generation and not gated:
    kwargs["preemptive_generation"] = True
```

- [ ] **Step 3: Start the speaker subscriber and wire mic-on.** After `await session.start(agent=agent)` and before the pump/feed tasks:

```python
speaker_sub = SpeakerSubscriber(s.redis_url, s.vexa_meeting_id or "unknown", tracker)
with contextlib.suppress(Exception):
    await speaker_sub.start()
```

Add `await speaker_sub.aclose()` to the `finally` cleanup block (alongside the existing `control.aclose()`).

- [ ] **Step 4: Run the existing pipeline tests to confirm nothing broke.**

Run: `python -m pytest tests/agent tests/pipeline -q`
Expected: PASS (no regressions; gated path is exercised by existing assembly tests).

- [ ] **Step 5: Live smoke (manual).** Restart the meeting agent, join 2 accounts, confirm in `/tmp/steward-agent.log`: `speaker_subscribed`, `llm_gated_decide speak=false` during normal chat, and `speak=true` only when addressed. Confirm decide context lines are labeled (add a temporary debug log of `messages[-1]` if needed, then remove).

- [ ] **Step 6: Commit.**

```bash
git add src/stewardai/agent/meeting_runner.py src/stewardai/agent/assembly.py
git commit -m "feat(meeting): gated decide + named diarization wired into runner"
```

---

### Task 5: Summary + action-items artifact

**Files:**
- Create: `src/stewardai/agent/summary.py`
- Test: `tests/agent/test_summary.py`
- Modify: `src/stewardai/agent/meeting_runner.py` (call at session close)

**Interfaces:**
- Consumes: `transcript: list[str]` (Task 3); `LLMBackend.complete` (existing).
- Produces:
  - `async def generate_summary(llm, transcript: list[str]) -> dict` returning `{"tldr": str, "decisions": [str], "action_items": [{"owner": str, "task": str, "due": str|None}], "discrepancies": [str]}` (parsed from a JSON-instructed LLM call).
  - `def write_summary(meeting_id: str, summary: dict, out_dir: str = "evals/out") -> tuple[str, str]` writing `meeting-<id>-summary.md` + `.json`, returning both paths.

- [ ] **Step 1: Write the failing test (mock LLM, no network).**

```python
# tests/agent/test_summary.py
import json
import pytest
from stewardai.agent.summary import generate_summary, write_summary


class _FakeLLM:
    name = "fake"
    async def complete(self, messages, *, system=None, temperature=0.4):
        yield json.dumps({
            "tldr": "Planned v2 launch.",
            "decisions": ["Launch moved to Monday"],
            "action_items": [{"owner": "Sarah", "task": "test payments migration", "due": "Wed"}],
            "discrepancies": ["Friday vs Monday launch date"],
        })


@pytest.mark.asyncio
async def test_generate_summary_parses_json():
    out = await generate_summary(_FakeLLM(), ["[Anique]: ship friday", "[Sarah]: I thought monday"])
    assert out["action_items"][0]["owner"] == "Sarah"
    assert "Monday" in out["decisions"][0]


def test_write_summary_creates_files(tmp_path):
    summary = {"tldr": "x", "decisions": ["d"], "action_items": [], "discrepancies": []}
    md, js = write_summary("99", summary, out_dir=str(tmp_path))
    assert md.endswith("meeting-99-summary.md") and js.endswith("meeting-99-summary.json")
    assert "## Action items" in open(md).read()
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `python -m pytest tests/agent/test_summary.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `summary.py`.**

```python
# src/stewardai/agent/summary.py
"""Generate a meeting summary + action items from a speaker-labeled transcript."""
from __future__ import annotations

import json
import os

from stewardai.common.audio import Message
from stewardai.common.logging import get_logger

_log = get_logger("agent.summary")

_SUMMARY_SYSTEM = (
    "You summarize a meeting from a speaker-labeled transcript (lines look like "
    "'[Anique]: ...'). Respond with ONLY a JSON object, no prose, with keys: "
    "tldr (string, 2-3 sentences), decisions (array of strings), action_items "
    "(array of {owner, task, due} where due may be null), discrepancies (array of "
    "strings describing contradictions raised). Attribute action items to the "
    "speaker responsible by name."
)


async def generate_summary(llm, transcript: list[str]) -> dict:  # noqa: ANN001
    body = "\n".join(transcript) if transcript else "(no transcript captured)"
    chunks = []
    async for delta in llm.complete(
        [Message(role="user", content=body)], system=_SUMMARY_SYSTEM, temperature=0.2
    ):
        if delta:
            chunks.append(delta)
    raw = "".join(chunks).strip()
    if raw.startswith("```"):  # strip markdown fences if the model adds them
        raw = raw.strip("`")
        raw = raw[raw.find("{"):]
    try:
        return json.loads(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        _log.warning("summary_parse_failed", error=str(exc))
        return {"tldr": raw[:500], "decisions": [], "action_items": [], "discrepancies": []}


def write_summary(meeting_id: str, summary: dict, out_dir: str = "evals/out") -> tuple[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    js = os.path.join(out_dir, f"meeting-{meeting_id}-summary.json")
    md = os.path.join(out_dir, f"meeting-{meeting_id}-summary.md")
    with open(js, "w") as f:
        json.dump(summary, f, indent=2)
    lines = [
        "# Meeting Summary",
        f"TL;DR: {summary.get('tldr', '')}",
        "\n## Decisions",
        *[f"- {d}" for d in summary.get("decisions", [])],
        "\n## Action items",
        *[f"- {a.get('owner')} → {a.get('task')}"
          + (f" ({a['due']})" if a.get("due") else "")
          for a in summary.get("action_items", [])],
        "\n## Open questions / discrepancies",
        *[f"- {d}" for d in summary.get("discrepancies", [])],
    ]
    with open(md, "w") as f:
        f.write("\n".join(lines) + "\n")
    _log.info("summary_written", meeting=meeting_id, md=md, json=js)
    return md, js
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `python -m pytest tests/agent/test_summary.py -v`
Expected: PASS (2 passed). (Requires `pytest-asyncio`; it is already used in the repo — see `tests/`.)

- [ ] **Step 5: Call it at meeting end** in `meeting_runner.py` `finally` block (after cancelling pump/feed, before closing the session is fine — transcript is already populated):

```python
with contextlib.suppress(Exception):
    summary = await generate_summary(llm_backend, transcript)
    write_summary(s.vexa_meeting_id or "unknown", summary)
```

- [ ] **Step 6: Commit.**

```bash
git add src/stewardai/agent/summary.py tests/agent/test_summary.py src/stewardai/agent/meeting_runner.py
git commit -m "feat(meeting): summary + action-items artifact at meeting end"
```

---

### Task 6: Scripted test fixture + scorer

**Files:**
- Create: `evals/meetings/sprint_planning.expected.json` (the scoring target derived from the spec's script)
- Create: `scripts/score_meeting.py`
- Test: `tests/test_score_meeting.py`

**Interfaces:**
- Consumes: a meeting summary `.json` (Task 5) + an expected `.json`.
- Produces: `def score(summary: dict, expected: dict) -> dict` returning `{"action_item_recall": float, "action_item_precision": float, "decision_hit": bool, "discrepancy_hit": bool}` (matching is case-insensitive substring on `owner` + keyword overlap on `task`).

- [ ] **Step 1: Create the expected fixture** (`evals/meetings/sprint_planning.expected.json`):

```json
{
  "decisions_keywords": [["launch", "monday"]],
  "action_items": [
    {"owner": "Sarah", "keywords": ["payments", "migration"]},
    {"owner": "Priya", "keywords": ["mockups"]},
    {"owner": "Marcus", "keywords": ["error", "states"]},
    {"owner": "Priya", "keywords": ["announcement"]}
  ],
  "discrepancy_keywords": [["friday", "monday"]]
}
```

- [ ] **Step 2: Write the failing test.**

```python
# tests/test_score_meeting.py
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "score_meeting", pathlib.Path("scripts/score_meeting.py"))
sm = importlib.util.module_from_spec(spec); spec.loader.exec_module(sm)


def test_score_full_match():
    expected = {
        "decisions_keywords": [["launch", "monday"]],
        "action_items": [{"owner": "Sarah", "keywords": ["payments", "migration"]}],
        "discrepancy_keywords": [["friday", "monday"]],
    }
    summary = {
        "decisions": ["Launch moved to Monday"],
        "action_items": [{"owner": "Sarah", "task": "test the payments migration", "due": "Wed"}],
        "discrepancies": ["Friday vs Monday launch date"],
    }
    r = sm.score(summary, expected)
    assert r["action_item_recall"] == 1.0
    assert r["decision_hit"] is True
    assert r["discrepancy_hit"] is True
```

- [ ] **Step 3: Run it to verify it fails.**

Run: `python -m pytest tests/test_score_meeting.py -v`
Expected: FAIL (`score_meeting.py` not found / no `score`).

- [ ] **Step 4: Implement `scripts/score_meeting.py`.**

```python
#!/usr/bin/env python3
"""Score a meeting summary JSON against an expected-keywords JSON.

Usage: python scripts/score_meeting.py <summary.json> <expected.json>
"""
from __future__ import annotations

import json
import sys


def _has_all(text: str, kws: list[str]) -> bool:
    t = text.lower()
    return all(k.lower() in t for k in kws)


def score(summary: dict, expected: dict) -> dict:
    # action items: recall = fraction of expected items matched by owner + task keywords
    exp_items = expected.get("action_items", [])
    got_items = summary.get("action_items", [])
    matched = 0
    for ei in exp_items:
        for gi in got_items:
            owner_ok = ei["owner"].lower() in str(gi.get("owner", "")).lower()
            task_ok = _has_all(str(gi.get("task", "")), ei["keywords"])
            if owner_ok and task_ok:
                matched += 1
                break
    recall = matched / len(exp_items) if exp_items else 1.0
    precision = matched / len(got_items) if got_items else 0.0
    decisions_text = " ".join(summary.get("decisions", []))
    decision_hit = any(_has_all(decisions_text, kws) for kws in expected.get("decisions_keywords", []))
    disc_text = " ".join(summary.get("discrepancies", []))
    discrepancy_hit = any(_has_all(disc_text, kws) for kws in expected.get("discrepancy_keywords", []))
    return {
        "action_item_recall": round(recall, 3),
        "action_item_precision": round(precision, 3),
        "decision_hit": decision_hit,
        "discrepancy_hit": discrepancy_hit,
    }


def main() -> None:
    summary = json.load(open(sys.argv[1]))
    expected = json.load(open(sys.argv[2]))
    print(json.dumps(score(summary, expected), indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `python -m pytest tests/test_score_meeting.py -v`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit.**

```bash
git add evals/meetings/sprint_planning.expected.json scripts/score_meeting.py tests/test_score_meeting.py
git commit -m "feat(eval): scripted meeting fixture + summary scorer"
```

---

## End-to-end validation (after all tasks)

1. Rebuild + redeploy the `:steward` bot image; rejoin the meeting (existing flow), agent on `gated=True`.
2. Run the **scripted sprint-planning meeting** with 4 accounts (script in the spec).
3. Confirm live: speaker-labeled decide context, silence during discussion, interjection on the Friday/Monday discrepancy, a spoken summary on "Steward, summarize."
4. On bot leave, confirm `evals/out/meeting-<id>-summary.{md,json}` written.
5. Score: `python scripts/score_meeting.py evals/out/meeting-<id>-summary.json evals/meetings/sprint_planning.expected.json` → expect `action_item_recall` high, `decision_hit` and `discrepancy_hit` true.

## Self-review notes (spec coverage)

- Named diarization → Tasks 1–4. Decide policy (addressed + discrepancy) → Tasks 3–4. Summary + action items → Task 5. Scripted test + scoring → Task 6. Fallback (no speaker events → `[Speaker]:`) → Task 3 `label_text`. Preemptive-vs-decide conflict → Task 4 guard. Datasets (AMI/QMSum) are offline/later and intentionally not implemented in v1 (live scripted test is primary).
