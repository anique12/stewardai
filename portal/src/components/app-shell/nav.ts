import {
  Home,
  CalendarClock,
  ListChecks,
  Layers,
  Blocks,
  BarChart3,
  Settings,
  MessageSquare,
} from "lucide-react";

export type NavIcon = React.ComponentType<{ className?: string }>;

export type NavItem = {
  /** Omit for items that trigger a client-state action (see `action`) instead of navigating. */
  href?: string;
  label: string;
  icon: NavIcon;
  isActive: (path: string) => boolean;
  /** Key into the counts map passed down from the layout, if this item shows a badge. */
  countKey?: "actions" | "review";
  /** Key into the counts map for a pulsing live-dot (e.g. a meeting in progress), if this item shows one. */
  liveKey?: "live";
  /** Non-navigating items: rendered as a button that triggers this client-state action instead of a `Link`. */
  action?: "settings";
};

/** Primary workspace section — Home, Meetings, Action items, Spaces. */
export const WORKSPACE_NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: Home, isActive: (p) => p === "/app" },
  {
    href: "/app/meetings",
    label: "Meetings",
    icon: CalendarClock,
    isActive: (p) => p.startsWith("/app/meetings"),
    liveKey: "live",
  },
  {
    href: "/app/actions",
    label: "Action items",
    icon: ListChecks,
    isActive: (p) => p.startsWith("/app/actions"),
    countKey: "actions",
  },
  {
    href: "/app/spaces",
    label: "Spaces",
    icon: Layers,
    isActive: (p) => p.startsWith("/app/spaces"),
    countKey: "review",
  },
];

/** Account section — connected apps, usage, settings. */
export const ACCOUNT_NAV: NavItem[] = [
  {
    href: "/app/settings/connections",
    label: "Connected apps",
    icon: Blocks,
    isActive: (p) => p.startsWith("/app/settings/connections"),
  },
  { href: "/app/usage", label: "Usage", icon: BarChart3, isActive: (p) => p.startsWith("/app/usage") },
  // No href: Settings opens as a client-state modal over the current page — see `action`.
  { action: "settings", label: "Settings", icon: Settings, isActive: () => false },
];

/** Mobile bottom nav — Home / Ask / Meetings / Actions / Spaces. */
export const MOBILE_BOTTOM_NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: Home, isActive: (p) => p === "/app" },
  { href: "/app/chat", label: "Ask", icon: MessageSquare, isActive: (p) => p.startsWith("/app/chat") },
  {
    href: "/app/meetings",
    label: "Meetings",
    icon: CalendarClock,
    isActive: (p) => p.startsWith("/app/meetings"),
  },
  {
    href: "/app/actions",
    label: "Actions",
    icon: ListChecks,
    isActive: (p) => p.startsWith("/app/actions"),
    countKey: "actions",
  },
  {
    href: "/app/spaces",
    label: "Spaces",
    icon: Layers,
    isActive: (p) => p.startsWith("/app/spaces"),
    countKey: "review",
  },
];

/** Route → {title, subtitle} for the Topbar. Longest-prefix match wins. */
export const ROUTE_TITLES: { prefix: string; title: string; subtitle?: string }[] = [
  { prefix: "/app/spaces/unfiled", title: "Review queue", subtitle: "Confirm where these meetings belong." },
  { prefix: "/app/spaces", title: "Spaces", subtitle: "Your work, organized into threads." },
  { prefix: "/app/meetings", title: "Meetings", subtitle: "Every meeting Steward has joined or scheduled." },
  { prefix: "/app/actions", title: "Action items", subtitle: "Every task Steward captured across your meetings." },
  { prefix: "/app/settings/connections", title: "Connected apps", subtitle: "Manage calendar and meeting integrations." },
  { prefix: "/app/usage", title: "Usage", subtitle: "Your Steward usage and billing." },
  // No "/app/settings" entry: that route now only redirects (see
  // app/app/settings/page.tsx) — Settings itself is a client-state modal,
  // never a rendered page/pathname.
  { prefix: "/app/chat", title: "Ask Steward", subtitle: "Ask anything across your meetings and work." },
  { prefix: "/app", title: "Home", subtitle: "Your day, at a glance." },
];

export function routeTitleFor(pathname: string): { title: string; subtitle?: string } {
  const match = ROUTE_TITLES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return match ? { title: match.title, subtitle: match.subtitle } : { title: "StewardAI" };
}

export type NavCounts = { actions: number; review: number; live: boolean };
