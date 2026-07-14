"use client";

import { useState } from "react";
import { initials, type Attendee } from "@/lib/meetings/attendee-types";
import { useCurrentUser, preferOwnerAvatar } from "@/components/common/CurrentUserContext";

const SIZE_CLASSES: Record<number, string> = {
  22: "h-[22px] w-[22px] text-[9px]",
  28: "h-7 w-7 text-xs",
};

function Avatar({ attendee, sizeClass }: { attendee: Attendee; sizeClass: string }) {
  // Real photos only: if the Gravatar 404s (no real photo for this address)
  // or otherwise fails to load, fall back to an initials chip — never a
  // fake/generated avatar.
  const [errored, setErrored] = useState(false);
  const currentUser = useCurrentUser();
  const label = attendee.name || attendee.email;
  const photoUrl = preferOwnerAvatar(currentUser, attendee.email, attendee.photoUrl);

  if (photoUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Gravatar URL, not an optimizable local asset
      <img
        src={photoUrl}
        alt={label}
        title={label}
        // Google (lh3.googleusercontent.com) avatars often 403 in-browser when a
        // referer is sent; no-referrer makes them load reliably.
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        className={`shrink-0 rounded-full border-2 border-surface object-cover ${sizeClass}`}
      />
    );
  }

  return (
    <span
      title={label}
      className={`flex shrink-0 items-center justify-center rounded-full border-2 border-surface bg-surface-2 font-semibold text-ink-3 ${sizeClass}`}
    >
      {initials(label)}
    </span>
  );
}

export function AttendeeAvatars({
  attendees,
  max = 4,
  size = 28,
}: {
  attendees: Attendee[] | null | undefined;
  max?: number;
  size?: 22 | 28;
}) {
  if (!attendees || attendees.length === 0) return null;

  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES[28];
  const shown = attendees.slice(0, max);
  const overflow = attendees.length - shown.length;

  return (
    <div className="flex -space-x-2">
      {shown.map((a) => (
        <Avatar key={a.email} attendee={a} sizeClass={sizeClass} />
      ))}
      {overflow > 0 ? (
        <span
          className={`flex shrink-0 items-center justify-center rounded-full border-2 border-surface bg-surface-2 font-semibold text-ink-3 ${sizeClass}`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
