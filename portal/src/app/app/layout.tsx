import { TimezoneSync } from "@/components/TimezoneSync";
import { Sidebar } from "@/components/app-shell/Sidebar";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  return (
    <div className="flex h-screen flex-col bg-background lg:flex-row">
      <TimezoneSync />
      <Sidebar email={user.email ?? "Account"} />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
