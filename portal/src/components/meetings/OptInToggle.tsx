"use client";

import { Switch } from "@/components/ui/switch";
import { createBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function OptInToggle({ meetingId, initialValue }: { meetingId: string; initialValue: boolean }) {
  const [checked, setChecked] = useState(initialValue);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function toggle(value: boolean) {
    setLoading(true);
    setChecked(value);
    const supabase = createBrowserClient();
    await supabase.from("meetings").update({ opted_in: value }).eq("id", meetingId);
    router.refresh();
    setLoading(false);
  }

  return <Switch checked={checked} onCheckedChange={toggle} disabled={loading} aria-label="Send StewardAI to this meeting" />;
}
