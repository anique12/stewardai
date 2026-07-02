import { TimezoneSync } from "@/components/TimezoneSync";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  return (
    <div className="flex h-screen flex-col bg-background">
      <TimezoneSync />
      <nav className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
        <span className="font-bold text-foreground">StewardAI</span>
        <div className="flex items-center gap-4 text-sm">
          <a href="/app" className="text-muted-foreground hover:text-foreground">Meetings</a>
          <a href="/app/settings" className="text-muted-foreground hover:text-foreground">Settings</a>
          <a href="/app/settings/connections" className="text-muted-foreground hover:text-foreground">Connected Apps</a>
        </div>
      </nav>
      <main className="min-h-0 w-full flex-1 overflow-y-auto px-6 py-10 lg:px-10">{children}</main>
    </div>
  );
}
