// Pure reducer for the agentic chat WebSocket protocol. No React, no side effects.
// The hook owns the socket + pushes a user message (and an empty assistant placeholder
// message) when the user sends; this reducer only folds server events into that
// placeholder (the LAST message in state.messages).

import type { Activity, ChatState, Message, ServerEvent } from "./types";

export function initialChatState(): ChatState {
  return {
    messages: [],
    streaming: false,
    awaiting: null,
    threadId: null,
  };
}

// Replace the last message with `update(last)`, but only when the last message is the
// assistant's. Returns the same array reference when there's nothing to update, so
// callers that don't touch messages don't need to special-case this.
function replaceLastAssistant(
  messages: Message[],
  update: (msg: Message) => Message,
): Message[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last.role !== "assistant") return messages;
  const updated = update(last);
  return messages.slice(0, -1).concat([updated]);
}

function upsertActivity(activities: Activity[], next: Activity): Activity[] {
  const idx = activities.findIndex((a) => a.name === next.name && a.kind === next.kind);
  if (idx === -1) return activities.concat([next]);
  return activities.map((a, i) => (i === idx ? next : a));
}

export function reduceChatEvent(state: ChatState, ev: ServerEvent): ChatState {
  switch (ev.type) {
    case "thread": {
      return { ...state, threadId: ev.id };
    }

    case "token": {
      const messages = replaceLastAssistant(state.messages, (msg) => ({
        ...msg,
        text: msg.text + ev.delta,
      }));
      return { ...state, messages, streaming: true };
    }

    case "thinking": {
      const messages = replaceLastAssistant(state.messages, (msg) => ({
        ...msg,
        thinking: (msg.thinking ?? "") + ev.delta,
      }));
      return { ...state, messages, streaming: true };
    }

    case "activity": {
      const messages = replaceLastAssistant(state.messages, (msg) => ({
        ...msg,
        activities: upsertActivity(msg.activities, {
          name: ev.name,
          kind: ev.kind,
          status: ev.status,
        }),
      }));
      return { ...state, messages };
    }

    case "permission_request": {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { type: _type, ...rest } = ev;
      const messages = replaceLastAssistant(state.messages, (msg) => ({
        ...msg,
        pending: "permission",
        permission: rest,
      }));
      return { ...state, messages, awaiting: "permission", streaming: false };
    }

    case "connect_required": {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { type: _type, ...rest } = ev;
      const messages = replaceLastAssistant(state.messages, (msg) => ({
        ...msg,
        pending: "connect",
        connect: rest,
      }));
      return { ...state, messages, awaiting: "connect", streaming: false };
    }

    case "done": {
      const messages = replaceLastAssistant(state.messages, (msg) => ({
        ...msg,
        text: ev.answer || msg.text,
        citations: ev.citations,
        thinkingSeconds: ev.thinking_seconds ?? msg.thinkingSeconds,
        done: true,
        pending: undefined,
      }));
      return { ...state, messages, streaming: false, awaiting: null };
    }

    case "error": {
      const messages = replaceLastAssistant(state.messages, (msg) => ({
        ...msg,
        error: ev.message || ev.text,
      }));
      return { ...state, messages, streaming: false, awaiting: null };
    }

    default:
      return state;
  }
}
