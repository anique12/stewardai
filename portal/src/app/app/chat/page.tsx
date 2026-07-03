"use client";

import { useChat } from "@/hooks/useChat";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { Composer } from "@/components/chat/Composer";

export default function ChatPage() {
  const { messages, streaming, connected, reason, send } = useChat();

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] gap-6">
      {/* Placeholder left rail — Task 3 replaces this with the real thread list. */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          Chat threads coming soon.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!connected && reason && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-500">
            {reason}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full max-w-3xl flex-col">
            <ChatMessages messages={messages} streaming={streaming} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl">
          <Composer onSend={send} disabled={streaming} />
        </div>
      </div>
    </div>
  );
}
