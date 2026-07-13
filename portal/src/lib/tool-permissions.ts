// Friendly labels for the "Manage automatic approvals" settings card.
// `tool_permissions.tool_name` may be a friendly name the chat approval flow
// wrote (e.g. `send_email`) or a raw Composio slug (e.g. `GMAIL_SEND_EMAIL`) —
// both map to the same label here.
const TOOL_LABELS: Record<string, string> = {
  send_email: "Send email",
  GMAIL_SEND_EMAIL: "Send email",
  create_calendar_event: "Create calendar event",
  GOOGLECALENDAR_CREATE_EVENT: "Create calendar event",
  create_notion_page: "Create Notion page",
  post_slack_message: "Post Slack message",
  archive_space: "Archive space",
};

/** Title-case fallback for a slug we don't have a mapping for: `FOO_BAR-baz` -> "Foo bar baz". */
function titleCaseSlug(toolName: string): string {
  return toolName
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function toolFriendlyLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? titleCaseSlug(toolName);
}
