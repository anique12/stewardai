import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

type ParsedMeeting = {
  platform: "google_meet" | "zoom" | "teams";
  native_meeting_id: string;
  meet_url: string;
  title: string;
};

/**
 * Parse a pasted meeting link into (platform, native_meeting_id).
 * Returns null if the URL isn't a recognizable meeting link.
 */
function parseMeetingUrl(raw: string): ParsedMeeting | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();

  // Google Meet: https://meet.google.com/<code>  (code form: xxx-xxxx-xxx)
  if (host === "meet.google.com") {
    const code = url.pathname.replace(/^\/+/, "").split("/")[0];
    if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i.test(code)) {
      return {
        platform: "google_meet",
        native_meeting_id: code,
        meet_url: `https://meet.google.com/${code}`,
        title: `Google Meet · ${code}`,
      };
    }
    return null;
  }

  // Zoom: https://<subdomain>.zoom.us/j/<id>  (id is numeric)
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    const match = url.pathname.match(/\/j\/(\d+)/);
    if (match) {
      const id = match[1];
      return {
        platform: "zoom",
        native_meeting_id: id,
        meet_url: url.toString(),
        title: `Zoom · ${id}`,
      };
    }
    return null;
  }

  // Microsoft Teams: https://teams.microsoft.com/...  (keep full URL as native id)
  if (host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com")) {
    return {
      platform: "teams",
      native_meeting_id: url.toString(),
      meet_url: url.toString(),
      title: "Microsoft Teams meeting",
    };
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const url =
      body && typeof body === "object" && "url" in body
        ? (body as { url: unknown }).url
        : undefined;

    if (typeof url !== "string" || url.trim().length === 0) {
      return NextResponse.json(
        { error: "A meeting link is required." },
        { status: 400 }
      );
    }

    const parsed = parseMeetingUrl(url);
    if (!parsed) {
      return NextResponse.json(
        {
          error:
            "That doesn't look like a Google Meet, Zoom, or Teams link. Paste a full meeting URL and try again.",
        },
        { status: 400 }
      );
    }

    const now = new Date();
    const endTime = new Date(now.getTime() + 60 * 60 * 1000); // +1 hour

    const service = createServiceClient();
    const { data: inserted, error: insertError } = await service
      .from("meetings")
      .insert({
        user_id: user.id,
        // No real Google event backs an instant join — synthesize a unique id
        // so the UNIQUE(user_id, google_event_id) constraint is satisfied.
        google_event_id: `instant-${randomUUID()}`,
        title: parsed.title,
        start_time: now.toISOString(),
        end_time: endTime.toISOString(),
        meet_url: parsed.meet_url,
        native_meeting_id: parsed.native_meeting_id,
        // Instant join: opt in immediately and mark pending so the backend
        // scheduler picks it up on its next poll.
        opted_in: true,
        bot_status: "pending",
      })
      .select("id,title,start_time,meet_url,opted_in,bot_status,native_meeting_id")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        { error: "Failed to create instant meeting. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json(inserted, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Something went wrong creating the instant meeting." },
      { status: 500 }
    );
  }
}
