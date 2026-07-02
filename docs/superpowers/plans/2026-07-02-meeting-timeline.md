# Meeting Timeline + Attributed Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the meeting-detail page into an AI-chatbot-style chat/timeline where Steward's actions are attributed to the transcript utterance that produced them (via a stable `source_seq` line index) and shown inline as collapsible step cards, plus a consolidated "Actions & tasks" section.

**Architecture:** The Python agent already produces `agent_actions` and `action_items` from an LLM pass over the labeled transcript. We number the transcript lines in those prompts, have the LLM return a `source_line` index per item, and persist it as `source_seq`. The portal joins `action.source_seq == transcript_segments.seq` to render actions inline; unmatched/null actions fall to a consolidated section (graceful degradation for old meetings).

**Tech Stack:** Python 3.11 (agent, pytest/ruff), Supabase/Postgres (migration), Next.js 14 App Router + TypeScript + Jest + Tailwind (portal).

## Global Constraints

- Python work runs from repo root `/Users/aniquesabir/projects/stewardai`; portal work runs from `portal/`.
- Python tests: `python -m pytest tests/agent/<file> -v`; lint: `ruff check <files>`. Portal tests: `npm test` (Jest, ts-jest, node env, alias `^@/(.*)$`→`src/$1`).
- Link key is `source_seq` (nullable integer), matching `transcript_segments.seq`. NEVER guess a `source_seq` — emit `null`/`None` when the source line is unknown.
- Transcript lines are numbered **0-based**, identical to `enumerate(transcript)`, in every prompt that requests `source_line`.
- Portal reads use the RLS client `createServerClient()` (per the auth-hardening invariant); the detail page already does.
- Reuse, don't duplicate: the inline expansion and the consolidated section share one `ActionStepCard`.
- Graceful degradation: null `source_seq` → no inline strip, appears only in the consolidated section.
- Commit after each task. Portal type: `AgentAction` and util signatures below are the contract across tasks.

---

### Task 1: Migration — add `source_seq`

**Files:**
- Create: `portal/supabase/migrations/0007_action_source_seq.sql`

**Interfaces:**
- Produces: nullable `source_seq integer` columns on `public.agent_actions` and `public.action_items`.

- [ ] **Step 1: Write the migration**

Create `portal/supabase/migrations/0007_action_source_seq.sql`:

```sql
-- Attribute an agent action / action item to the transcript line (seq) that
-- produced it. Nullable: pre-existing rows and unattributable items stay null
-- and render only in the consolidated "Actions & tasks" section.
alter table public.agent_actions add column if not exists source_seq integer;
alter table public.action_items  add column if not exists source_seq integer;
```

- [ ] **Step 2: Verify SQL is well-formed**

Run: `grep -c "add column if not exists source_seq" portal/supabase/migrations/0007_action_source_seq.sql`
Expected: `2`

(Apply against the Supabase project during Task 11 manual verification — this repo has no local DB harness; migrations are applied via the dashboard/CLI per `supabase/config.toml`.)

- [ ] **Step 3: Commit**

```bash
git add portal/supabase/migrations/0007_action_source_seq.sql
git commit -m "feat(db): add source_seq to agent_actions and action_items"
```

---

### Task 2: `AgentActionsWriter.insert` accepts `source_seq`

**Files:**
- Modify: `src/stewardai/agent/actions.py` (the `AgentActionsWriter.insert` method)
- Test: `tests/agent/test_supabase_writer.py`

**Interfaces:**
- Produces: `AgentActionsWriter.insert(..., source_seq: int | None = None)` — includes `source_seq` in the inserted row **only when not None**.

- [ ] **Step 1: Write the failing test**

