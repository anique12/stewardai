// Builds the empty-state suggestion strings shown above the composer, tailored
// to the currently selected chat scope + the user's real spaces/meetings (never
// a placeholder company name — see buildSuggestions below).

import type { ChatScope } from "@/hooks/useChat";
import type { MeetingOption, SpaceOption } from "@/hooks/useChatScopeOptions";

export function buildSuggestions(
  scope: ChatScope,
  { spaces, meetings }: { spaces: SpaceOption[]; meetings: MeetingOption[] },
): string[] {
  let suggestions: string[];

  if (scope.kind === "space") {
    const label = scope.label;
    suggestions = [
      `What's still open in ${label}?`,
      `Summarize everything about ${label}`,
      `Who's involved in ${label}?`,
      `What did we last decide in ${label}?`,
    ];
  } else if (scope.kind === "meeting") {
    const label = scope.label;
    suggestions = [
      `Summarize ${label}`,
      `What did we commit to in ${label}?`,
      `What's still open from ${label}?`,
      `Who was in ${label}?`,
    ];
  } else {
    const meeting = meetings[0];
    const space = spaces[0];
    suggestions = [
      "What's still open from my recent meetings?",
      meeting ? `What did we commit to in "${meeting.title}"?` : "What did we commit to recently?",
      space ? `Summarize everything about ${space.name}` : "Summarize a recent meeting",
      "Draft a follow-up from my last meeting",
    ];
  }

  return suggestions.filter((s) => s.trim().length > 0).slice(0, 4);
}
