"use client";

import { useState } from "react";
import { Mic } from "lucide-react";
import {
  Dialog,
  DialogContent,
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

      <DialogContent className="max-w-sm overflow-hidden border-border bg-card sm:rounded-3xl">
        {/* Title kept for screen readers / Radix a11y, hidden visually so the
            orb is the sole focus. */}
        <DialogTitle className="sr-only">Talk to Steward</DialogTitle>
        {/* Faint radial wash that seats the ring in the panel while keeping the
            ring's dark hole clean: transparent at the center, a soft tint out
            where the band sits, fading away past it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,transparent_18%,hsl(var(--primary)/0.09)_40%,transparent_66%)]"
        />
        <div className="relative px-6 pb-8 pt-10">
          {open ? <VoiceDemo /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
