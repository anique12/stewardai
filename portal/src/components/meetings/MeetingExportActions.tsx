"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

export function MeetingExportActions({ markdown, filename }: { markdown: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      download(); // fallback if clipboard is unavailable
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-md border border-line-2 bg-surface px-2.5 py-1.5 font-mono text-[11.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink";

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={copy} className={btn}>
        {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button type="button" onClick={download} className={btn}>
        <Download className="h-3.5 w-3.5" /> Export
      </button>
    </div>
  );
}
