"use client";

import { useChat } from "@/hooks/useChat";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { Composer } from "@/components/chat/Composer";

export default function ChatPage() {
  const { messages, streaming, connected, reason, send, decide, connectDone } = useChat();

  function handleNewChat() {
    // Simplest v1 reset: reload the page to drop in-memory state; the next
    // message opens a fresh socket/thread.
    window.location.reload();
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] gap-6">
      <aside className="hidden w-56 shrink-0 lg:block">
        <ChatSidebar onNewChat={handleNewChat} />
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
