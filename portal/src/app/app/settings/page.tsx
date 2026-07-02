"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const supabase = createBrowserClient();
  const router = useRouter();
  const [botName, setBotName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [plan, setPlan] = useState("free");
  const [saving, setSaving] = useState(false);
  const [hasCalendar, setHasCalendar] = useState<boolean | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: profile }, { data: conn }] = await Promise.all([
        supabase.from("profiles").select("bot_name,plan,timezone").eq("user_id", user.id).single(),
        supabase.from("calendar_connections").select("id").eq("user_id", user.id).single(),
      ]);
      if (profile) {
        setBotName(profile.bot_name);
        setPlan(profile.plan);
        setTimezone(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      }
      setHasCalendar(Boolean(conn));
    }
    load();
  }, [supabase]);

  async function saveProfile() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ bot_name: botName }).eq("user_id", user.id);
    }
    setSaving(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>

      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold text-foreground">Connected Apps</h2>
        <p className="text-sm text-muted-foreground">
          Connect Gmail, Google Calendar, Notion, and Slack so your assistant can act on your behalf.
        </p>
        <a href="/app/settings/connections"
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Manage Connected Apps
        </a>
      </section>

      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold text-foreground">Google Calendar</h2>
        <p className="text-sm text-muted-foreground">
          {hasCalendar === null ? "Loading…" : hasCalendar ? "Connected." : "Not connected."}
        </p>
        <a href="/auth/login"
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          {hasCalendar ? "Reconnect Google Calendar" : "Connect Google Calendar"}
        </a>
      </section>

      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold text-foreground">Assistant</h2>
        <div className="space-y-1">
          <Label htmlFor="bot-name">Display name in meetings</Label>
          <Input id="bot-name" value={botName} onChange={(e) => setBotName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Timezone</Label>
          <p className="text-sm text-foreground">{timezone || "Detecting…"}</p>
          <p className="text-xs text-muted-foreground">
            Detected automatically from your device — so calendar times like “4 PM”
            mean your local time. No need to set it.
          </p>
        </div>
        <Button onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </section>

      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold text-foreground">Plan</h2>
        <p className="text-muted-foreground">
          Current plan: <span className="font-medium text-foreground capitalize">{plan}</span>
        </p>
        <Button variant="outline" disabled>Upgrade (coming soon)</Button>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <Button variant="destructive" onClick={signOut}>Sign out</Button>
      </section>
    </div>
  );
}
