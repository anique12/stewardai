import { redirect } from "next/navigation";

// `/app/settings` is no longer a real page — Settings opens as a client-state
// modal over whatever page you're on (see AppChrome + SettingsModal). This
// route only exists so old bookmarks/deep-links still work: redirect to the
// app shell and signal it to open the modal via the `settings=1` param,
// which AppChrome reads once on mount and then strips from the URL.
export default function SettingsPage() {
  redirect("/app?settings=1");
}
