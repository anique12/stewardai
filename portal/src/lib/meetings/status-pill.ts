import type { StatusPillStatus } from "@/components/common/StatusPill";

const KNOWN_STATUSES: StatusPillStatus[] = [
  "joining",
  "in_meeting",
  "done",
  "failed",
  "scheduled",
  "pending",
];

/**
 * Map a raw `meetings.bot_status` string onto a `StatusPill` state.
 *
 * `joining` (bot dispatched, asking to join / in the Google Meet waiting room)
 * is a first-class state — it must NOT collapse to the way a genuinely unknown
 * value does. Anything unrecognized falls back to `fallback` (default `done`;
 * callers rendering upcoming meetings pass `scheduled`).
 */
export function toStatusPillStatus(
  botStatus: string,
  fallback: StatusPillStatus = "done",
): StatusPillStatus {
  return KNOWN_STATUSES.includes(botStatus as StatusPillStatus)
    ? (botStatus as StatusPillStatus)
    : fallback;
}
