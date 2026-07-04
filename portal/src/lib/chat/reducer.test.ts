import { initialChatState, reduceChatEvent } from "@/lib/chat/reducer";
import type { ChatState, ServerEvent } from "@/lib/chat/types";

// The hook pushes an empty assistant placeholder message when the user sends; the
// reducer only ever folds server events into that placeholder. Build that starting
// state here so every test begins from the same shape the real hook produces.
function withAssistant(): ChatState {
  return {
    messages: [{ role: "assistant", text: "", thinking: "", activities: [], citations: [], done: false }],
    streaming: false,
    awaiting: null,
    threadId: null,
  };
}

describe("initialChatState", () => {
  it("starts empty", () => {
    expect(initialChatState()).toEqual({
      messages: [],
      streaming: false,
      awaiting: null,
      threadId: null,
    });
  });
});

describe("reduceChatEvent", () => {
  it("sets threadId on a thread event", () => {
    const state = reduceChatEvent(initialChatState(), { type: "thread", id: "t1" });
    expect(state.threadId).toBe("t1");
  });

  it("appends token deltas to the assistant text and marks streaming", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, { type: "token", delta: "Hel" });
    state = reduceChatEvent(state, { type: "token", delta: "lo" });
    expect(state.messages[0].text).toBe("Hello");
    expect(state.streaming).toBe(true);
  });

  it("upserts an activity by name+kind, ending with a single done entry", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, {
      type: "activity",
      kind: "tool",
      name: "kb_search",
      status: "started",
    });
    expect(state.messages[0].activities).toEqual([
      { name: "kb_search", kind: "tool", status: "started" },
    ]);

    state = reduceChatEvent(state, {
      type: "activity",
      kind: "tool",
      name: "kb_search",
      status: "done",
    });
    expect(state.messages[0].activities).toEqual([
      { name: "kb_search", kind: "tool", status: "done" },
    ]);
  });

  it("keeps distinct activities separate when name or kind differs", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, {
      type: "activity",
      kind: "tool",
      name: "kb_search",
      status: "started",
    });
    state = reduceChatEvent(state, { type: "activity", kind: "reasoning", status: "started" });
    expect(state.messages[0].activities).toHaveLength(2);
  });

  it("marks the message done and sets citations on a done event", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, { type: "token", delta: "Hello" });
    state = reduceChatEvent(state, {
      type: "done",
      answer: "Hello",
      citations: [{ n: 1, meeting_id: "m1", source_seq: 3, kind: "fact" }],
    });
    expect(state.messages[0].done).toBe(true);
    expect(state.messages[0].citations).toEqual([
      { n: 1, meeting_id: "m1", source_seq: 3, kind: "fact" },
    ]);
    expect(state.streaming).toBe(false);
    expect(state.awaiting).toBeNull();
  });

  it("falls back to the accumulated text when done.answer is empty", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, { type: "token", delta: "Hi there" });
    state = reduceChatEvent(state, { type: "done", answer: "", citations: [] });
    expect(state.messages[0].text).toBe("Hi there");
  });

  it("surfaces a permission_request and sets awaiting", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, {
      type: "permission_request",
      call_id: "c1",
      tool: "send_email",
      to: "a@b.com",
      subject: "hi",
      body: "test",
    });
    expect(state.messages[0].pending).toBe("permission");
    expect(state.messages[0].permission).toEqual({
      call_id: "c1",
      tool: "send_email",
      to: "a@b.com",
      subject: "hi",
      body: "test",
    });
    expect(state.awaiting).toBe("permission");
    expect(state.streaming).toBe(false);
  });

  it("surfaces a connect_required and sets awaiting", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, {
      type: "connect_required",
      call_id: "c2",
      app: "Notion",
    });
    expect(state.messages[0].pending).toBe("connect");
    expect(state.messages[0].connect).toEqual({ call_id: "c2", app: "Notion" });
    expect(state.awaiting).toBe("connect");
    expect(state.streaming).toBe(false);
  });

  it("clears pending/awaiting once a done event arrives after a permission request", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, {
      type: "connect_required",
      call_id: "c1",
      app: "Notion",
    });
    state = reduceChatEvent(state, { type: "done", answer: "ok", citations: [] });
    expect(state.messages[0].pending).toBeUndefined();
    expect(state.awaiting).toBeNull();
  });

  it("surfaces an error on the current message using message, falling back to text", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, { type: "error", message: "x" });
    expect(state.messages[0].error).toBe("x");
    expect(state.streaming).toBe(false);
    expect(state.awaiting).toBeNull();

    let state2 = withAssistant();
    state2 = reduceChatEvent(state2, { type: "error", text: "y" });
    expect(state2.messages[0].error).toBe("y");
  });

  it("leaves state unchanged for an unknown event type", () => {
    const state = withAssistant();
    const unknown = { type: "mystery" } as unknown as ServerEvent;
    const next = reduceChatEvent(state, unknown);
    expect(next).toEqual(state);
  });

  it("does not crash and leaves messages untouched when there is no assistant message", () => {
    const state = initialChatState();
    expect(() => reduceChatEvent(state, { type: "token", delta: "hi" })).not.toThrow();
    const next = reduceChatEvent(state, { type: "token", delta: "hi" });
    expect(next.messages).toEqual([]);
  });

  it("does not mutate the previous state (pure/immutable)", () => {
    const state = withAssistant();
    const next = reduceChatEvent(state, { type: "token", delta: "hi" });
    expect(state.messages[0].text).toBe("");
    expect(next).not.toBe(state);
    expect(next.messages).not.toBe(state.messages);
  });

  it("handles a full streaming sequence: tokens, activity, then done", () => {
    let state = withAssistant();
    state = reduceChatEvent(state, { type: "token", delta: "Hel" });
    state = reduceChatEvent(state, { type: "token", delta: "lo" });
    expect(state.messages[0].text).toBe("Hello");

    state = reduceChatEvent(state, {
      type: "activity",
      kind: "tool",
      name: "kb_search",
      status: "started",
    });
    state = reduceChatEvent(state, {
      type: "activity",
      kind: "tool",
      name: "kb_search",
      status: "done",
    });
    expect(state.messages[0].activities).toHaveLength(1);
    expect(state.messages[0].activities[0].status).toBe("done");

    state = reduceChatEvent(state, {
      type: "done",
      answer: "Hello",
      citations: [{ n: 1, meeting_id: "m1", source_seq: 3, kind: "fact" }],
    });
    expect(state.messages[0].done).toBe(true);
    expect(state.messages[0].citations).toHaveLength(1);
    expect(state.streaming).toBe(false);
    expect(state.awaiting).toBeNull();
  });
});
