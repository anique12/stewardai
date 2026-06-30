import { signDemoToken } from "@/lib/demo-token";
import { NextRequest, NextResponse } from "next/server";

// Simple in-memory per-IP rate limit. Loosened for testing (each failed connect
// attempt + retry burns a token); tighten before a public launch.
const MAX_TOKENS_PER_HOUR = 60;
const ipMap = new Map<string, { count: number; resetAt: number }>();

function getRateLimitResult(ip: string): "ok" | "limited" {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const entry = ipMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + hourMs });
    return "ok";
  }
  if (entry.count >= MAX_TOKENS_PER_HOUR) return "limited";
  entry.count += 1;
  return "ok";
}

export async function GET(request: NextRequest) {
  const secret = process.env.DEMO_TOKEN_SECRET;
  if (!secret) return NextResponse.json({ error: "Demo not configured" }, { status: 503 });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (getRateLimitResult(ip) === "limited") {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const token = await signDemoToken(secret);
  return NextResponse.json({ token });
}
