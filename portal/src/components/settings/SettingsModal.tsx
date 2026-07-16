"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Calendar as CalendarIcon,
  LogOut,
  Mail,
  Moon,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  User as UserIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/ErrorState";
import { AppIcon } from "@/components/integrations/AppCard";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/app-shell/ThemeProvider";
import { createBrowserClient } from "@/lib/supabase/client";
import { toolFriendlyLabel } from "@/lib/tool-permissions";
import { cn } from "@/lib/utils";

function initials(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[.\-_]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? email[0] ?? "?") + (parts[1]?.[0] ?? "");
  return letters.toUpperCase();
}

type ToolPermission = { id: string; tool_name: string; scope: string | null; created_at: string };

type AutoJoinPolicy = "all" | "organizer" | "none";

const AUTO_JOIN_OPTIONS: { value: AutoJoinPolicy; label: string; description: string }[] = [
  {
    value: "all",
    label: "Join every new meeting",
    description: "MeetBase joins all new meetings on your calendar that have a video link.",
  },
  {
    value: "organizer",
    label: "Only meetings I organize",
    description: "MeetBase joins only meetings you host.",
  },
  {
    value: "none",
    label: "Don't join automatically",
    description: "MeetBase joins nothing until you turn it on per meeting.",
  },
];

type SectionId = "general" | "assistant" | "calendar" | "notifications" | "approvals" | "account";

type NotesRecipients = "only_me" | "everyone";

const NOTES_RECIPIENT_OPTIONS: { value: NotesRecipients; label: string; description: string }[] = [
  {
    value: "only_me",
    label: "Only me",
    description: "After each meeting, the notes email is sent to you only.",
  },
  {
    value: "everyone",
    label: "All participants",
    description: "Send the notes email to everyone on the meeting invite.",
  },
];

const SECTIONS: { id: SectionId; label: string; icon: typeof SettingsIcon }[] = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "assistant", label: "Assistant", icon: Bot },
  { id: "calendar", label: "Calendar", icon: CalendarIcon },
  { id: "notifications", label: "Notifications", icon: Mail },
  { id: "approvals", label: "Automatic approvals", icon: ShieldCheck },
  { id: "account", label: "Account", icon: UserIcon },
];

/** Grouped label/control row — the reference pattern for each setting. */
function SettingRow({
  label,
  description,
  children,
  align = "center",
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 border-b border-line py-4 last:border-b-0",
        align === "start" && "items-start"
      )}
    >
      <div className="min-w-0 max-w-[380px]">
        <div className="text-[13.5px] font-medium text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{description}</div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 font-display text-[16px] font-bold tracking-tight text-foreground">
      {children}
    </h2>
  );
}

function RowSkeletons({ count }: { count: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-md" />
      ))}
    </div>
  );
}

