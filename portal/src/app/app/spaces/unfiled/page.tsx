import Link from "next/link";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfidenceBadge } from "@/components/common/ConfidenceBadge";
import { cleanTldr } from "@/lib/meetings/tldr";
import { FileMeetingControl, confidenceLevel, type SpaceOption } from "@/components/spaces/FileMeetingControl";

export const dynamic = "force-dynamic";

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 12l2.3 2.3L15.5 9.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function UnfiledPage() {
  const user = await requireUserPage();
  const db = createServerClient();

  const [{ data: meetings }, { data: spaces }] = await Promise.all([
    db.from("meetings")
      .select("id,title,start_time,space_id,space_source,space_confidence")
      // Only processed (done) meetings are reviewable — an upcoming meeting has
      // no content to file yet, so it must not show up as "to review".
      .eq("user_id", user.id).eq("bot_status", "done")
      .or("space_source.in.(suggested,unfiled),space_id.is.null")
      .order("start_time", { ascending: false }),
    db.from("spaces").select("id,name").eq("user_id", user.id).eq("status", "active").order("name"),
  ]);

  const meetingList = meetings ?? [];
  const meetingIds = meetingList.map((m) => m.id);
  const tldrById = new Map<string, string | null>();
  if (meetingIds.length > 0) {
    const { data: summaries } = await db.from("summaries").select("meeting_id,tldr").in("meeting_id", meetingIds);
    for (const s of summaries ?? []) tldrById.set(s.meeting_id, cleanTldr(s.tldr));
  }

  const spaceOptions = (spaces ?? []) as SpaceOption[];
  const nameById = new Map(spaceOptions.map((s) => [s.id, s.name]));

  return (
    <div className="mx-auto max-w-[760px] pb-[60px]">
      <Link href="/app/spaces" className="mb-3.5 inline-flex items-center gap-[6px] text-xs text-ink-3 hover:text-ink">
        ← Spaces
      </Link>
      <h1 className="mb-1 font-display text-2xl font-bold tracking-tight text-ink">Review queue</h1>
      <p className="mb-[22px] text-[13px] text-ink-3">
        MeetBase files most meetings on its own. These it wasn&apos;t sure about — confirm its guess, pick another
        space, or file somewhere new. Nothing is locked in.
      </p>

      {meetingList.length === 0 ? (
        <EmptyState
          icon={<CheckCircleIcon />}
          title="All caught up"
          body="Every meeting is filed with confidence. When MeetBase isn't sure where something belongs, it'll wait for you here."
        />
      ) : (
        <div className="flex flex-col gap-3.5">
          {meetingList.map((m) => {
            // A 'suggested' meeting already has its best-guess space_id; offer it as a one-tap confirm.
            const suggestedId = m.space_source === "suggested" ? m.space_id : null;
            const suggestedName = suggestedId ? nameById.get(suggestedId) ?? null : null;
            const line = tldrById.get(m.id) ?? "No summary yet.";
            return (
              <div key={m.id} className="rounded-lg border border-line bg-surface p-4 shadow-sh-1">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface-2 text-ink-3">
                    <DocIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/meetings/${m.id}`} className="text-[14px] font-semibold text-ink hover:underline">
                      {m.title}
                    </Link>
                    <div className="mb-[5px] mt-[2px] font-mono text-[11px] text-ink-3">
                      {new Date(m.start_time).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <p className="text-[12.5px] leading-[1.45] text-ink-2">{line}</p>
                  </div>
                </div>
                <div className="mt-3.5 flex flex-wrap items-center gap-[10px] border-t border-line pt-[13px]">
                  {suggestedId ? (
                    <>
                      <span className="text-[11.5px] text-ink-3">MeetBase suggests</span>
                      <ConfidenceBadge level={confidenceLevel(m.space_confidence)} />
                    </>
                  ) : null}
                  <span className="flex-1" />
                  <FileMeetingControl
                    meetingId={m.id}
                    spaces={spaceOptions}
                    suggestedSpaceId={suggestedId}
                    suggestedSpaceName={suggestedName}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
