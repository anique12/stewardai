/**
 * Per-user auto-join policy: controls the DEFAULT `opted_in` value for a
 * NEWLY-synced calendar meeting. Existing meetings are never touched by this
 * (see the sync callers in `app/page.tsx` / `app/meetings/page.tsx`) — a user
 * may have manually toggled a meeting's per-meeting opt-in, and re-syncing
 * must not clobber it.
 *
 * The bot can only join meetings with a Meet link, so `opted_in` should never
 * default to true for a meeting without one, regardless of policy.
 */
export type AutoJoinPolicy = "all" | "organizer" | "none";

export function defaultOptedIn(
  policy: AutoJoinPolicy,
  { isOrganizer, hasMeetUrl }: { isOrganizer: boolean; hasMeetUrl: boolean }
): boolean {
  if (!hasMeetUrl) return false; // bot only joins Meet-linked meetings
  if (policy === "none") return false;
  if (policy === "organizer") return isOrganizer;
  return true; // "all"
}
