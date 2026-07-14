"use client";

import { createContext, useContext } from "react";

/**
 * The signed-in user's identity, provided once at the app shell so any avatar
 * renderer (PersonAvatar / AttendeeAvatars) can show the owner's REAL Google
 * profile photo wherever they appear as a person — instead of the stale
 * email-based Gravatar stamped into stored attendee rows. `avatarUrl` is the
 * Google `picture` from the session (null if none).
 */
export type CurrentUser = { email: string; name: string | null; avatarUrl: string | null };

const CurrentUserContext = createContext<CurrentUser>({ email: "", name: null, avatarUrl: null });

export function CurrentUserProvider({
  value,
  children,
}: {
  value: CurrentUser;
  children: React.ReactNode;
}) {
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUser {
  return useContext(CurrentUserContext);
}

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Given a person's email/name + whatever photoUrl a caller has, return the photo
 * to actually render: the current user's live Google avatar when this person IS
 * the current user, else the caller's photoUrl unchanged. Matches by email
 * primarily; falls back to a display-name match ONLY when the person has no
 * email (e.g. a person entity extracted from a transcript) so we never override
 * a different attendee who merely shares a name. Case-insensitive.
 */
export function preferOwnerAvatar(
  current: CurrentUser,
  email: string | null | undefined,
  photoUrl: string | null | undefined,
  name?: string | null
): string | null | undefined {
  if (!current.avatarUrl) return photoUrl;
  const em = (email ?? "").trim().toLowerCase();
  if (em) {
    return em === current.email.toLowerCase() ? current.avatarUrl : photoUrl;
  }
  if (name && current.name && norm(name) === norm(current.name)) {
    return current.avatarUrl;
  }
  return photoUrl;
}