Add to `tests/agent/test_supabase_writer.py` (create if the writer isn't covered there; otherwise append). This uses a fake client that records the inserted row:

```python
import pytest
from stewardai.agent.actions import AgentActionsWriter


class _FakeTable:
    def __init__(self, sink): self._sink = sink
    def insert(self, row):
        self._sink["row"] = row
        return self
    async def execute(self):
        class R: data = [{"id": "row-1"}]
        return R()


class _FakeClient:
    def __init__(self): self.sink = {}
    def table(self, name): return _FakeTable(self.sink)


@pytest.mark.asyncio
async def test_insert_includes_source_seq_when_provided():
    client = _FakeClient()
    w = AgentActionsWriter(meeting_id="m1", user_id="u1", client=client)
    await w.insert(source="directed", toolkit="gmail", action_slug="GMAIL_SEND_EMAIL",
                   args={}, risk="low", title="Send", state="done", source_seq=3)
    assert client.sink["row"]["source_seq"] == 3


@pytest.mark.asyncio
async def test_insert_omits_source_seq_when_none():
    client = _FakeClient()
    w = AgentActionsWriter(meeting_id="m1", user_id="u1", client=client)
    await w.insert(source="directed", toolkit="gmail", action_slug="GMAIL_SEND_EMAIL",
                   args={}, risk="low", title="Send", state="done")
    assert "source_seq" not in client.sink["row"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/agent/test_supabase_writer.py -k source_seq -v`
Expected: FAIL — `insert()` got an unexpected keyword argument `source_seq`.

- [ ] **Step 3: Implement**

In `src/stewardai/agent/actions.py`, add the parameter to `AgentActionsWriter.insert` (after `error`):

```python
    async def insert(
        self,
        *,
        source: str,
        toolkit: str,
        action_slug: str,
        args: dict[str, Any],
        risk: str,
        title: str,
        state: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        source_seq: int | None = None,
    ) -> str | None:
```

and inside, after the base `row` dict is built, before the `result`/`error` blocks:

```python
        if source_seq is not None:
            row["source_seq"] = source_seq
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/agent/test_supabase_writer.py -k source_seq -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/actions.py tests/agent/test_supabase_writer.py
git commit -m "feat(agent): AgentActionsWriter.insert accepts source_seq"
```

---

### Task 3: Extraction emits `source_line` → `source_seq`

**Files:**
- Modify: `src/stewardai/agent/actions.py` (`_EXTRACT_SYSTEM`, `_build_extraction_prompt`, `extract_post_meeting_actions`)
- Test: `tests/agent/test_actions.py`

**Interfaces:**
- Consumes: `AgentActionsWriter.insert(..., source_seq=...)` (Task 2).
- Produces: each extracted item may carry `source_line` (0-based int); it is coerced and passed as `source_seq` to `writer.insert`.

- [ ] **Step 1: Write the failing test**

Add to `tests/agent/test_actions.py`. It checks the prompt numbers lines and that a returned `source_line` reaches the writer. Use the existing test patterns in that file for the fake LLM / composio service (match their fixtures); the assertions to add:

```python
def test_extraction_prompt_numbers_transcript_lines():
    from stewardai.agent.actions import _build_extraction_prompt
    prompt = _build_extraction_prompt(
        tools=[{"function": {"name": "GMAIL_SEND_EMAIL", "description": "d", "parameters": {}}}],
        transcript=["[Anique]: do X", "[Sam]: ok"],
        now_iso="2026-07-02T10:00:00",
        timezone="UTC",
    )
    assert "0: [Anique]: do X" in prompt
    assert "1: [Sam]: ok" in prompt
```

And a coercion helper test:

```python
def test_coerce_source_line():
    from stewardai.agent.actions import _coerce_source_line
    assert _coerce_source_line(3) == 3
    assert _coerce_source_line("2") == 2
    assert _coerce_source_line("nope") is None
    assert _coerce_source_line(None) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/agent/test_actions.py -k "source_line or numbers_transcript" -v`
Expected: FAIL — `_coerce_source_line` not defined / line numbering absent.

- [ ] **Step 3: Implement**

In `src/stewardai/agent/actions.py`:

Add to `_EXTRACT_SYSTEM` object-shape description (after the `args` line):
```python
    "  source_line: the 0-based index of the transcript line that motivated this "
    "item (an integer shown as 'N:' at the start of each line below), or null if none\n"
```

In `_build_extraction_prompt`, change the transcript body to number lines:
```python
    body = (
        "\n".join(f"{i}: {line}" for i, line in enumerate(transcript))
        if transcript
        else "(no transcript captured)"
    )
```

Add a coercion helper near `_now_in_tz`:
```python
def _coerce_source_line(value: Any) -> int | None:
    """Accept an int or int-like string transcript index; else None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None
```

In `extract_post_meeting_actions`, in the per-item loop, read it and pass it through:
```python
        src_line = _coerce_source_line(item.get("source_line"))
        row_id = await writer.insert(
            source=source,
            toolkit=toolkit,
            action_slug=slug,
            args=args,
            risk=risk,
            title=title,
            state=state,
            source_seq=src_line,
        )
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/agent/test_actions.py -k "source_line or numbers_transcript" -v`
Expected: PASS.

- [ ] **Step 5: Run the full actions suite (no regressions)**

Run: `python -m pytest tests/agent/test_actions.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/stewardai/agent/actions.py tests/agent/test_actions.py
git commit -m "feat(agent): extraction attributes actions to source transcript line"
```

---

### Task 4: Summary emits `source_line`; persistence stores `action_items.source_seq`

**Files:**
- Modify: `src/stewardai/agent/summary.py` (`_SUMMARY_SYSTEM`, `generate_summary`)
- Modify: `src/stewardai/agent/persistence.py` (`persist_meeting_artifacts` action_items block; add a coercion)
- Test: `tests/agent/test_summary.py`, `tests/agent/test_persistence.py`

**Interfaces:**
- Produces: summary `action_items` objects gain optional `source_line`; `persist_meeting_artifacts` writes `source_seq` on `action_items` rows when present.

- [ ] **Step 1: Write the failing tests**

Add to `tests/agent/test_summary.py` (numbering in the prompt body — assert via a fake LLM that captures the user message; match the file's existing fake-LLM pattern). Minimal check on the system prompt text:

```python
def test_summary_system_requests_source_line():
    from stewardai.agent.summary import _SUMMARY_SYSTEM
    assert "source_line" in _SUMMARY_SYSTEM
```

Add to `tests/agent/test_persistence.py` a test that a summary action item's `source_line` lands as `source_seq` (use the file's existing fake Supabase client that records inserted rows; assert the action_items insert payload):

```python
@pytest.mark.asyncio
async def test_persist_action_items_writes_source_seq(fake_client):  # reuse existing fixture
    from stewardai.agent.persistence import persist_meeting_artifacts
    summary = {
        "tldr": "t", "decisions": [], "discrepancies": [],
        "action_items": [{"owner": "Anique", "task": "send invite", "due": None, "source_line": 4}],
    }
    await persist_meeting_artifacts(fake_client, "m1", ["[Anique]: send invite"], summary)
    row = fake_client.last_action_items_rows[0]  # adapt to the fixture's recorder
    assert row["source_seq"] == 4
```

(If `tests/agent/test_persistence.py` has no reusable fake client fixture, add a minimal one mirroring Task 2's `_FakeClient` that records `insert` payloads per table.)

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/agent/test_summary.py tests/agent/test_persistence.py -k "source" -v`
Expected: FAIL.

- [ ] **Step 3: Implement summary**

In `src/stewardai/agent/summary.py`, update `_SUMMARY_SYSTEM` action_items clause to:
```python
    "(array of {owner, task, due, source_line} where due may be null and "
    "source_line is the 0-based index of the transcript line that produced the "
    "item — an integer shown as 'N:' at the start of each line — or null)"
```
and number the transcript in `generate_summary`:
```python
    body = (
        "\n".join(f"{i}: {line}" for i, line in enumerate(transcript))
        if transcript
        else "(no transcript captured)"
    )
```
Update the fallback dict return (parse-fail branch) unchanged (still has `action_items: []`).

- [ ] **Step 4: Implement persistence**

In `src/stewardai/agent/persistence.py`, reuse `_coerce_due`'s neighborhood. Add a helper:
```python
def _coerce_seq(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None
```
In the `action_items` build loop, add `source_seq` to each row:
```python
            items.append(
                {
                    "meeting_id": meeting_uuid,
                    "owner": str(a.get("owner") or "").strip() or "Unassigned",
                    "task": task,
                    "due": _coerce_due(a.get("due")),
                    "source_seq": _coerce_seq(a.get("source_line")),
                }
            )
```

- [ ] **Step 5: Run to verify passes**

Run: `python -m pytest tests/agent/test_summary.py tests/agent/test_persistence.py -v`
Expected: all pass.

- [ ] **Step 6: Lint + commit**

```bash
ruff check src/stewardai/agent/summary.py src/stewardai/agent/persistence.py src/stewardai/agent/actions.py
git add src/stewardai/agent/summary.py src/stewardai/agent/persistence.py tests/agent/test_summary.py tests/agent/test_persistence.py
git commit -m "feat(agent): summary + persistence attribute action items to source line"
```

---

### Task 5: `speaker-colors.ts` util

**Files:**
- Create: `portal/src/lib/meetings/speaker-colors.ts`
- Test: `portal/src/lib/__tests__/speaker-colors.test.ts`

**Interfaces:**
- Produces: `speakerColor(name: string): { bg: string; text: string }` — deterministic Tailwind class pair; same input → same output.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/__tests__/speaker-colors.test.ts`:

```ts
import { speakerColor } from "@/lib/meetings/speaker-colors";

describe("speakerColor", () => {
  it("is deterministic for the same name", () => {
    expect(speakerColor("Anique")).toEqual(speakerColor("Anique"));
  });
  it("returns non-empty bg and text classes", () => {
    const c = speakerColor("Sam");
    expect(c.bg).toMatch(/\S/);
    expect(c.text).toMatch(/\S/);
  });
  it("maps different names to (usually) different palette slots", () => {
    const names = ["A", "B", "C", "D", "E"];
    const slots = new Set(names.map((n) => speakerColor(n).bg));
    expect(slots.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npm test -- speaker-colors`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `portal/src/lib/meetings/speaker-colors.ts`:

```ts
// Deterministic speaker → color mapping for timeline avatars.
const PALETTE: { bg: string; text: string }[] = [
  { bg: "bg-sky-500/15", text: "text-sky-400" },
  { bg: "bg-violet-500/15", text: "text-violet-400" },
  { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  { bg: "bg-amber-500/15", text: "text-amber-400" },
  { bg: "bg-rose-500/15", text: "text-rose-400" },
  { bg: "bg-cyan-500/15", text: "text-cyan-400" },
];

export function speakerColor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npm test -- speaker-colors`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/meetings/speaker-colors.ts portal/src/lib/__tests__/speaker-colors.test.ts
git commit -m "feat(meetings): deterministic speaker color util"
```

---

### Task 6: `timeline.ts` util (attach actions by seq)

**Files:**
- Create: `portal/src/lib/meetings/timeline.ts`
- Test: `portal/src/lib/__tests__/timeline.test.ts`

**Interfaces:**
- Produces:
  - types `Segment = { id: string; seq: number; speaker: string; text: string; created_at?: string }`, `TimelineAction = { id: string; source_seq: number | null; toolkit: string | null; title: string | null; state: string; action_slug: string | null; args: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null; risk: string | null }`, `TimelineItem = { segment: Segment; actions: TimelineAction[] }`.
  - `buildTimeline(segments: Segment[], actions: TimelineAction[]): { items: TimelineItem[]; unattached: TimelineAction[] }` — items ordered by `seq`; each action with a matching `source_seq` attaches to that segment; actions with null or non-matching `source_seq` go to `unattached`.

- [ ] **Step 1: Write the failing test**

Create `portal/src/lib/__tests__/timeline.test.ts`:

```ts
import { buildTimeline } from "@/lib/meetings/timeline";

const seg = (seq: number, speaker = "A", text = "x") => ({ id: `s${seq}`, seq, speaker, text });
const act = (id: string, source_seq: number | null) => ({
  id, source_seq, toolkit: "gmail", title: "t", state: "proposed",
  action_slug: "GMAIL_SEND_EMAIL", args: {}, result: null, error: null, risk: "low",
});

describe("buildTimeline", () => {
  it("orders items by seq", () => {
    const { items } = buildTimeline([seg(2), seg(0), seg(1)], []);
    expect(items.map((i) => i.segment.seq)).toEqual([0, 1, 2]);
  });
  it("attaches an action to the segment with matching seq", () => {
    const { items, unattached } = buildTimeline([seg(0), seg(1)], [act("a", 1)]);
    expect(items[1].actions.map((a) => a.id)).toEqual(["a"]);
    expect(items[0].actions).toEqual([]);
    expect(unattached).toEqual([]);
  });
  it("sends null source_seq to unattached", () => {
    const { unattached } = buildTimeline([seg(0)], [act("a", null)]);
    expect(unattached.map((a) => a.id)).toEqual(["a"]);
  });
  it("sends non-matching source_seq to unattached", () => {
    const { items, unattached } = buildTimeline([seg(0)], [act("a", 5)]);
    expect(items[0].actions).toEqual([]);
    expect(unattached.map((a) => a.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npm test -- timeline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `portal/src/lib/meetings/timeline.ts`:

```ts
export type Segment = {
  id: string; seq: number; speaker: string; text: string; created_at?: string;
};
export type TimelineAction = {
  id: string; source_seq: number | null; toolkit: string | null; title: string | null;
  state: string; action_slug: string | null; args: Record<string, unknown>;
  result: Record<string, unknown> | null; error: string | null; risk: string | null;
};
export type TimelineItem = { segment: Segment; actions: TimelineAction[] };

export function buildTimeline(
  segments: Segment[],
  actions: TimelineAction[],
): { items: TimelineItem[]; unattached: TimelineAction[] } {
  const ordered = [...segments].sort((a, b) => a.seq - b.seq);
  const bySeq = new Map<number, TimelineItem>();
  const items: TimelineItem[] = ordered.map((segment) => {
    const item = { segment, actions: [] as TimelineAction[] };
    bySeq.set(segment.seq, item);
    return item;
  });
  const unattached: TimelineAction[] = [];
  for (const action of actions) {
    const target = action.source_seq != null ? bySeq.get(action.source_seq) : undefined;
    if (target) target.actions.push(action);
    else unattached.push(action);
  }
  return { items, unattached };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npm test -- timeline`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/meetings/timeline.ts portal/src/lib/__tests__/timeline.test.ts
git commit -m "feat(meetings): timeline builder attaches actions by source_seq"
```

---

### Task 7: Extract shared `ActionStepCard`

**Files:**
- Create: `portal/src/components/meetings/ActionStepCard.tsx`
- Modify: `portal/src/components/meetings/AgentActionsPanel.tsx`

**Interfaces:**
- Produces (exported from `ActionStepCard.tsx`): the `AgentAction` type; `ToolkitIcon`; `StateBadge`; `ActionStepCard({ action, meetingId, onMutate }: { action: AgentAction; meetingId: string; onMutate: () => void })` — the per-action card with approve/dismiss/edit (the current `ActionRow`).
- `AgentActionsPanel` imports these instead of defining them.

- [ ] **Step 1: Move code into the new file**

Create `portal/src/components/meetings/ActionStepCard.tsx` with `"use client";`, moving the `AgentAction` type, `ToolkitIcon`, `StateBadge`, and the current `ActionRow` (renamed `export function ActionStepCard`) verbatim from `AgentActionsPanel.tsx`, plus their imports (`GmailIcon`…`SlackIcon`, `Badge`, `Button`, `Input`, `useState`). Export `AgentAction`, `ToolkitIcon`, `StateBadge`, `ActionStepCard`.

- [ ] **Step 2: Reduce `AgentActionsPanel.tsx` to a list**

Rewrite `AgentActionsPanel.tsx` to import from `ActionStepCard` and keep only `STATE_ORDER` + the list component:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { ActionStepCard, type AgentAction } from "./ActionStepCard";

const STATE_ORDER: Record<AgentAction["state"], number> = {
  proposed: 0, approved: 1, running: 2, done: 3, failed: 4,
};

export function AgentActionsPanel({
  actions: initial, meetingId,
}: { actions: AgentAction[]; meetingId: string }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const sorted = [...initial].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  if (!sorted.length) {
    return (
      <p className="text-muted-foreground">
        No actions proposed yet. Steward will suggest actions after the meeting.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {sorted.map((action) => (
        <ActionStepCard key={action.id} action={action} meetingId={meetingId} onMutate={refresh} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: zero errors (no other file imported `ActionRow`/`ToolkitIcon` from `AgentActionsPanel` — verify with `grep -rn "from \"@/components/meetings/AgentActionsPanel\"" src` shows only type/panel imports).

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/meetings/ActionStepCard.tsx portal/src/components/meetings/AgentActionsPanel.tsx
git commit -m "refactor(meetings): extract shared ActionStepCard from AgentActionsPanel"
```

---

### Task 8: `ActionStepStrip` (collapsed icons + status, expandable)

**Files:**
- Create: `portal/src/components/meetings/ActionStepStrip.tsx`
- Test: `portal/src/lib/__tests__/aggregate-status.test.ts`
- Create: `portal/src/lib/meetings/aggregate-status.ts`

**Interfaces:**
- Consumes: `ActionStepCard`, `ToolkitIcon`, `AgentAction` (Task 7); `TimelineAction` (Task 6).
- Produces:
  - `aggregateStatus(actions: { state: string }[]): { label: string; tone: "amber" | "blue" | "green" | "red" | "muted" }` (pure util).
  - `ActionStepStrip({ actions, meetingId, onMutate }: { actions: AgentAction[]; meetingId: string; onMutate: () => void })` — collapsed by default: toolkit icons + "Steward ran N step(s)" + status pill; expands to numbered `ActionStepCard`s.

- [ ] **Step 1: Write the failing test (aggregate util)**

Create `portal/src/lib/__tests__/aggregate-status.test.ts`:

```ts
import { aggregateStatus } from "@/lib/meetings/aggregate-status";

describe("aggregateStatus", () => {
  it("any proposed → Needs approval", () => {
    expect(aggregateStatus([{ state: "done" }, { state: "proposed" }])).toEqual({ label: "Needs approval", tone: "amber" });
  });
  it("any running (no proposed) → Running…", () => {
    expect(aggregateStatus([{ state: "running" }, { state: "done" }])).toEqual({ label: "Running…", tone: "blue" });
  });
  it("all done → Done", () => {
    expect(aggregateStatus([{ state: "done" }, { state: "done" }])).toEqual({ label: "Done", tone: "green" });
  });
  it("any failed (no proposed/running) → Failed", () => {
    expect(aggregateStatus([{ state: "failed" }, { state: "done" }])).toEqual({ label: "Failed", tone: "red" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd portal && npm test -- aggregate-status`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the util**

Create `portal/src/lib/meetings/aggregate-status.ts`:

```ts
export function aggregateStatus(
  actions: { state: string }[],
): { label: string; tone: "amber" | "blue" | "green" | "red" | "muted" } {
  if (!actions.length) return { label: "", tone: "muted" };
  const states = actions.map((a) => a.state);
  if (states.includes("proposed")) return { label: "Needs approval", tone: "amber" };
  if (states.includes("running") || states.includes("approved")) return { label: "Running…", tone: "blue" };
  if (states.includes("failed")) return { label: "Failed", tone: "red" };
  if (states.every((s) => s === "done")) return { label: "Done", tone: "green" };
  return { label: "", tone: "muted" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd portal && npm test -- aggregate-status`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement the strip component**

Create `portal/src/components/meetings/ActionStepStrip.tsx`:

```tsx
"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ActionStepCard, ToolkitIcon, type AgentAction } from "./ActionStepCard";
import { aggregateStatus } from "@/lib/meetings/aggregate-status";

const TONE: Record<string, string> = {
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  green: "bg-green-500/15 text-green-400 border-green-500/30",
  red: "bg-red-500/15 text-red-400 border-red-500/30",
  muted: "bg-muted text-muted-foreground border-border",
};

export function ActionStepStrip({
  actions, meetingId, onMutate,
}: { actions: AgentAction[]; meetingId: string; onMutate: () => void }) {
  const [open, setOpen] = useState(false);
  if (!actions.length) return null;
  const status = aggregateStatus(actions);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-card"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        <span className="flex items-center gap-1">
          {actions.map((a) => <ToolkitIcon key={a.id} toolkit={a.toolkit} />)}
        </span>
        <span className="font-medium text-foreground">
          Steward ran {actions.length} step{actions.length > 1 ? "s" : ""}
        </span>
        {status.label && (
          <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] ${TONE[status.tone]}`}>
            {status.label}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
          {actions.map((action, i) => (
            <div key={action.id} className="relative">
              <span className="absolute -left-[1.35rem] top-3 text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
              <ActionStepCard action={action} meetingId={meetingId} onMutate={onMutate} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `cd portal && npx tsc --noEmit` → zero errors.
```bash
git add portal/src/lib/meetings/aggregate-status.ts portal/src/lib/__tests__/aggregate-status.test.ts portal/src/components/meetings/ActionStepStrip.tsx
git commit -m "feat(meetings): collapsible ActionStepStrip with tool icons + aggregate status"
```

---

### Task 9: `MeetingTimeline` (client, live poll) + message + avatar

**Files:**
- Create: `portal/src/components/meetings/SpeakerAvatar.tsx`
- Create: `portal/src/components/meetings/MeetingTimeline.tsx`

**Interfaces:**
- Consumes: `buildTimeline`, `Segment`, `TimelineAction` (Task 6); `speakerColor` (Task 5); `ActionStepStrip` (Task 8); `createBrowserClient` from `@/lib/supabase/client`.
- Produces: `SpeakerAvatar({ name }: { name: string })`; `MeetingTimeline({ segments, actions, meetingId, botName, live }: { segments: Segment[]; actions: TimelineAction[]; meetingId: string; botName: string; live: boolean })`.

- [ ] **Step 1: Implement `SpeakerAvatar`**

Create `portal/src/components/meetings/SpeakerAvatar.tsx`:

```tsx
import { speakerColor } from "@/lib/meetings/speaker-colors";

export function SpeakerAvatar({ name }: { name: string }) {
  const c = speakerColor(name);
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      {initials}
    </span>
  );
}
```

- [ ] **Step 2: Implement `MeetingTimeline`**

Create `portal/src/components/meetings/MeetingTimeline.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { buildTimeline, type Segment, type TimelineAction } from "@/lib/meetings/timeline";
import { SpeakerAvatar } from "./SpeakerAvatar";
import { ActionStepStrip } from "./ActionStepStrip";
import type { AgentAction } from "./ActionStepCard";

function clock(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MeetingTimeline({
  segments: initialSegments, actions: initialActions, meetingId, botName, live,
}: {
  segments: Segment[]; actions: TimelineAction[]; meetingId: string; botName: string; live: boolean;
}) {
  const [segments, setSegments] = useState(initialSegments);
  const [actions, setActions] = useState(initialActions);
  const router = useRouter();

  useEffect(() => {
    if (!live) return;
    const supabase = createBrowserClient();
    let cancelled = false;
    async function poll() {
      const [{ data: segs }, { data: acts }] = await Promise.all([
        supabase.from("transcript_segments").select("*").eq("meeting_id", meetingId).order("seq"),
        supabase.from("agent_actions").select("*").eq("meeting_id", meetingId).order("created_at"),
      ]);
      if (cancelled) return;
      if (segs) setSegments(segs as Segment[]);
      if (acts) setActions(acts as TimelineAction[]);
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [live, meetingId]);

  const { items } = buildTimeline(segments, actions);

  if (!items.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {live ? "Transcript will appear here as the meeting proceeds." : "No transcript captured."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {items.map(({ segment, actions: attached }) => {
        const isAgent = segment.speaker.trim().toLowerCase() === botName.trim().toLowerCase();
        return (
          <div key={segment.id} className="flex gap-3">
            <SpeakerAvatar name={segment.speaker} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${isAgent ? "text-primary" : "text-foreground"}`}>
                  {segment.speaker}{isAgent ? " · Steward" : ""}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{clock(segment.created_at)}</span>
              </div>
              <p className={`text-sm leading-relaxed ${isAgent ? "text-foreground/90" : "text-foreground"}`}>
                {segment.text}
              </p>
              <ActionStepStrip
                actions={attached as unknown as AgentAction[]}
                meetingId={meetingId}
                onMutate={() => router.refresh()}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: zero errors. (`TimelineAction` and `AgentAction` share the fields `ActionStepStrip`/`ActionStepCard` read; the cast bridges the two structurally-compatible types.)

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/meetings/SpeakerAvatar.tsx portal/src/components/meetings/MeetingTimeline.tsx
git commit -m "feat(meetings): chat-style MeetingTimeline with inline action strips + live poll"
```

---

### Task 10: Header, Summary, and rewire the detail page

**Files:**
- Create: `portal/src/components/meetings/MeetingHeader.tsx`
- Create: `portal/src/components/meetings/MeetingSummary.tsx`
- Modify: `portal/src/app/app/meetings/[id]/page.tsx`

**Interfaces:**
- Consumes: `MeetingTimeline` (Task 9), `SummaryPanel` (existing), `ActionItemsPanel` (existing), `AgentActionsPanel` (Task 7), `StatusBadge` (existing), `TimelineAction`/`Segment` (Task 6).
- Produces: the new single-scroll detail layout. The page must `select` `source_seq` on `agent_actions` and `action_items`, and pass the bot name.

- [ ] **Step 1: Implement `MeetingHeader`**

Create `portal/src/components/meetings/MeetingHeader.tsx`:

```tsx
import { StatusBadge } from "./StatusBadge";
import Link from "next/link";

export function MeetingHeader({
  title, startTime, endTime, meetUrl, botStatus,
}: { title: string; startTime: string; endTime: string | null; meetUrl: string | null; botStatus: string }) {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : null;
  const mins = end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)) : null;
  return (
    <div className="border-b border-border pb-4">
      <Link href="/app" className="text-xs text-muted-foreground hover:text-foreground">← Meetings</Link>
      <div className="mt-1 flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <StatusBadge status={botStatus} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
        {" · "}
        {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {end ? `–${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
        {mins ? ` · ${mins} min` : ""}
        {meetUrl && (
          <a href={meetUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary hover:underline">Join ↗</a>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Implement `MeetingSummary`**

Create `portal/src/components/meetings/MeetingSummary.tsx`:

```tsx
import { SummaryPanel } from "./SummaryPanel";
import { ActionItemsPanel } from "./ActionItemsPanel";
import { AgentActionsPanel } from "./AgentActionsPanel";

type Summary = { tldr: string; decisions: { text: string }[]; discrepancies: { text: string }[] } | null;
type ActionItem = { id: string; owner: string; task: string; due: string | null; done: boolean };
// AgentAction shape as read from the DB (see ActionStepCard.AgentAction)
type AgentAction = React.ComponentProps<typeof AgentActionsPanel>["actions"][number];

export function MeetingSummary({
  summary, actionItems, agentActions, meetingId,
}: { summary: Summary; actionItems: ActionItem[]; agentActions: AgentAction[]; meetingId: string }) {
  return (
    <section className="space-y-5 rounded-lg border border-border bg-card/50 p-4">
      <SummaryPanel summary={summary} />
      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Actions &amp; tasks</h4>
        <AgentActionsPanel actions={agentActions} meetingId={meetingId} />
        <div className="mt-3">
          <ActionItemsPanel items={actionItems} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Rewrite the detail page**

Replace the body of `portal/src/app/app/meetings/[id]/page.tsx` (keep the guard + RLS reads; drop `Tabs`):

```tsx
import { MeetingHeader } from "@/components/meetings/MeetingHeader";
import { MeetingSummary } from "@/components/meetings/MeetingSummary";
import { MeetingTimeline } from "@/components/meetings/MeetingTimeline";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUserPage();
  const db = createServerClient();

  const { data: meeting } = await db
    .from("meetings").select("*").eq("id", params.id).eq("user_id", user.id).single();
  if (!meeting) notFound();

  const [{ data: segments }, { data: summary }, { data: actionItems }, { data: agentActions }, { data: profile }] =
    await Promise.all([
      db.from("transcript_segments").select("*").eq("meeting_id", params.id).order("seq"),
      db.from("summaries").select("*").eq("meeting_id", params.id).maybeSingle(),
      db.from("action_items").select("*").eq("meeting_id", params.id).order("created_at"),
      db.from("agent_actions").select("*").eq("meeting_id", params.id).eq("user_id", user.id).order("created_at"),
      db.from("profiles").select("bot_name").eq("user_id", user.id).maybeSingle(),
    ]);

  const botName = profile?.bot_name ?? "StewardAI";

  return (
    <div className="space-y-6">
      <MeetingHeader
        title={meeting.title}
        startTime={meeting.start_time}
        endTime={meeting.end_time}
        meetUrl={meeting.meet_url}
        botStatus={meeting.bot_status}
      />
      <MeetingSummary
        summary={summary ?? null}
        actionItems={actionItems ?? []}
        agentActions={agentActions ?? []}
        meetingId={params.id}
      />
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h2>
        <MeetingTimeline
          segments={segments ?? []}
          actions={agentActions ?? []}
          meetingId={params.id}
          botName={botName}
          live={meeting.bot_status === "in_meeting"}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd portal && npx tsc --noEmit`
Expected: zero errors. If `agentActions` rows lack fields required by `AgentAction`, the DB `select("*")` returns them at runtime; the compile-time type comes from the Supabase client generic (untyped here → `any`), so casts aren't needed. If tsc complains about the `MeetingSummary` `AgentAction` prop type, change its `agentActions` prop type to `any[]` is NOT allowed — instead import the `AgentAction` type from `@/components/meetings/ActionStepCard` and use it for the prop.

- [ ] **Step 5: Commit**

```bash
git add "portal/src/app/app/meetings/[id]/page.tsx" portal/src/components/meetings/MeetingHeader.tsx portal/src/components/meetings/MeetingSummary.tsx
git commit -m "feat(meetings): chat/timeline detail page (header + summary + timeline)"
```

---

### Task 11: Final verification

- [ ] **Step 1: Python suite + lint**

Run: `python -m pytest tests/agent/test_actions.py tests/agent/test_summary.py tests/agent/test_persistence.py tests/agent/test_supabase_writer.py -v && ruff check src/stewardai/agent/`
Expected: all pass; ruff clean.

- [ ] **Step 2: Portal tests + build**

Run: `cd portal && npm test && npm run build`
Expected: all Jest suites pass; `next build` compiles with no lint/type errors. **Stop the dev server first** if running (concurrent `.next` writes cause spurious `PageNotFoundError`).

- [ ] **Step 3: Apply migration + manual check**

Apply `0007_action_source_seq.sql` to the Supabase project (dashboard SQL editor or CLI). Then, against a running dev server:
- Open a meeting whose `agent_actions`/`action_items` have `source_seq` set → the originating utterance shows a collapsed strip with the correct tool icon(s) + status; clicking expands to step cards with working Approve/Dismiss.
- Open a meeting with null `source_seq` (any pre-migration meeting) → no inline strips; all actions/tasks appear in the consolidated "Actions & tasks" section. Page renders fully.
- For an `in_meeting` meeting, confirm the timeline live-updates (2s poll).

- [ ] **Step 4: Commit any fixups** (only if needed)

```bash
git add -A portal src && git commit -m "chore(meetings): timeline verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §3.1 `source_seq` link key → Tasks 1–4 (schema + agent population). ✅
- §3.2 migration → Task 1. ✅
- §3.3 agent changes (summary, actions, writer, persistence) → Tasks 2–4. Live-path stamping: deliberately `None` (handler lacks transcript index) — spec §3.3 permits "pass None if not reliably available"; documented, no separate task. ✅
- §3.4 portal UI (header, summary+consolidated, timeline, step strip, reused card, utils, degradation) → Tasks 5–10. ✅
- §4 empty/loading/error → MeetingTimeline empty states + `SummaryPanel`/`ActionItemsPanel` existing empty states (Tasks 9–10). ✅
- §5 testing → per-task tests + Task 11. ✅

**Placeholder scan:** No TBD/TODO; every code step has real code and exact commands. ✅

**Type consistency:** `source_seq`/`source_line` int|None across Tasks 2–4; `buildTimeline`/`Segment`/`TimelineAction` (Task 6) consumed unchanged by Tasks 8–10; `AgentAction`/`ToolkitIcon`/`StateBadge`/`ActionStepCard` defined in Task 7 and imported by Tasks 8–10; `aggregateStatus` tones match `TONE` map. ✅

**Scope honesty:** Live directed actions land in the consolidated section (null `source_seq`) until re-derived by post-meeting extraction; inline attribution is driven by the extraction/summary path. Recurring-series grouping, attendees, and historical backfill are explicitly out of scope.
