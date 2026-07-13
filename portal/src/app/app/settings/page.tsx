"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { ErrorState } from "@/components/common/ErrorState";
import { AppIcon } from "@/components/integrations/AppCard";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/app-shell/ThemeProvider";
import { createBrowserClient } from "@/lib/supabase/client";
import { toolFriendlyLabel } from "@/lib/tool-permissions";
import { cn } from "@/lib/utils";

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-3">
      {children}
    </div>
  );
}

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
    description: "Steward joins all new meetings on your calendar that have a video link.",
  },
  {
    value: "organizer",
    label: "Only meetings I organize",
    description: "Steward joins only meetings you host.",
  },
  {
    value: "none",
    label: "Don't join automatically",
    description: "Steward joins nothing until you turn it on per meeting.",
  },
];

/** "Auto-join" card — pick the default `opted_in` policy for newly-synced meetings. */
function AutoJoinCard({
  policy,
  onChange,
  saving,
}: {
  policy: AutoJoinPolicy;
  onChange: (policy: AutoJoinPolicy) => void;
  saving: boolean;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-[18px]">
      <CardLabel>Auto-join</CardLabel>
      <p className="mb-3.5 text-[12.5px] leading-relaxed text-ink-2">
        Choose which new meetings Steward auto-joins by default when your calendar syncs.
      </p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Auto-join policy">
        {AUTO_JOIN_OPTIONS.map((opt) => {
          const selected = policy === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => onChange(opt.value)}
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
    </section>
  );
}

/** "Automatic approvals" card — view & revoke the tools a user has "Always allow"-ed in chat. */
function AutoApprovalsCard() {
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
    <section className="rounded-lg border border-line bg-surface p-[18px]">
      <CardLabel>Automatic approvals</CardLabel>
      <p className="mb-3.5 text-[12.5px] leading-relaxed text-ink-2">
        Tools you&apos;ve told Steward to always run without asking first. Revoke any of these to have
        Steward ask again next time.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : isError || !permissions || permissions.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-md border border-dashed border-line-2 px-3.5 py-3 text-[12.5px] text-ink-3">
          <ShieldCheck className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
          No automatic approvals — Steward asks before every outward action.
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
    </section>
  );
}

export default function SettingsPage() {
  const supabase = createBrowserClient();
  const router = useRouter();
  const { theme, toggle } = useTheme();

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

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      const [{ data: profile, error: profileErr }, { data: conn }] = await Promise.all([
        supabase
          .from("profiles")
          .select("bot_name,plan,timezone,auto_join_policy,allow_meeting_speech")
          .eq("user_id", user.id)
          .single(),
        supabase.from("calendar_connections").select("id").eq("user_id", user.id).single(),
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
      setHasCalendar(Boolean(conn));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (phase === "loading") {
    return (
      <div className="mx-auto max-w-[620px] space-y-6">
        <PageHeader title="Settings" subtitle="Manage your assistant, calendar, and plan." />
        <div className="flex flex-col gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-[620px]">
        <PageHeader title="Settings" subtitle="Manage your assistant, calendar, and plan." />
        <ErrorState
          title="Couldn't load settings"
          body="Something went wrong fetching your account settings."
          onRetry={load}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[620px] space-y-6">
      <PageHeader title="Settings" subtitle="Manage your assistant, calendar, and plan." />

      <div className="flex flex-col gap-3.5">
        {/* Calendar connection */}
        <section className="rounded-lg border border-line bg-surface p-[18px]">
          <CardLabel>Calendar connection</CardLabel>
          <div className="flex flex-wrap items-center gap-3">
            <AppIcon slug="googlecalendar" name="Google Calendar" />
            <div className="min-w-[160px] flex-1">
              <div className="text-[13.5px] font-semibold text-foreground">Google Calendar</div>
              {email && <div className="text-xs text-ink-3">{email} · read-only</div>}
            </div>
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
        </section>

        {/* Auto-join */}
        <AutoJoinCard policy={autoJoinPolicy} onChange={saveAutoJoinPolicy} saving={savingPolicy} />

        {/* Wake word */}
        <section className="rounded-lg border border-line bg-surface p-[18px]">
          <CardLabel>Steward&apos;s name / wake word</CardLabel>
          <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
            What you say to address the agent out loud in a meeting — e.g. &ldquo;
            <span className="font-semibold text-foreground">{botName || "Steward"}</span>, summarize where we are.&rdquo;
          </p>
          <div className="flex max-w-[320px] items-center gap-2.5">
            <span className="text-[13px] text-ink-3">Hey</span>
            <Input
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              className="h-auto flex-1 rounded-md border-line-2 bg-paper px-3 py-[9px] text-[13.5px] font-semibold"
              aria-label="Steward's name / wake word"
            />
          </div>
          <div className="mt-1 space-y-1">
            <p className="text-xs text-ink-4">
              Timezone: {timezone || "Detecting…"} — detected automatically from your device.
            </p>
          </div>
          <div className="mt-3.5">
            <Button onClick={saveProfile} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </section>

        {/* Speak in meetings */}
        <section className="rounded-lg border border-line bg-surface p-[18px]">
          <CardLabel>Let Steward speak in meetings</CardLabel>
          <div className="flex items-start justify-between gap-3">
            <p className="max-w-[440px] text-[12.5px] leading-relaxed text-ink-2">
              When off, Steward silently takes notes and does everything after the
              meeting — it won&apos;t talk in the room.
            </p>
            <Switch
              checked={allowMeetingSpeech}
              onCheckedChange={saveAllowMeetingSpeech}
              disabled={savingSpeech}
              aria-label="Let Steward speak in meetings"
            />
          </div>
        </section>

        {/* Plan */}
        <section className="rounded-lg border border-line bg-surface p-[18px]">
          <CardLabel>Plan</CardLabel>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[160px] flex-1">
              <div className="flex items-center gap-2">
                <span className="font-display text-[15px] font-bold capitalize">{plan}</span>
                <span className="rounded-pill border border-brand-weak-2 bg-brand-weak px-[7px] py-[2px] font-mono text-[9.5px] font-semibold text-brand">
                  Current
                </span>
              </div>
              <div className="mt-0.5 text-xs text-ink-3">Billing &amp; upgrades are coming soon.</div>
            </div>
            <Button
              variant="outline"
              disabled
              title="Coming soon"
              className="px-[14px] py-2 text-[12.5px]"
            >
              Manage plan
            </Button>
          </div>
        </section>

        {/* Automatic approvals */}
        <AutoApprovalsCard />

        {/* Appearance */}
        <section className="rounded-lg border border-line bg-surface p-[18px]">
          <CardLabel>Appearance</CardLabel>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { if (theme !== "light") toggle(); }}
              className={cn(
                "flex flex-1 flex-col gap-[9px] rounded-md border p-3.5 text-left transition-colors hover:bg-surface-2",
                theme === "light" ? "border-brand bg-brand-weak" : "border-line"
              )}
            >
              <span className="flex h-9 items-center gap-[5px] rounded-sm border border-[#e4dfd3] bg-[#f4f1ea] px-2">
                <Sun className="h-3 w-3 text-[#2c6b58]" aria-hidden />
                <span className="h-[5px] flex-1 rounded-sm bg-[#d5cfc0]" />
              </span>
              <span className="text-[12.5px] font-semibold">Light</span>
            </button>
            <button
              type="button"
              onClick={() => { if (theme !== "dark") toggle(); }}
              className={cn(
                "flex flex-1 flex-col gap-[9px] rounded-md border p-3.5 text-left transition-colors hover:bg-surface-2",
                theme === "dark" ? "border-brand bg-brand-weak" : "border-line"
              )}
            >
              <span className="flex h-9 items-center gap-[5px] rounded-sm border border-[#2c2a21] bg-[#131310] px-2">
                <Moon className="h-3 w-3 text-[#57b899]" aria-hidden />
                <span className="h-[5px] flex-1 rounded-sm bg-[#38352a]" />
              </span>
              <span className="text-[12.5px] font-semibold">Dark</span>
            </button>
          </div>
        </section>

        {/* Account / sign out */}
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-[18px]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-brand-weak-2 text-[14px] font-bold text-brand-ink">
            {email ? initials(email) : "?"}
          </span>
          <div className="min-w-[160px] flex-1">
            <div className="text-[13.5px] font-semibold text-foreground">{email ? email.split("@")[0] : "Account"}</div>
            <div className="text-xs text-ink-3">{email}</div>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="inline-flex items-center gap-[7px] rounded-md border border-danger bg-danger-weak px-[14px] py-2 text-[12.5px] font-semibold text-danger transition-colors hover:opacity-90 disabled:opacity-60"
          >
            <LogOut className="h-[15px] w-[15px]" aria-hidden />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </section>
      </div>
    </div>
  );
}
