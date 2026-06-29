import { google, calendar_v3 } from "googleapis";

export function buildMeetingUpsert(userId: string, event: calendar_v3.Schema$Event) {
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video"
  );
  return {
    user_id: userId,
    google_event_id: event.id as string,
    title: (event.summary as string | undefined) ?? "Untitled",
    start_time: event.start?.dateTime ?? event.start?.date,
    end_time: event.end?.dateTime ?? event.end?.date,
    meet_url: videoEntry?.uri ?? null,
  };
}

export async function fetchUpcomingEvents(refreshToken: string) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2 });
  const now = new Date();
  const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: inThreeDays.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  return res.data.items ?? [];
}
