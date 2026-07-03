export type Citation = {
  n: number;
  meeting_id: string;
  source_seq: number | null;
  kind: string;
  snippet: string;
};

export type AskResult = { answer: string; citations: Citation[] };

export type AnswerPart =
  | { type: "text"; value: string }
  | { type: "cite"; n: number };

// Split an answer string into text runs and [n] citation tokens for rendering.
export function splitAnswerWithCitations(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: answer.slice(last, m.index) });
    parts.push({ type: "cite", n: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push({ type: "text", value: answer.slice(last) });
  return parts.length ? parts : [{ type: "text", value: answer }];
}

export async function askQuestion(
  auth: { baseUrl: string; token: string },
  req: { query: string; spaceId: string | null },
): Promise<AskResult> {
  const res = await fetch(`${auth.baseUrl}/api/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ query: req.query, space_id: req.spaceId }),
  });
  if (!res.ok) throw new Error(`Ask failed (${res.status})`);
  return (await res.json()) as AskResult;
}
