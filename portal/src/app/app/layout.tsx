import { cookies } from "next/headers";
import { TimezoneSync } from "@/components/TimezoneSync";
import { Sidebar } from "@/components/app-shell/Sidebar";
import { ThemeProvider } from "@/components/app-shell/ThemeProvider";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);

  return (
    <ThemeProvider initial={theme}>
      <div className={`${theme === "dark" ? "dark " : ""}flex h-screen flex-col bg-background lg:flex-row`}>
        <TimezoneSync />
        <Sidebar email={user.email ?? "Account"} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}
