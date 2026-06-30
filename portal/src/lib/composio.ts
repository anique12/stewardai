import { Composio } from "@composio/core";

// Server-only. Never import in client components — this reads COMPOSIO_API_KEY.
//
// We deliberately target the v3 SDK (@composio/core), matching the Python
// backend (composio==0.17.x) so connections created here are visible to the
// backend (and vice versa). The entity/user id MUST be the Supabase auth
// user.id (UUID) everywhere.

/** The toolkit slugs the portal supports connecting. */
export const SUPPORTED_TOOLKITS = [
  "gmail",
  "googlecalendar",
  "notion",
  "slack",
] as const;
export type SupportedToolkit = (typeof SUPPORTED_TOOLKITS)[number];

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
