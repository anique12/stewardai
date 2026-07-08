# Steward Agentic Chat — Design

**Status:** Approved design (brainstorm complete 2026-07-03). Ready to decompose into plans.

**One-line:** A provider-agnostic, fully agentic chat that reasons, reads your knowledge base, and *acts* — operating StewardAI itself (spaces, tags, filing, action items) and external tools (Composio) — with Claude-Code-style permissions and a professional, answer-first UI.

---

## Problem

Today's **Ask** is single-shot RAG: one question → one retrieval → one synthesized answer. It can't reason across steps, can't take actions, and can't operate the product. Meanwhile the user still does manual housekeeping — filing meetings into spaces, tagging, closing action items — by hand in the portal.

The goal: a chat where the user *tells Steward what they want* — "where are we with Acme, file that meeting, close the reconciliation task, email Priya a recap" — and Steward reasons, pulls from the knowledge base with citations, does the reversible housekeeping automatically, and asks before anything leaves the workspace. **The product becomes agentic**; the manual work disappears.

## Framing (decisions from the brainstorm)

- **One Steward brain, three surfaces.** Voice (in meetings), text **Chat** (portal), and inline **Ask** widgets are front-ends to the same brain: shared tools, shared model layer, shared knowledge base. Chat is the *text twin* of the voice agent.
- **Provider-agnostic is a hard requirement.** The implementation must run on any LLM provider. Default to **Gemini for cost**; keep a hook to **escalate specific turns to Claude** (best agentic quality) when worth it. No provider baked in. (This ruled out the Claude Agent SDK, which is Claude-locked.)
- **Reads *and* acts**, including operating the product itself (not just external services).
- **Claude-Code permission model** — auto for reads and reversible housekeeping (with receipts + undo), approve-with-preview for anything outward-facing or hard to reverse; a per-user allowlist that Steward *learns*.
- **Pure Ask is kept** as a reliable primitive, surfaced as an *inline, scoped* widget (Space/meeting pages) — not a second global search box. Chat is the global destination; its `kb_search` tool *is* that primitive.

## Non-goals (explicitly later, each its own spec when reached)

- Replacing pure Ask (it stays as the inline widget).
- **Dynamic** model self-escalation (a fast model calling a "hand off to strong model" tool). v1 uses **static role-based routing**; dynamic routing is a later optimization.
- Migrating the **voice** agent onto LangGraph (voice keeps its LiveKit + litellm orchestration; it only shares the *tool registry* and model layer).
- Multi-user / shared chats. Chats are per-user.
- A mobile-native client.

---

## Architecture

```
Portal (Next.js /app/chat)                      FastAPI backend (web.app, CX33)
────────────────────────────                    ──────────────────────────────────
 WebSocket  ⇄  /ws/chat  ────────────────────▶  auth: Supabase JWT → user_id
   ▲   send: user_message,                        │
   │         permission_decision,                 ▼
   │         connect_done                     LangGraph agent (per thread)
   │   recv: token, activity, tool_result,     ┌───────────────────────────────┐
   │         citations, permission_request,    │  agent node (LLM: reason /     │
   │         connect_required, done, error     │     answer / choose tools)     │
   │                                           │        │            ▲          │
 renders: right-bubble user / full-width       │        ▼            │          │
 Steward, quiet activity lines, citation       │  tool node ── interrupt() ─────┼─▶ permission / connect
 popovers→transcript, permission + connect     │  (execute)      (pause)        │   (client decides, resume)
 cards, streaming                              └───────────────────────────────┘
                                                    │ model layer: litellm (any provider)
                                                    │ tools: shared registry (KB · product-ops · Composio)
                                                    ▼ checkpointer: Supabase Postgres (threads persist)
```

