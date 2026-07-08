import { Composio } from "@composio/core";

// Server-only. Never import in client components — this reads COMPOSIO_API_KEY.
//
// We deliberately target the v3 SDK (@composio/core), matching the Python
// backend (composio==0.17.x) so connections created here are visible to the
// backend (and vice versa). The entity/user id MUST be the Supabase auth
// user.id (UUID) everywhere.

/** Fallback connectable toolkits, used if the DB registry can't be read. Kept in
 *  sync with the `integrations` table seed (migration 0014). */
export const SUPPORTED_TOOLKITS = [
  "gmail",
  "googlecalendar",
  "googledrive",
  "googledocs",
  "googlesheets",
] as const;
export type SupportedToolkit = (typeof SUPPORTED_TOOLKITS)[number];

/** The connectable toolkits, from the DB integration registry (single source of
 *  truth shared with the chat backend). Falls back to SUPPORTED_TOOLKITS if the
 *  table is missing/unreadable, so connect/status keep working pre-migration. */
export async function getSupportedToolkits(): Promise<string[]> {
  try {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const { data, error } = await createServiceClient()
      .from("integrations")
      .select("slug")
      .eq("available", true);
    if (error || !data || data.length === 0) return [...SUPPORTED_TOOLKITS];
    return data.map((r) => r.slug as string);
  } catch {
    return [...SUPPORTED_TOOLKITS];
  }
}

/** Construct a Composio v3 client from the server-side API key. */
export function getComposio(): Composio {
  return new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
}

/**
 * Resolve a Composio-managed auth config id for a toolkit, creating one if it
 * does not yet exist.
 *
 * This mirrors what `toolkits.authorize()` does internally (list existing →
 * else create a `use_composio_managed_auth` config) but exposes the id so the
 * caller can use `connectedAccounts.link()`, which is the managed-OAuth-safe
 * initiation path that also accepts a post-OAuth `callbackUrl`. (The
 * `connectedAccounts.initiate()` endpoint that `authorize()` wraps is being
 * retired for managed OAuth.)
 */
export async function resolveManagedAuthConfigId(
  composio: Composio,
  toolkitSlug: string
): Promise<string> {
  const existing = await composio.authConfigs.list({ toolkit: toolkitSlug });
  const reusable = existing.items[0]?.id;
  if (reusable) {
    return reusable;
  }

  const created = await composio.authConfigs.create(toolkitSlug, {
    type: "use_composio_managed_auth",
    name: `${toolkitSlug} Auth Config`,
  });
  return created.id;
}
