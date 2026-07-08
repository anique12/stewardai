export type Availability = "live" | "coming_soon";
export type AppCategory =
  | "Email" | "Calendar" | "Docs" | "Storage" | "Comms" | "Project" | "CRM" | "Meetings";
export type CatalogApp = {
  slug: string;
  name: string;
  description: string;
  category: AppCategory;
  availability: Availability;
};

export const CATALOG: CatalogApp[] = [
  { slug: "gmail", name: "Gmail", description: "Read, send, and manage email on your behalf.", category: "Email", availability: "live" },
  { slug: "googlecalendar", name: "Google Calendar", description: "Create and update events and check availability.", category: "Calendar", availability: "live" },
  { slug: "googledrive", name: "Google Drive", description: "Find, read, and organize files.", category: "Storage", availability: "live" },
  { slug: "googledocs", name: "Google Docs", description: "Read and draft documents.", category: "Docs", availability: "live" },
  { slug: "googlesheets", name: "Google Sheets", description: "Read and update spreadsheets.", category: "Docs", availability: "live" },
  { slug: "notion", name: "Notion", description: "Search, read, and write pages and databases.", category: "Docs", availability: "coming_soon" },
  { slug: "slack", name: "Slack", description: "Post messages and read channels.", category: "Comms", availability: "coming_soon" },
  { slug: "microsoftteams", name: "Microsoft Teams", description: "Chat and meetings for work.", category: "Comms", availability: "coming_soon" },
  { slug: "zoom", name: "Zoom", description: "Schedule and summarize video meetings.", category: "Meetings", availability: "coming_soon" },
  { slug: "jira", name: "Jira", description: "Track issues and sprints.", category: "Project", availability: "coming_soon" },
  { slug: "linear", name: "Linear", description: "Manage issues and projects.", category: "Project", availability: "coming_soon" },
  { slug: "hubspot", name: "HubSpot", description: "CRM contacts and deals.", category: "CRM", availability: "coming_soon" },
  { slug: "asana", name: "Asana", description: "Tasks and project workflows.", category: "Project", availability: "coming_soon" },
  { slug: "outlook", name: "Outlook", description: "Email and calendar for work.", category: "Email", availability: "coming_soon" },
];

export function filterCatalog(
  apps: CatalogApp[],
  query: string,
  category: AppCategory | "All",
): CatalogApp[] {
  const q = query.trim().toLowerCase();
  return apps.filter((a) => {
    const matchesCategory = category === "All" || a.category === category;
    const matchesQuery =
      !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });
}
