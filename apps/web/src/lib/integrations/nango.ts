/**
 * Nango token wrapper — the ONLY sanctioned server-side path to a provider access token.
 * All Epic 5 features (email polling, calendar sync, approved actions) must obtain tokens
 * through this module. Never bypass it with direct Nango SDK calls or raw token storage.
 *
 * Server-only: this module reads NANGO_SECRET_KEY and NANGO_HOST from env at call time.
 * It must never be imported in client components.
 */

import { Nango } from '@nangohq/node'
import { createServiceClient } from '@/lib/supabase/server'
import type { IntegrationProvider } from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Provider config key mapping
// These keys must match the provider config keys registered in the Nango UI.
// Assumption: key names follow Nango's standard slug format for each provider.
// Verify against your Nango instance (Settings → Integrations → Unique Key)
// before completing Task 1 of Wave 5.1.1. Adjust here if they differ.
// ---------------------------------------------------------------------------

const PROVIDER_CONFIG_KEYS: Record<IntegrationProvider, string> = {
  gmail: 'google-mail',
  outlook: 'outlook',
  google_calendar: 'google-calendar',
  outlook_calendar: 'outlook-calendar',
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getNangoClient(): Nango {
  const apiKey = process.env.NANGO_SECRET_KEY
  const host = process.env.NANGO_HOST

  if (!apiKey) {
    throw new Error(
      '[nango] NANGO_SECRET_KEY environment variable is not set. ' +
        'Set it in .env.local (local) and in Vercel environment variables (production).',
    )
  }
  if (!host) {
    throw new Error(
      '[nango] NANGO_HOST environment variable is not set. ' +
        'Set it to the base URL of your self-hosted Nango instance ' +
        '(e.g. https://nango.example.com).',
    )
  }

  return new Nango({ apiKey, host })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Looks up the stored nango_connection_id for a given user + provider.
 * Uses the service client (bypasses RLS) — call only from server-side code.
 *
 * Returns the connection ID string, or null if no row exists.
 */
export async function getConnection(
  userId: string,
  provider: IntegrationProvider,
): Promise<string | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('integrations')
    .select('nango_connection_id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) {
    console.error(
      JSON.stringify({
        event: 'nango.getConnection.db_error',
        userId,
        provider,
        error: error.message,
      }),
    )
    return null
  }

  return data?.nango_connection_id ?? null
}

/**
 * Resolves a user + provider to a fresh OAuth access token via Nango.
 *
 * Returns the access token string on success.
 * Returns null if:
 *   - no connection row exists for this user/provider (not connected)
 *   - Nango returns an error (transient failure, revoked token, etc.)
 *
 * Token refresh is handled transparently by Nango.
 * Token values are never written to logs.
 */
export async function getProviderToken(
  userId: string,
  provider: IntegrationProvider,
): Promise<string | null> {
  const connectionId = await getConnection(userId, provider)

  if (!connectionId) {
    console.error(
      JSON.stringify({
        event: 'nango.getProviderToken.not_connected',
        userId,
        provider,
      }),
    )
    return null
  }

  const providerConfigKey = PROVIDER_CONFIG_KEYS[provider]

  let nango: Nango
  try {
    nango = getNangoClient()
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'nango.getProviderToken.client_init_error',
        userId,
        provider,
        error: String(err),
      }),
    )
    return null
  }

  try {
    const token = await nango.getToken(providerConfigKey, connectionId)

    // getToken returns string for OAuth2 (our providers); guard for unexpected types
    if (typeof token !== 'string') {
      console.error(
        JSON.stringify({
          event: 'nango.getProviderToken.unexpected_token_type',
          userId,
          provider,
          tokenType: typeof token,
        }),
      )
      return null
    }

    return token
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'nango.getProviderToken.nango_error',
        userId,
        provider,
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }
}
