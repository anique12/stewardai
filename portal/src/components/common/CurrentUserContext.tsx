"use client";

import { createContext, useContext } from "react";

/**
 * The signed-in user's identity, provided once at the app shell so any avatar
 * renderer (PersonAvatar / AttendeeAvatars) can show the owner's REAL Google
 * profile photo wherever they appear as a person — instead of the stale
 * email-based Gravatar stamped into stored attendee rows. `avatarUrl` is the
 * Google `picture` from the session (null if none).
 */
export type CurrentUser = { email: string; avatarUrl: string | null };

const CurrentUserContext = createContext<CurrentUser>({ email: "", avatarUrl: null });

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

/**
 * Given a person's email + whatever photoUrl a caller has, return the photo to
 * actually render: the current user's live Google avatar when this person IS
 * the current user, else the caller's photoUrl unchanged. Case-insensitive.
 */
export function preferOwnerAvatar(
  current: CurrentUser,
  email: string | null | undefined,
  photoUrl: string | null | undefined
): string | null | undefined {
  if (current.avatarUrl && email && email.toLowerCase() === current.email.toLowerCase()) {
    return current.avatarUrl;
  }
  return photoUrl;
}
