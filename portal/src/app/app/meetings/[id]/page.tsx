import { ActionItemsPanel } from "@/components/meetings/ActionItemsPanel";
import { StatusBadge } from "@/components/meetings/StatusBadge";
import { SummaryPanel } from "@/components/meetings/SummaryPanel";
import { TranscriptPanel } from "@/components/meetings/TranscriptPanel";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createServiceClient();

  const { data: meeting } = await service
    .from("meetings")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!meeting) notFound();

  const [{ data: segments }, { data: summary }, { data: actionItems }] = await Promise.all([
    service.from("transcript_segments").select("*").eq("meeting_id", params.id).order("seq"),
    service.from("summaries").select("*").eq("meeting_id", params.id).single(),
    service.from("action_items").select("*").eq("meeting_id", params.id).order("created_at"),
  ]);

  const start = new Date(meeting.start_time);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{meeting.title}</h1>
          <p className="text-muted-foreground">
            {start.toLocaleDateString()} · {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {meeting.meet_url && (
              <a href={meeting.meet_url} target="_blank" rel="noopener noreferrer"
                className="ml-2 text-primary hover:underline">Join</a>
            )}
          </p>
        </div>
        <StatusBadge status={meeting.bot_status} />
      </div>

      <Tabs defaultValue="transcript">
        <TabsList>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="actions">Action Items</TabsTrigger>
        </TabsList>
        <TabsContent value="transcript" className="mt-4">
          <TranscriptPanel segments={segments ?? []} />
        </TabsContent>
        <TabsContent value="summary" className="mt-4">
          <SummaryPanel summary={summary ?? null} />
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          <ActionItemsPanel items={actionItems ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