- **Orchestration: LangGraph.** It provides the four things a bare model call doesn't: the agent **loop**, **human-in-the-loop `interrupt()`** (the permission pause), a **checkpointer** for conversation persistence, and structured **step streaming**.
- **Model layer: litellm.** Provider-agnostic model + tool calls (already used by the voice agent's `chat_with_tools`). LangGraph drives it via `ChatLiteLLM` (or an equivalent thin adapter), preserving "any provider" and per-node model routing.
- **Runtime home:** the existing FastAPI `web.app` on CX33 (same process that serves `/api/ask` and `/pipeline`). A new **WebSocket** endpoint `/ws/chat` — WebSocket because the agent must pause mid-turn and wait for a permission decision (request/response can't).
- **Auth & tenancy:** reuse `web/kb_auth.py` (`user_id_from_bearer`). The verified `user_id` is the only tenant key; every tool is user-scoped; Composio calls use `entity = user.id`. Service-role DB access re-filters by `user_id` (same rule as the KB).

### Model routing (v1: static, role-based)

Pick the model by *job*, all through litellm so any is swappable:

| Role | Default | Why |
|---|---|---|
| Agent reasoning / tool orchestration | `gemini-2.5-pro` | Multi-step tool planning needs a strong model; flash-lite is too weak here |
| Utility (thread title, tool-result summarization) | `gemini-2.5-flash-lite` | Cheap, mechanical |
| Embeddings (kb_search) | `gemini-embedding-001` @ 768 | Existing KB layer |

Config keys: `chat_reasoning_model`, `chat_utility_model` (embeddings reuse `embedding_model`). A **routing hook** — a single function `pick_model(task, difficulty) -> model_id` — lets us escalate a turn to Claude (`claude-*`) later without touching call sites. Provider keys live in env; litellm handles the rest.

---

## The agent loop

A minimal LangGraph graph:

- **`agent` node** — calls the reasoning model with the running message history + the available tool schemas. The model either produces the final answer (streamed) or requests one/more tool calls.
- **`tools` node** — executes requested tools. Before executing a tool whose permission tier requires it, the graph raises **`interrupt()`** with a `permission_request` (or `connect_required`) payload; the loop suspends until the client sends a decision, then resumes.
- Loop back to `agent` with tool results until the model answers with no further tool calls.

**Streaming.** The graph streams typed events to the client as they happen (see Streaming Protocol). Reasoning and tool activity render as *quiet* lines; the answer streams token-by-token.

**Persistence.** The LangGraph **checkpointer** (Supabase Postgres) stores per-thread graph state, so a thread is resumable (including across an interrupt) and survives restarts. Our own `chat_messages` table is the *display* source of truth (below); the checkpointer is loop/resume state.

---

## Tools

All tools live in **one shared registry** (`agent/tools/…`) — defined once, imported by Chat now and reusable by the voice agent later. Each tool declares: name, JSON schema, executor, and a **permission tier**.

**Read** *(auto — no prompt):*
- `kb_search(query, space_id?, entity?, tag?)` — wraps the existing `retrieve`/`answer_question` machinery; returns passages with `meeting_id` + `source_seq` provenance.
- `list_meetings` / `get_meeting`, `list_spaces` (+ facts), `lookup_entity` (a person/company's cross-meeting history), `list_calendar_events`.

**Product ops** *(reversible → auto, with a receipt + Undo):*
- `create_space` / `rename_space` / `archive_space`, `file_meeting`, `add_tag` / `remove_tag`, `complete_action_item` / `reopen_action_item`, `confirm_filing` / `dismiss_filing`.
- These wrap the portal's existing mutation logic (the `/api/spaces`, `/api/meetings/[id]/space`, action-item routes), so behavior stays consistent with the UI. `archive_space` is treated as higher-tier (see below).

**External** *(outward-facing → approve-with-preview):*
- **All Composio tools**, reached via **Composio's tool-router / semantic discovery** — the model can call any tool, but only relevant ones are surfaced per turn (dumping thousands wrecks tool-selection and context). Explicit thin wrappers for the common ones (`send_email`, `create_calendar_event`, `create_notion_page`, `post_slack_message`) for nicer previews.

---

## Permission model (Claude-Code style)

Every side-effecting tool call is gated by a **tier** + a **per-user allowlist**:

| Tier | Examples | Behavior |
|---|---|---|
| **read** | kb_search, list_* | Auto, silent |
| **reversible write** | file_meeting, add_tag, complete_action_item, create_space | **Auto-execute**, shown as a compact receipt line with **Undo** |
| **outward / irreversible** | send_email, post_slack_message, calendar invite others, archive_space, delete | **Pause (`interrupt`)** → show a **preview** → Approve / Reject / **Always allow** |

- **Allowlist.** "Always allow" writes a row to `tool_permissions` (per user, per tool, optionally per scope). Next time, that tool auto-executes. So routine actions become frictionless *after one approval*, while sends/deletes keep asking until deliberately trusted. Reads are never gated.
- **Just-in-time authorization.** When a tool targets a Composio app that isn't connected, its executor returns a **`connect_required`** signal instead of failing. The UI shows a **"Connect [App]"** card (deep-links to Composio OAuth); after the user connects and sends `connect_done`, the loop retries the tool.
- **Never leak tool internals into prose.** The model is instructed never to name tool schemas/JSON/limitations in its spoken/written answer (mirrors the voice agent's `phrase_result` guard). Tool detail lives only in the (collapsed) activity lines.

---

## Data model (new tables, Supabase migration)

RLS own-row on every table; service-role code re-filters by `user_id`.

- **`chat_threads`** — `id, user_id, title, space_id?(scope), created_at, updated_at`. Title auto-generated by the utility model from the first message.
- **`chat_messages`** — `id, thread_id, user_id, role('user'|'assistant'), created_at, seq`, and a `parts` jsonb array of typed parts: `{type:'text', text}`, `{type:'tool_call', name, args, tier, status, result_summary}`, `{type:'citation_group', citations:[{n, meeting_id, source_seq, kind, snippet}]}`, `{type:'permission', tool, preview, decision}`, `{type:'connect', app, resolved}`. This is the **display source of truth** — the portal renders straight from it.
- **`tool_permissions`** — `id, user_id, tool_name, scope?(e.g. app or space), allowed(bool), created_at`. The allowlist. Unique `(user_id, tool_name, scope)`.
- LangGraph's checkpointer tables (its own schema) hold resumable loop state, keyed by `thread_id`.

---

## Surfaces & UX

Design locked via the clickable mockup (`docs/superpowers/` companion artifact; see brainstorm). Principles: **answer loud, machinery whisper, decisions loud.**

- **`/app/chat`** — the primary destination, top of the sidebar nav. Pure **Ask** remains the inline widget on Space/meeting pages (unchanged).
- **Messages:** your messages are **right-aligned soft-grey bubbles**; **Steward is full-width on the left** (needs the width for rich content). Neutral bubble on purpose — teal stays reserved for Steward/actions.
- **Activity (reasoning + tool calls):** **quiet, muted, small-text lines** above the answer, **expandable** on demand (progressive disclosure). Reversible actions show a **receipt + Undo**. Not cards.
- **Answer:** streams token-by-token, **a citation chip on every claim**.
- **Citations:** hover a `[n]` → **popover** with the exact transcript snippet (keyphrase highlighted) + kind (Decision/Risk/…) + meeting · date; click → **open that meeting's transcript, scrolled to and highlighting the line** (uses `meeting_id` + `source_seq`). Plus a **Sources** strip.
- **Decisions stay prominent** — the **Approve-with-preview** card (outward actions) and the **Connect [App]** card (needs-auth) are the only prominent cards on the page.
- **No model badge** — routing is silent.
- **Sidebar:** dark thread rail with persisted, searchable history + New chat. **Composer** with a scope selector (all spaces / this space) and attach.
- Built on the portal's shadcn design language; palette = cool slate neutrals + one **teal** accent (primary/connected/approve), **amber** (needs-auth), **red** (reject).

---

## Streaming protocol (WebSocket `/ws/chat`)

**Client → server:** `user_message{thread_id?, text, scope}`, `permission_decision{call_id, decision: approve|reject|always}`, `connect_done{app}`.

**Server → client:** `thread{id, title}`, `token{delta}`, `activity{kind: reasoning|tool, name, status: started|done|error, summary}`, `tool_result{call_id, summary}`, `citations{groups}`, `permission_request{call_id, tool, preview, tier}`, `connect_required{app, tool}`, `error{message}`, `done`.

The client renders these into the components above; a `permission_request` blocks that turn until the user responds.

---

## Error handling

- **Tool failure** → surfaced as a failed activity line with a short reason; the agent may retry or adjust (LangGraph loop). Never crashes the turn.
- **LLM provider error** → litellm fallbacks / retries (already configured); the routing hook can fail over to another provider.
- **Unconnected app** → `connect_required` card (not an error).
- **Permission left undecided** → the turn stays suspended (thread is resumable via the checkpointer); the user can decide later.
- **Rate/cost** → per-user turn budget/cap (an agentic turn is multi-call); flagged for the plan, not silently unbounded.

## Security & trust

- **Tenant isolation:** `user_id` only from the verified JWT — never from client input; every tool + query user-scoped; Composio entity = `user.id`. Same RLS + re-filter rule as the KB.
- **Provenance:** KB-derived claims always cite `meeting_id`/`source_seq`; no unsourced synthesis of stored facts.
- **Outward actions gated**; allowlist is per-user and explicit.
- **No tool-internal leakage** into answers.

## Testing

- **Pure/unit:** each tool wrapper (product-ops → portal mutation mapping), permission-tier classification, allowlist lookup, citation mapping, streaming-event (de)serialization, the tool registry, `pick_model`.
- **Agent-loop (fake LLM + fake tools):** tool-call → execute → resume; the **interrupt/resume** permission path; the **connect_required** retry path; multi-step loops.
- **Endpoint:** `/ws/chat` with a stubbed graph — auth (401), message round-trip, permission decision round-trip.
- **Portal:** pure libs (citation split/popover data, event→component mapping) with Jest; component smoke via tsc/build.

---

## Decomposition (this is multi-milestone; each gets its own plan → implementation)

This spec covers the whole design; build it in sequence, each an independently shippable plan:

- **Plan C1 — Agent core (read-only, streaming).** LangGraph graph + litellm model layer + `pick_model` + shared tool registry + **read tools** (kb_search etc.) + `/ws/chat` WebSocket + Supabase persistence (threads/messages) + JWT auth + streaming protocol. Deliverable: a working chat that reasons, searches the KB, streams a cited answer, and persists threads — no writes yet.
- **Plan C2 — Acting + permissions.** Product-ops tools + Composio tool-router + the **permission model** (tiers, `interrupt`/resume, `tool_permissions` allowlist, receipts + Undo) + **just-in-time Composio auth** (`connect_required`). Deliverable: Steward can do housekeeping and outward actions safely.
- **Plan C3 — Portal Chat UI.** `/app/chat`, thread sidebar + history, message rendering (right-bubble user / full-width Steward), quiet activity lines, citation popovers → transcript deep-link (with `source_seq` highlight), permission + connect cards, composer, WebSocket client. Deliverable: the mockup, live.
- **Later (own specs):** dynamic model self-escalation; unifying the voice agent onto the shared tool registry; per-user cost controls.

## Open questions for planning

- LangGraph checkpointer table strategy vs. our `chat_messages` table — confirm the division (loop-state vs display) and migration.
- Composio tool-router specifics: how many tools surfaced per turn, semantic-search config, and preview generation for arbitrary (non-wrapped) tools.
- Transcript deep-link + highlight mechanism in the portal (route param for `source_seq`, scroll + highlight).
- Per-user turn/cost budget policy and where it's enforced (graph step cap + token budget).
