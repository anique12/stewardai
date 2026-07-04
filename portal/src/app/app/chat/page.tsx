"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChat } from "@/hooks/useChat";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { Composer } from "@/components/chat/Composer";

function ChatInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");
  const { messages, streaming, connected, reason, threadId, send, decide, connectDone } =
    useChat(threadParam ?? undefined);

  // When a BRAND-NEW thread gets created (first message on a fresh chat with no
  // ?thread= yet), reflect its id in the URL so refresh + the sidebar can restore
  // it. Guard on `!threadParam` so navigating to an *existing* thread from the
  // sidebar isn't bounced back to the currently-loaded one.
  useEffect(() => {
    if (threadId && !threadParam) {
      router.replace(`/app/chat?thread=${threadId}`);
    }
  }, [threadId, threadParam, router]);

  function handleNewChat() {
    router.push("/app/chat");
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] gap-6">
      <aside className="hidden w-56 shrink-0 lg:block">
        <ChatSidebar activeThreadId={threadParam} onNewChat={handleNewChat} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!connected && reason && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-500">
            {reason}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full max-w-3xl flex-col">
            <ChatMessages
              messages={messages}
              streaming={streaming}
              onDecide={decide}
              onConnect={connectDone}
              onSkip={connectDone}
            />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl">
          <Composer onSend={send} disabled={streaming} />
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <ChatInner />
    </Suspense>
  );
}
