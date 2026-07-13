"use client";

import { Suspense, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChat } from "@/hooks/useChat";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { Composer } from "@/components/chat/Composer";

function ChatInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");

  // Pin a freshly-created thread to the URL (so refresh + the sidebar restore it).
  // Fires only from the WS `thread` event, so it never bounces navigation.
  const onThreadCreated = useCallback(
    (id: string) => router.replace(`/app/chat?thread=${id}`),
    [router],
  );
  const { messages, streaming, connected, reason, send, decide, connectDone } = useChat(
    threadParam ?? undefined,
    onThreadCreated,
  );

  function handleNewChat() {
    router.push("/app/chat");
  }

  // Keep the view pinned to the latest message — on open (thread load) and as
  // new tokens/messages stream in.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] gap-6">
      <aside className="hidden w-[240px] shrink-0 rounded-xl border border-line bg-surface p-3 shadow-sh-1 lg:block">
        <ChatSidebar activeThreadId={threadParam} onNewChat={handleNewChat} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!connected && reason && (
          <div className="mb-4 rounded-lg border border-attention bg-attention-weak px-4 py-2 text-sm text-attention-strong">
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
              onSuggest={(text) => send(text)}
            />
            <div ref={endRef} />
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
    <Suspense fallback={<div className="p-6 text-sm text-ink-3">Loading…</div>}>
      <ChatInner />
    </Suspense>
  );
}

