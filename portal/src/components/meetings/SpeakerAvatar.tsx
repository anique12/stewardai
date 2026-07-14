import { PersonAvatar } from "@/components/common/PersonAvatar";

/**
 * Thin wrapper around `PersonAvatar` sized/shaped for the transcript timeline
 * and space person lists. Callers that only have a speaker/entity `name`
 * (no email or stored photo) still get the colored-initial fallback exactly
 * as before; pass `email`/`photoUrl` when known so a real photo can show.
 */
export function SpeakerAvatar({
  name,
  email,
  photoUrl,
}: {
  name: string;
  email?: string | null;
  photoUrl?: string | null;
}) {
  return <PersonAvatar name={name} email={email} photoUrl={photoUrl} size={28} className="h-7 w-7 text-xs" />;
}
