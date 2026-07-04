"use client";

// Manages the agentic chat WebSocket + ChatState. The socket is opened lazily
// (on the first `send`, not on mount) — see `openSocket`. `connected`/`reason`
// are set eagerly from a cheap, non-connecting config check on mount so the
// page can show a hint ("chat isn't configured…") before the user ever sends
// a message, then get overwritten with the real socket state once one opens.

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { initialChatState, reduceChatEvent } from "@/lib/chat/reducer";
import type { ChatState, Message, ServerEvent } from "@/lib/chat/types";

export type PermissionDecision = "approve" | "reject" | "always";

export type UseChatResult = {
  messages: Message[];
  streaming: boolean;
  awaiting: ChatState["awaiting"];
  connected: boolean;
  reason: string | null;
  threadId: string | null;
  send: (text: string) => void;
  decide: (decision: PermissionDecision, args?: Record<string, unknown>) => void;
  connectDone: () => void;
};

const NOT_CONFIGURED = "Chat isn't configured — set NEXT_PUBLIC_CHAT_WS_URL.";
const NOT_SIGNED_IN = "Sign in to use chat.";
const CONNECTION_FAILED = "Chat connection failed. Send a message to retry.";

function emptyAssistantMessage(): Message {
  return { role: "assistant", text: "", activities: [], citations: [], done: false };
}

function newUserMessage(text: string): Message {
  return { role: "user", text, activities: [], citations: [], done: true };
}

async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = createBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function useChat(
  initialThreadId?: string,
  onThreadCreated?: (id: string) => void,
): UseChatResult {
  const [state, setState] = useState<ChatState>(() => initialChatState());
  const [connected, setConnected] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // Keep the latest onThreadCreated callback reachable from the (long-lived)
  // socket's onmessage closure without re-opening the socket.
  const onThreadCreatedRef = useRef(onThreadCreated);
  useEffect(() => {
    onThreadCreatedRef.current = onThreadCreated;
  });

  useEffect(() => {
    threadIdRef.current = state.threadId;
  }, [state.threadId]);

  // Mount/unmount bookkeeping + final socket cleanup.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Cheap readiness check (no socket opened) so the page has an accurate
  // connected/reason pair to show before the first message is sent.
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_CHAT_WS_URL;
    if (!wsUrl) {
      setConnected(false);
      setReason(NOT_CONFIGURED);
      return;
    }
    void getAccessToken().then((token) => {
      if (!mountedRef.current) return;
      if (!token) {
        setConnected(false);
        setReason(NOT_SIGNED_IN);
        return;
      }
      setConnected(true);
      setReason(null);
    });
  }, []);

  // Load an existing thread's history on mount / when the selected thread changes.
  // The thread id lives in the URL, so refresh + sidebar navigation restore it.
  useEffect(() => {
    const tid = initialThreadId;
    if (!tid) {
      // "New chat" (no thread in URL): clear only if a thread is currently loaded.
      if (threadIdRef.current) setState(initialChatState());
      return;
    }
    if (tid === threadIdRef.current) return; // already have it (we created or loaded it)
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/chat/threads/${tid}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const messages: Message[] = Array.isArray(data?.messages) ? data.messages : [];
        setState({ messages, streaming: false, awaiting: null, threadId: tid });
      } catch {
        /* best-effort — leave state as-is */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialThreadId]);

  const openSocket = useCallback((): Promise<WebSocket | null> => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return Promise.resolve(wsRef.current);
    }

    const wsUrl = process.env.NEXT_PUBLIC_CHAT_WS_URL;
    if (!wsUrl) {
      setConnected(false);
      setReason(NOT_CONFIGURED);
      return Promise.resolve(null);
    }

    return getAccessToken().then((token) => {
      if (!token) {
        setConnected(false);
        setReason(NOT_SIGNED_IN);
        return null;
      }

      return new Promise<WebSocket | null>((resolve) => {
        const ws = new WebSocket(`${wsUrl}?token=${token}`);
        wsRef.current = ws;
        let settled = false;

        ws.onopen = () => {
          if (mountedRef.current) {
            setConnected(true);
            setReason(null);
          }
          if (!settled) {
            settled = true;
            resolve(ws);
          }
        };
        ws.onclose = () => {
          if (wsRef.current === ws) wsRef.current = null;
          if (mountedRef.current) setConnected(false);
          if (!settled) {
            settled = true;
            resolve(null);
          }
        };
        ws.onerror = () => {
          if (mountedRef.current) {
            setConnected(false);
            setReason(CONNECTION_FAILED);
          }
          if (!settled) {
            settled = true;
            resolve(null);
          }
        };
        ws.onmessage = (ev: MessageEvent) => {
          let parsed: ServerEvent;
          try {
            parsed = JSON.parse(ev.data);
          } catch {
            return;
          }
          // A `thread` event means the backend just CREATED a new thread — the
          // one moment to reflect it in the URL (never fires on load/reset).
          if (parsed.type === "thread" && parsed.id) onThreadCreatedRef.current?.(parsed.id);
          setState((s) => reduceChatEvent(s, parsed));
        };
      });
    });
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setState((s) => ({
        ...s,
        messages: s.messages.concat([newUserMessage(trimmed), emptyAssistantMessage()]),
        streaming: true,
      }));

      const threadId = threadIdRef.current;
      let tz: string | undefined;
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        tz = undefined;
      }
      void openSocket().then((ws) => {
        ws?.send(
          JSON.stringify({
            type: "user_message",
            text: trimmed,
            thread_id: threadId ?? undefined,
            tz,
          }),
        );
      });
    },
    [openSocket],
  );

  const decide = useCallback(
    (decision: PermissionDecision, args?: Record<string, unknown>) => {
      setState((s) => ({ ...s, awaiting: null }));
      wsRef.current?.send(
        JSON.stringify({ type: "permission_decision", decision, args }),
      );
    },
    [],
  );

  const connectDone = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "connect_done" }));
  }, []);

  return {
    messages: state.messages,
    streaming: state.streaming,
    awaiting: state.awaiting,
    connected,
    reason,
    threadId: state.threadId,
    send,
    decide,
    connectDone,
  };
}
