# Connected Apps Directory

**Date:** 2026-07-03
**Status:** Approved design → implementation
**Parent spec:** `2026-07-02-production-mvp-requirements.md` (§1 Connected Apps)
**Scope:** Portal only (`portal/src/`). Agent-side tool enablement for new Google apps is explicitly a follow-up.

---

## 1. Goal

Turn the flat connections list into a credible **apps directory**: a searchable, category-filtered card grid grouped into **Connected / Available / Coming soon**, with the five Google apps live (connect/disconnect/status, connected account + last-synced, graceful re-auth) and a broad "coming soon" set (Notion, Slack, and others) shown but not connectable.

## 2. Current state

- `/app/settings/connections` (`portal/src/app/app/settings/connections/page.tsx`) is a client component rendering a flat vertical list of four apps — **Gmail, Google Calendar, Notion, Slack** — each connectable via generic routes `/api/integrations/[app]/connect|disconnect` and status from `/api/integrations/status`.
- `lib/composio.ts` exports `SUPPORTED_TOOLKITS = ["gmail","googlecalendar","notion","slack"]` and `resolveManagedAuthConfigId(slug)` (generic — works for any toolkit slug via Composio managed OAuth).
- `/api/integrations/status` reconciles Composio connected accounts into `connected_apps` and returns `{ app, status, connected_account_id, connected_at, updated_at }` per app (status ∈ connected|pending|error|disconnected).
- No search, categories, grouping, coming-soon surface, connected-email, or last-synced today.

## 3. Design

### 3.1 App catalog (pure data + filter util)

`lib/integrations/catalog.ts`:

- `type Availability = "live" | "coming_soon"`.
- `type AppCategory = "Email" | "Calendar" | "Docs" | "Storage" | "Comms" | "Project" | "CRM" | "Meetings"`.
- `type CatalogApp = { slug: string; name: string; description: string; category: AppCategory; availability: Availability }`.
- `CATALOG: CatalogApp[]`:
  - **live** (Google): `gmail` (Email), `googlecalendar` (Calendar), `googledrive` (Storage), `googledocs` (Docs), `googlesheets` (Docs).
  - **coming_soon**: `notion` (Docs), `slack` (Comms), `microsoftteams` (Comms), `zoom` (Meetings), `jira` (Project), `linear` (Project), `hubspot` (CRM), `asana` (Project), `outlook` (Email).
- `filterCatalog(apps: CatalogApp[], query: string, category: AppCategory | "All"): CatalogApp[]` — case-insensitive name/description match AND category match; pure, unit-tested.
- Icons: reuse existing `GmailIcon`/`GoogleCalendarIcon`/`NotionIcon`/`SlackIcon` where present; for apps without a brand icon, a neutral fallback tile (initial letter). (No new icon assets required for the MVP; brand icons can be added later.)

`lib/composio.ts`: extend `SUPPORTED_TOOLKITS` to include the three new live Google slugs (`googledrive`, `googledocs`, `googlesheets`) so the status route reconciles them. Notion/Slack **remain in the catalog as coming-soon** and are NOT in `SUPPORTED_TOOLKITS` (they are not connectable in this slice).

### 3.2 Status route enrichment

`/api/integrations/status` (`app/api/integrations/status/route.ts`): in addition to the current fields, include the connected account's **email/identifier** when Composio's `connectedAccounts.list` item exposes it (e.g. a `data`/`params` account label or the toolkit account email). Return it as `account_label: string | null` per app. `connected_at` is already returned. If Composio does not expose an email for a toolkit, `account_label` is null and the card falls back to "Connected · since {date}". No schema change required (derived from the live Composio list; the local `connected_apps` row is unchanged).

### 3.3 Directory UI

Rewrite the connections page as a directory (client component, keeps the existing connect/disconnect handlers):

- **Header:** title + one-line explainer.
- **Controls:** a search input (filters `filterCatalog`) and a row of category chips (`All` + the categories present).
- **Sections**, each rendered only when non-empty after filtering:
  - **Connected** — live apps whose status is `connected` (or `error`/`pending`). Card shows the connected `account_label` (or "since {date}"), and for `error` status a **Reconnect** action (calls the same connect flow).
  - **Available** — live apps not yet connected → **Connect** button.
  - **Coming soon** — every `coming_soon` app → muted/grayscale card, a **"Coming soon"** badge, a **disabled** button with a tooltip ("Available soon").
- **`AppCard`** component with a `variant` for live vs coming-soon: icon tile, name, one-line description, status/last-synced line, and the primary action. Coming-soon variant is visually distinct (reduced opacity, grayscale icon).
- Status is fetched from `/api/integrations/status` on mount and on window focus (unchanged pattern); live-app status maps by slug, and `account_label` is threaded into the connected card.

### 3.4 Connect / disconnect flow

Unchanged — the generic routes already handle any slug via `resolveManagedAuthConfigId`. The three new Google slugs work through the same path. Coming-soon apps have no connect action wired.

## 4. Error / empty / loading states

- Initial load: cards render in a `loading` status until the status fetch resolves (skeleton or muted badge).
- Status fetch failure: keep last-known state; live apps default to `disconnected` (Connect available) rather than erroring the page.
- Expired/revoked token → Composio reports `error` → the card shows an error badge + **Reconnect** (never silently fails, per §1.1).
- Empty search/category result → a "No apps match" line.
- Coherent light + dark; dense, professional cards.

## 5. Testing

- **Unit (Jest):** `filterCatalog` — name match, description match, category match, `All` passthrough, combined query+category, case-insensitivity, empty result. Catalog invariants — every live app slug ∈ the connectable set; coming-soon apps are NOT in `SUPPORTED_TOOLKITS`.
- **Manual:** the grid groups Connected/Available/Coming soon correctly; search + category filter work; a Google app connects via Composio OAuth and returns showing connected + account label/date; disconnect works; a coming-soon card is disabled with a tooltip; an `error`-status app shows Reconnect.
- `npm test` + `next build` green.

## 6. Out of scope (this slice)

- **Agent tool enablement** for Drive/Docs/Sheets (the Python `composio_service` allow-list / live tools) — connecting works here; the agent acting via those toolkits is a separate follow-up.
- **"Notify me" waitlist** on coming-soon cards (YAGNI for MVP).
- Brand icons for coming-soon apps beyond the existing four (neutral fallback tile is used).
- Any change to the OAuth mode / CASA question (§4.1) — separate.
