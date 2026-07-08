# Agentic Chat — Plan C3: Portal UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A polished, usable `/app/chat` in the portal that talks to the `/ws/chat` WebSocket — streaming answers, quiet expandable activity lines, citation hover-popovers → transcript, and the Claude-Code permission/connect cards — matching the approved mockup.

**Architecture:** A `useChat` React hook opens a WebSocket to the Python backend (`NEXT_PUBLIC_CHAT_WS_URL`) authenticated with the Supabase access token (`?token=`), sends `user_message`/`permission_decision`/`connect_done`, and reduces the typed server events (`token`/`activity`/`permission_request`/`connect_required`/`citations`/`done`/`error`/`thread`) into a message list. Components render that list per the mockup. Built on the portal's existing Next.js/shadcn stack.

**Reference (the visual spec — match it):** the approved mockup at `docs/superpowers/` (published artifact "agentic-chat v3"): right-aligned soft-grey user bubbles; full-width Steward; quiet muted activity lines (expandable); answer with `[n]` citation chips (hover popover → click to transcript); prominent teal permission card (approve/reject/always) + amber connect card; dark thread sidebar; composer. Palette: cool slate neutrals + teal accent, amber needs-auth, red reject.

**Tech stack:** Next.js App Router (portal/), TypeScript, React, shadcn, Jest. Run portal cmds from `/Users/aniquesabir/projects/stewardai/portal`.

## Global Constraints

- **Server event contract (from C1/C2 — the WS sends these):** `{"type":"thread","id"}`, `{"type":"token","delta"}`, `{"type":"activity","kind":"tool"|"reasoning","name","status":"started"|"done"|"error"}`, `{"type":"permission_request","call_id","kind":"permission","tool", ...preview fields}`, `{"type":"connect_required","call_id","kind":"connect","app","tool"}`, `{"type":"done","answer","citations":[{n,meeting_id,source_seq,kind,text}]}`, `{"type":"error","message"|"text"}`. Client sends: `{"type":"user_message","text","thread_id"?}`, `{"type":"permission_decision","decision":"approve"|"reject"|"always"}`, `{"type":"connect_done"}`.
- **Auth:** get the token via `createBrowserClient().auth.getSession()` → `session.access_token`; connect `${NEXT_PUBLIC_CHAT_WS_URL}?token=${token}`. If no token/URL, show a graceful "sign in / not configured" state.
- **portal tsconfig has NO `downlevelIteration`** → never spread/iterate a Map/Set (`Array.from(...)` instead; build Maps from arrays).
- **Gates:** `npx tsc --noEmit` clean; `npm run build` "Compiled successfully" with `/app/chat` in the route list; `npx jest` green (existing + new).
- **Hygiene:** explicit `git add`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- `portal/src/lib/chat/types.ts` — event + message types.
- `portal/src/lib/chat/reducer.ts` — pure `reduceChatEvent(state, event) -> state` (append token to current assistant msg, add activity/citations/permission/connect, finalize on done). PURE → Jest-tested.
- `portal/src/lib/chat/reducer.test.ts` — Jest tests for the reducer.
- `portal/src/hooks/useChat.ts` — WS lifecycle + send helpers + exposes messages/state via the reducer.
- `portal/src/components/chat/ChatMessages.tsx` — renders the message list (user bubble / Steward block / activity lines / answer+citations / permission card / connect card / status).
- `portal/src/components/chat/Citation.tsx` — the `[n]` chip + hover popover + click→`/app/meetings/[id]`.
- `portal/src/components/chat/Composer.tsx` — input + send.
- `portal/src/components/chat/ChatSidebar.tsx` — thread list (from `/api/chat/threads` if present, else empty) + New chat.
- `portal/src/app/app/chat/page.tsx` — assembles the above.
- `portal/src/components/app-shell/Sidebar.tsx` — add "Chat" nav (top).
- `portal/.env.example` — add `NEXT_PUBLIC_CHAT_WS_URL`.

## Interfaces

```ts
// types.ts
type ServerEvent = {type:"thread",id:string} | {type:"token",delta:string} | {type:"activity",kind:string,name?:string,status?:string}
  | {type:"permission_request",call_id:string,tool:string,[k:string]:unknown} | {type:"connect_required",call_id:string,app:string,tool?:string}
  | {type:"citations",...} | {type:"done",answer:string,citations:Citation[]} | {type:"error",message?:string,text?:string};
type Citation = {n:number,meeting_id:string,source_seq:number|null,kind:string,text?:string};
type ChatPart = {kind:"activity",...} | {kind:"permission",...} | {kind:"connect",...};
type Message = {role:"user"|"assistant", text:string, activities:..., citations:Citation[], pending?:"permission"|"connect", permission?:..., connect?:..., done:boolean};
type ChatState = {messages:Message[], streaming:boolean, awaiting:null|"permission"|"connect"};

// reducer.ts
function initialChatState(): ChatState
function reduceChatEvent(state: ChatState, ev: ServerEvent): ChatState

// useChat.ts
function useChat(): {messages:Message[], streaming:boolean, awaiting, send(text):void, decide(d:"approve"|"reject"|"always"):void, connectDone():void, connected:boolean}
```

---

### Task 1: Event types + pure reducer (Jest-tested)

**Files:** `portal/src/lib/chat/types.ts`, `portal/src/lib/chat/reducer.ts`, `portal/src/lib/chat/reducer.test.ts`

