import Link from "next/link";

const SUGGESTIONS = [
  "What did I commit to this week?",
  "Summarize my open action items",
  "What's changed in my top spaces?",
];

export function AskBar() {
  return (
    <div className="mb-5 rounded-[15px] border-[1.5px] border-brand-weak-2 bg-brand-weak p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-brand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" fill="var(--on-brand)" />
            <path
              d="M6.5 6.5a7.8 7.8 0 000 11M17.5 6.5a7.8 7.8 0 010 11"
              stroke="var(--on-brand)"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <Link
          href="/app/chat"
          className="min-w-[180px] flex-1 rounded-lg border border-line-2 bg-surface px-[14px] py-[10px] text-left text-[13.5px] text-ink-3 hover:bg-surface-2"
        >
          Ask Steward anything across your work…
        </Link>
      </div>
      <div className="mt-[11px] flex flex-wrap gap-2">
        {SUGGESTIONS.map((text) => (
          <Link
            key={text}
            href="/app/chat"
            className="inline-flex items-center gap-[6px] rounded-pill border border-brand-weak-2 bg-surface px-3 py-[6px] text-xs font-medium text-brand-ink hover:bg-surface-2"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-brand">
              <path d="M13 3l-2 9h6l-8 9 2-9H5l8-9z" fill="currentColor" />
            </svg>
            {text}
          </Link>
        ))}
      </div>
    </div>
  );
}
