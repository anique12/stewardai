// Event types + chat state shapes for the agentic chat WebSocket protocol.
// Pure types only — no React, no runtime logic here (see reducer.ts).

export type Citation = {
  n: number;
  meeting_id: string;
  source_seq: number | null;
  kind: string;
  text?: string;
};

export type ThreadEvent = {
  type: "thread";
  id: string;
};

export type TokenEvent = {
  type: "token";
  delta: string;
};

export type ThinkingEvent = {
  type: "thinking";
  delta: string;
};

export type ActivityKind = "tool" | "reasoning";
export type ActivityStatus = "started" | "done" | "error";

export type ActivityEvent = {
  type: "activity";
  kind: ActivityKind;
  name?: string;
  status: ActivityStatus;
};

// Server sends call_id + tool plus arbitrary preview fields (to/subject/body/space_id/...).
export type PermissionRequestEvent = {
  type: "permission_request";
  call_id: string;
  tool: string;
} & Record<string, unknown>;

export type ConnectRequiredEvent = {
  type: "connect_required";
  call_id: string;
  app: string;
  tool?: string;
} & Record<string, unknown>;

export type DoneEvent = {
  type: "done";
  answer: string;
  citations: Citation[];
  activities?: Activity[];
  thinking?: string;
  thinking_seconds?: number | null;
};

export type ErrorEvent = {
  type: "error";
  message?: string;
  text?: string;
};

export type ServerEvent =
  | ThreadEvent
  | TokenEvent
  | ThinkingEvent
  | ActivityEvent
  | PermissionRequestEvent
  | ConnectRequiredEvent
  | DoneEvent
  | ErrorEvent;

// Activity as tracked on a message (no "type" discriminant — this is state, not a wire event).
export type Activity = {
  name?: string;
  kind: ActivityKind;
  status: ActivityStatus;
};

export type Message = {
  role: "user" | "assistant";
  text: string;
  thinking: string;
  thinkingSeconds?: number | null;
  activities: Activity[];
  citations: Citation[];
  done: boolean;
  error?: string;
  pending?: "permission" | "connect";
  permission?: Record<string, unknown>;
  connect?: Record<string, unknown>;
};

export type ChatState = {
  messages: Message[];
  streaming: boolean;
  awaiting: null | "permission" | "connect";
  threadId: string | null;
};