- [ ] **Test first** (`reducer.test.ts`): feed a sequence and assert the resulting `messages`:
  - user sends → a user message appended (do this via a helper or model `send` appending a user msg; the reducer handles server events only, so add user messages in the hook — TEST the reducer with server events): start with one empty assistant message (the hook adds it on send); `token{delta:"Hel"}` then `token{delta:"lo"}` → assistant `text==="Hello"`; `activity{kind:"tool",name:"kb_search",status:"started"}` then `...done` → one activity entry with status done; `done{answer:"Hello",citations:[{n:1,meeting_id:"m1",source_seq:3,kind:"fact"}]}` → assistant `done===true`, citations set, `streaming===false`.
  - `permission_request{call_id,tool:"send_email",...}` → assistant `pending==="permission"`, `awaiting==="permission"`, permission payload stored.
  - `connect_required{app:"Notion"}` → `pending==="connect"`, connect payload.
  - `error{message:"x"}` → an error surfaced on the current message; streaming false.
- [ ] **Implement** `types.ts` + `reducer.ts` (pure, no React). `initialChatState()` → `{messages:[],streaming:false,awaiting:null}`. `reduceChatEvent` operates on the LAST assistant message (assume the hook pushed an empty assistant message when the user sent). Handle each event type; `Array.from`/immutable updates (no Map spread). Unknown event → state unchanged.
- [ ] `npx jest src/lib/chat/reducer.test.ts` green; `npx tsc --noEmit` clean. Commit.

---

### Task 2: `useChat` hook + Chat page + message rendering

**Files:** `portal/src/hooks/useChat.ts`, `portal/src/components/chat/{ChatMessages,Citation,Composer}.tsx`, `portal/src/app/app/chat/page.tsx`

- [ ] **`useChat.ts`** ("use client"): on mount (or first send) open `WebSocket(`${process.env.NEXT_PUBLIC_CHAT_WS_URL}?token=${token}`)` (token from `createBrowserClient().auth.getSession()`); `onmessage` → `setState(s => reduceChatEvent(s, JSON.parse(ev.data)))`; `send(text)`: push a user message + an empty assistant message into state, set streaming, `ws.send({type:"user_message",text,thread_id})`; `decide(d)`: `ws.send({type:"permission_decision",decision:d})`, clear awaiting; `connectDone()`: `ws.send({type:"connect_done"})`. Handle missing URL/token gracefully (`connected:false`). Clean up on unmount.
- [ ] **`Citation.tsx`**: the `[n]` chip; on hover show a popover (snippet + kind + meeting) ; on click `router.push(`/app/meetings/${meeting_id}`)` (source_seq highlight is a meetings-page concern — link is enough for v1). Port the mockup's `.cite`/`.cite-pop` styling to Tailwind/shadcn.
- [ ] **ChatMessages.tsx**: render each message — user → right soft-grey bubble; assistant → full-width block with: quiet expandable activity lines (`<details>`/disclosure), streamed answer with citation chips (parse `[n]` → `<Citation>`), a sources strip, and (when pending) the permission card / connect card (Task 3 wires their actions — render here). Match the mockup's hierarchy: answer loud, activity quiet.
- [ ] **Composer.tsx**: textarea + send button; Enter to send (guarded while streaming); calls `send`.
- [ ] **page.tsx**: `"use client"` page assembling sidebar + ChatMessages(messages) + Composer, using `useChat()`. Empty state ("Ask Steward anything, or tell it to do something").
- [ ] `npx tsc --noEmit` clean + `npm run build` shows `/app/chat`. Commit.

---

### Task 3: Permission + connect cards, thread sidebar, nav, env

**Files:** `portal/src/components/chat/{PermissionCard,ConnectCard,ChatSidebar}.tsx`, wire into ChatMessages/page; `portal/src/components/app-shell/Sidebar.tsx`; `portal/.env.example`

- [ ] **PermissionCard.tsx**: teal card (port mockup `.perm`): shows the tool + preview (for `send_email` show to/subject/body from the payload; generic fallback for other tools) + Approve / Reject / Always allow → call `decide("approve"|"reject"|"always")`.
- [ ] **ConnectCard.tsx**: amber card (port `.connect`): "Connect [App]" → open the Composio connect URL (if provided in payload) or a placeholder; "Skip"; on return, `connectDone()`.
- [ ] **ChatSidebar.tsx**: dark rail (port `.sidebar`): New chat + thread list (fetch from a `/api/chat/threads` route IF present, else render empty — do NOT block on it; a follow-up can add the route). 
- [ ] **Sidebar.tsx**: add `{ href:"/app/chat", label:"Chat", icon:<MessageSquare/>, isActive:p=>p.startsWith("/app/chat") }` near the top (import an existing lucide icon).
- [ ] **.env.example**: add `NEXT_PUBLIC_CHAT_WS_URL=` with a comment (e.g. `ws://<backend-host>:8080/ws/chat` locally, `wss://…` in prod).
- [ ] `npx tsc --noEmit` clean + `npm run build` OK + `npx jest` green. Commit.

## Deploy + live test (controller/ops — after the build tasks)

- Deploy the C1+C2 backend to the box: merge `feat/agentic-chat` into the box's deploy branch, `pip install` the chat deps into the box venv, restart web.app; set `NEXT_PUBLIC_CHAT_WS_URL` in `portal/.env.local` to the box `ws://…:8080/ws/chat`; run the portal locally and chat in the browser.
- Apply migrations `0011`+`0012` for thread history + allowlist (chat works without them — best-effort).

## Self-Review

- Spec coverage (C3): WS client + streaming ✅ (T1,T2); message rendering incl. activity/citations ✅ (T2); permission + connect cards ✅ (T3); nav/env ✅ (T3). Transcript `source_seq` highlight deep-link = deferred (link to meeting is v1). Thread history route = deferred (sidebar tolerates empty).
- Placeholders: none.
- Type consistency: `ServerEvent`/`Citation`/`Message` shapes match the C1/C2 WS contract; reducer + hook + components share `types.ts`.
