"use client";

import { useState } from "react";
import { gravatarUrl, initials } from "@/lib/meetings/attendee-types";
import { speakerColor } from "@/lib/meetings/speaker-colors";
import { useCurrentUser, preferOwnerAvatar } from "@/components/common/CurrentUserContext";

/**
 * Single source of truth for rendering a *person*: a real photo (an explicit
 * `photoUrl`, or a Gravatar derived from `email`) when one is available,
 * else a deterministic colored-initial chip. If the photo fails to load
 * (e.g. Gravatar 404s because there's no real photo for that address) it
 * falls back to the initial chip too — we only ever show a REAL photo,
 * never a broken-image icon or a fake/generated avatar.
 */
export function PersonAvatar({
  name,
  email,
  photoUrl,
  size = 28,
  className = "",
}: {
  name: string;
  email?: string | null;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const currentUser = useCurrentUser();
  const label = name || email || "?";
  // When this person is the signed-in user, prefer their live Google photo over
  // any passed/stale photoUrl or email-Gravatar.
  const resolved = preferOwnerAvatar(currentUser, email, photoUrl);
  const src = resolved ?? (email ? gravatarUrl(email) : null);

  if (src && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Gravatar/stored URL, not an optimizable local asset
      <img
        src={src}
        alt={label}
        title={label}
        // Google (lh3.googleusercontent.com) avatars often 403 in-browser when a
        // referer is sent; no-referrer makes them load reliably.
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ height: size, width: size }}
      />
    );
  }

  const c = speakerColor(label);
  return (
    <span
      title={label}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${c.bg} ${c.text} ${className}`}
      style={{ height: size, width: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
    >
      {initials(label)}
    </span>
  );
}