/** "Automatic approvals" section — view & revoke the tools a user has "Always allow"-ed in chat. */
function AutoApprovalsSection() {
  const queryClient = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { data: permissions, isLoading, isError } = useQuery({
    queryKey: ["tool-permissions"],
    queryFn: async () => {
      const res = await fetch("/api/tool-permissions");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const { permissions } = (await res.json()) as { permissions: ToolPermission[] };
      return permissions;
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      setRevokingId(id);
      const res = await fetch(`/api/tool-permissions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`status ${res.status}`);
    },
    onSettled: () => {
      setRevokingId(null);
      queryClient.invalidateQueries({ queryKey: ["tool-permissions"] });
    },
  });

  return (
    <div>
      <SectionTitle>Automatic approvals</SectionTitle>
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-2">
        Tools you&apos;ve told MeetBase to always run without asking first. Revoke any of these to have
        MeetBase ask again next time.
      </p>

      {isLoading ? (
        <RowSkeletons count={2} />
      ) : isError || !permissions || permissions.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-md border border-dashed border-line-2 px-3.5 py-3 text-[12.5px] text-ink-3">
          <ShieldCheck className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
          No automatic approvals — MeetBase asks before every outward action.
        </div>
      ) : (
        <ul className="space-y-2">
          {permissions.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-line-2 bg-paper px-3.5 py-3"
            >
              <div className="min-w-[160px] flex-1">
                <div className="text-[13px] font-semibold text-foreground">{toolFriendlyLabel(p.tool_name)}</div>
                <div className="text-[11.5px] text-ink-4">
                  {p.tool_name}
                  {p.scope ? ` · ${p.scope}` : ""} · Always allows
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke.mutate(p.id)}
                disabled={revokingId === p.id}
                className="inline-flex items-center rounded-md border border-danger bg-danger-weak px-3 py-[6px] text-[12px] font-semibold text-danger transition-colors hover:opacity-90 disabled:opacity-60"
              >
                {revokingId === p.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const supabase = createBrowserClient();
  const router = useRouter();
  const { theme, toggle } = useTheme();

  const [activeSection, setActiveSection] = useState<SectionId>("general");
  const [navFilter, setNavFilter] = useState("");

  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [email, setEmail] = useState("");
  const [botName, setBotName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [plan, setPlan] = useState("free");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [hasCalendar, setHasCalendar] = useState(false);
  const [autoJoinPolicy, setAutoJoinPolicy] = useState<AutoJoinPolicy>("all");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [allowMeetingSpeech, setAllowMeetingSpeech] = useState(true);
  const [savingSpeech, setSavingSpeech] = useState(false);
  const [notesRecipients, setNotesRecipients] = useState<NotesRecipients>("only_me");
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      const [{ data: profile, error: profileErr }, { data: conn }, { data: prefs }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("bot_name,plan,timezone,auto_join_policy,allow_meeting_speech")
            .eq("user_id", user.id)
            .single(),
          supabase.from("calendar_connections").select("id").eq("user_id", user.id).single(),
          supabase.from("email_prefs").select("notes_recipients").eq("user_id", user.id).maybeSingle(),
        ]);
      if (profileErr) throw profileErr;
      setEmail(user.email ?? "");
      if (profile) {
        setBotName(profile.bot_name ?? "");
        setPlan(profile.plan ?? "free");
        setTimezone(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
        setAutoJoinPolicy(((profile as { auto_join_policy?: string }).auto_join_policy as AutoJoinPolicy) ?? "all");
        const speech = (profile as { allow_meeting_speech?: boolean }).allow_meeting_speech;
        setAllowMeetingSpeech(speech ?? true);
      }
      setNotesRecipients(
        ((prefs as { notes_recipients?: string } | null)?.notes_recipients as NotesRecipients) ??
          "only_me",
      );
      setHasCalendar(Boolean(conn));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [supabase]);

  // Lazy: only fetch profile/calendar state once the modal is actually open,
  // since `SettingsModal` is now mounted permanently in `AppChrome`.
  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  async function saveProfile() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ bot_name: botName }).eq("user_id", user.id);
    }
    setSaving(false);
  }

  async function saveAutoJoinPolicy(next: AutoJoinPolicy) {
    const prev = autoJoinPolicy;
    setAutoJoinPolicy(next); // optimistic
    setSavingPolicy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      const { error } = await supabase.from("profiles").update({ auto_join_policy: next }).eq("user_id", user.id);
      if (error) throw error;
    } catch {
      setAutoJoinPolicy(prev); // revert on failure
    } finally {
      setSavingPolicy(false);
    }
  }

  async function saveNotesRecipients(next: NotesRecipients) {
    const prev = notesRecipients;
    setNotesRecipients(next); // optimistic
    setSavingNotes(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      // email_prefs may not have a row yet (created lazily) → upsert on the PK.
      const { error } = await supabase
        .from("email_prefs")
        .upsert({ user_id: user.id, notes_recipients: next }, { onConflict: "user_id" });
      if (error) throw error;
    } catch {
      setNotesRecipients(prev); // revert on failure
    } finally {
      setSavingNotes(false);
    }
  }

  async function saveAllowMeetingSpeech(next: boolean) {
    const prev = allowMeetingSpeech;
    setAllowMeetingSpeech(next); // optimistic
    setSavingSpeech(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      const { error } = await supabase
        .from("profiles")
        .update({ allow_meeting_speech: next })
        .eq("user_id", user.id);
      if (error) throw error;
    } catch {
      setAllowMeetingSpeech(prev); // revert on failure
    } finally {
      setSavingSpeech(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const filteredSections = useMemo(() => {
    const q = navFilter.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q));
  }, [navFilter]);

  function renderSection() {
    if (phase === "loading") {
      return <RowSkeletons count={4} />;
    }
    if (phase === "error") {
      return <ErrorState title="Couldn't load settings" body="Something went wrong fetching your account settings." onRetry={load} />;
    }

    switch (activeSection) {
      case "general":
        return (
          <div>
            <SectionTitle>General</SectionTitle>
            <SettingRow label="Appearance" description="Choose how MeetBase looks on this device.">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { if (theme !== "light") toggle(); }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-3 py-[7px] text-[12.5px] font-semibold transition-colors hover:bg-surface-2",
                    theme === "light" ? "border-brand bg-brand-weak text-brand" : "border-line-2 text-foreground"
                  )}
                >
                  <Sun className="h-3.5 w-3.5" aria-hidden />
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => { if (theme !== "dark") toggle(); }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-3 py-[7px] text-[12.5px] font-semibold transition-colors hover:bg-surface-2",
                    theme === "dark" ? "border-brand bg-brand-weak text-brand" : "border-line-2 text-foreground"
                  )}
                >
                  <Moon className="h-3.5 w-3.5" aria-hidden />
                  Dark
                </button>
              </div>
            </SettingRow>
            <SettingRow label="Timezone" description="Detected automatically from your device.">
              <span className="text-[13px] text-ink-3">{timezone || "Detecting…"}</span>
            </SettingRow>
          </div>
        );
      case "assistant":
        return (
          <div>
            <SectionTitle>Assistant</SectionTitle>
            <SettingRow
              label="Wake word / display name"
              description={
                <>
                  What you say to address the agent out loud — e.g. &ldquo;
                  <span className="font-semibold text-foreground">{botName || "MeetBase"}</span>, summarize where we are.&rdquo;
                </>
              }
              align="start"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  className="h-auto w-[180px] rounded-md border-line-2 bg-paper px-3 py-[9px] text-[13.5px] font-semibold"
                  aria-label="MeetBase's name / wake word"
                />
                <Button onClick={saveProfile} disabled={saving} size="sm">
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </SettingRow>
            <div className="border-b border-line py-4 last:border-b-0">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div className="min-w-0 max-w-[380px]">
                  <div className="text-[13.5px] font-medium text-foreground">Auto-join policy</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
                    Choose which new meetings MeetBase auto-joins by default when your calendar syncs.
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Auto-join policy">
                {AUTO_JOIN_OPTIONS.map((opt) => {
                  const selected = autoJoinPolicy === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={savingPolicy}
                      onClick={() => saveAutoJoinPolicy(opt.value)}
                      className={cn(
                        "flex items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60",
                        selected ? "border-brand bg-brand-weak" : "border-line-2 bg-paper"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border",
                          selected ? "border-brand" : "border-line-2"
                        )}
                      >
                        {selected ? <span className="h-2 w-2 rounded-pill bg-brand" /> : null}
                      </span>
                      <span className="flex-1">
                        <span className="block text-[13px] font-semibold text-foreground">{opt.label}</span>
                        <span className="block text-[12px] text-ink-3">{opt.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-ink-4">
                You can always override any single meeting from the Meetings list.
              </p>
            </div>
            <SettingRow
              label="Let MeetBase speak in meetings"
              description="When off, MeetBase silently takes notes and does everything after the meeting — it won't talk in the room."
              align="start"
            >
              <Switch
                checked={allowMeetingSpeech}
                onCheckedChange={saveAllowMeetingSpeech}
                disabled={savingSpeech}
                aria-label="Let MeetBase speak in meetings"
              />
            </SettingRow>
          </div>
        );
      case "calendar":
        return (
          <div>
            <SectionTitle>Calendar</SectionTitle>
            <SettingRow
              label={
                <div className="flex items-center gap-2.5">
                  <AppIcon slug="googlecalendar" name="Google Calendar" />
                  <span>Google Calendar</span>
                </div>
              }
              description={email ? `${email} · read-only` : undefined}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-[5px] rounded-pill border px-2 py-[3px] font-mono text-[9.5px] font-semibold",
                    hasCalendar
                      ? "border-brand-weak-2 bg-brand-weak text-brand"
                      : "border-line bg-surface-2 text-ink-4"
                  )}
                >
                  <span className="h-[5px] w-[5px] rounded-pill bg-current" />
                  {hasCalendar ? "Connected" : "Not connected"}
                </span>
                <a
                  href="/auth/connect-calendar"
                  className="inline-flex items-center rounded-md border border-line-2 px-[13px] py-[7px] text-[12.5px] font-semibold text-foreground transition-colors hover:bg-surface-2"
                >
                  {hasCalendar ? "Reconnect" : "Connect Google Calendar"}
                </a>
              </div>
            </SettingRow>
          </div>
        );
      case "notifications":
        return (
          <div>
            <SectionTitle>Notifications</SectionTitle>
            <div className="py-4">
              <div className="mb-3 min-w-0 max-w-[380px]">
                <div className="text-[13.5px] font-medium text-foreground">Meeting notes email</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
                  After each meeting, MeetBase emails the summary, decisions and action items.
                  Choose who receives it.
                </div>
              </div>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Meeting notes recipients">
                {NOTES_RECIPIENT_OPTIONS.map((opt) => {
                  const selected = notesRecipients === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={savingNotes}
                      onClick={() => saveNotesRecipients(opt.value)}
                      className={cn(
                        "flex items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60",
                        selected ? "border-brand bg-brand-weak" : "border-line-2 bg-paper"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border",
                          selected ? "border-brand" : "border-line-2"
                        )}
                      >
                        {selected ? <span className="h-2 w-2 rounded-pill bg-brand" /> : null}
                      </span>
                      <span className="flex-1">
                        <span className="block text-[13px] font-semibold text-foreground">{opt.label}</span>
                        <span className="block text-[12px] text-ink-3">{opt.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-ink-4">
                External participants receive a lightly different note explaining MeetBase captured it.
              </p>
            </div>
          </div>
        );
      case "approvals":
        return <AutoApprovalsSection />;
      case "account":
        return (
          <div>
            <SectionTitle>Account</SectionTitle>
            <SettingRow label="Name" description={email || undefined}>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand-weak-2 text-[12.5px] font-bold text-brand-ink">
                  {email ? initials(email) : "?"}
                </span>
                <span className="text-[13px] font-semibold text-foreground">
                  {email ? email.split("@")[0] : "Account"}
                </span>
              </div>
            </SettingRow>
            <SettingRow label="Plan" description="Billing & upgrades are coming soon.">
              <div className="flex items-center gap-2">
                <span className="font-display text-[14px] font-bold capitalize text-foreground">{plan}</span>
                <span className="rounded-pill border border-brand-weak-2 bg-brand-weak px-[7px] py-[2px] font-mono text-[9.5px] font-semibold text-brand">
                  Current
                </span>
                <Button variant="outline" disabled title="Coming soon" size="sm">
                  Manage plan
                </Button>
              </div>
            </SettingRow>
            <SettingRow label="Sign out" description="You'll need to sign back in to use MeetBase.">
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className="inline-flex items-center gap-[7px] rounded-md border border-danger bg-danger-weak px-[14px] py-2 text-[12.5px] font-semibold text-danger transition-colors hover:opacity-90 disabled:opacity-60"
              >
                <LogOut className="h-[15px] w-[15px]" aria-hidden />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </SettingRow>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[82vh] w-[min(960px,92vw)] max-w-none flex-col overflow-hidden p-0 sm:rounded-xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex min-h-0 flex-1">
          {/* Left rail */}
          <nav className="flex w-[230px] shrink-0 flex-col border-r border-line bg-surface-2/40 p-3">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-4" aria-hidden />
              <Input
                value={navFilter}
                onChange={(e) => setNavFilter(e.target.value)}
                placeholder="Search settings"
                className="h-8 rounded-md border-line-2 bg-paper pl-8 text-[12.5px]"
                aria-label="Search settings"
              />
            </div>
            <div className="mb-1.5 px-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-4">
              Settings
            </div>
            <ul className="space-y-0.5">
              {filteredSections.map((s) => {
                const Icon = s.icon;
                const active = activeSection === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(s.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13px] font-medium transition-colors",
                        active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/70"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {s.label}
                    </button>
                  </li>
                );
              })}
              {filteredSections.length === 0 ? (
                <li className="px-2.5 py-2 text-[12px] text-ink-4">No matches</li>
              ) : null}
            </ul>
          </nav>

          {/* Right pane */}
          <div className="min-w-0 flex-1 overflow-y-auto p-6">{renderSection()}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
