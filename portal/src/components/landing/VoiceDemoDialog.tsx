"use client";

import { useState } from "react";
import { Mic } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VoiceDemo } from "./VoiceDemo";
import { cn } from "@/lib/utils";

/**
 * Renders a "Talk to Steward" button that opens a modal hosting the live
 * VoiceDemo widget. VoiceDemo is mounted only while the dialog is open so the
 * mic / websocket session is torn down on close (VoiceDemo cleans up on
 * unmount). The underlying VoiceDemo behavior is unchanged.
 */
export function VoiceDemoDialog({
  variant = "solid",
  className,
  label = "Talk to Steward",
}: {
  variant?: "solid" | "ghost" | "outline";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const styles = {
    solid: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline:
      "border border-border bg-transparent text-foreground hover:border-primary/60 hover:text-primary",
    ghost: "text-foreground hover:text-primary",
  }[variant];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(base, styles, className)}
      >
        <Mic className="h-4 w-4" aria-hidden />
        {label}
      </button>

      <DialogContent className="max-w-md border-border bg-card sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary">
              <Mic className="h-4 w-4" aria-hidden />
            </span>
            Talk to Steward
          </DialogTitle>
          <DialogDescription>
            A live, in-browser voice agent — built on the same real-time pipeline
            you can ship. Mic required, ~60-second session.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-border bg-background/60 p-6">
          {open ? <VoiceDemo /> : null}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Sub-second turn-taking · barge-in · streaming STT &amp; TTS
        </p>
      </DialogContent>
    </Dialog>
  );
}
