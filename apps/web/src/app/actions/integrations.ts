'use server'

/**
 * Server Actions for OAuth integration connect/disconnect via Nango.
 *
 * Required environment variables (server-side only — never exposed to the client):
 *   NANGO_SECRET_KEY        — Nango API key (Environment Settings → API Keys)
 *   NANGO_HOST              — base URL of the self-hosted Nango instance
 *                             e.g. https://nango.example.com
 *
 * Required environment variables (public — safe to expose to the browser):
 *   NEXT_PUBLIC_NANGO_HOST  — same value as NANGO_HOST; needed by the frontend SDK
 *                             to point the Connect UI iframe at the correct Nango instance.
 *
 * Nango is the OAuth token authority (ADR-013). No raw tokens are stored in Supabase.
 * The `integrations` table records only connection references (nango_connection_id, scopes,
 * connected_at) for UI state.
 *
 * Connection identity: the Connect Session flow binds each connection to the
 * authenticated user via `end_user.id = user.id` at session-creation time. Nango
 * mints its own connection ID (NOT the user UUID). We derive the authoritative
 * connection ID server-side by listing connections filtered to the user's
 * `end_user.id`, so a client can never register another user's connection.
 */

import { revalidatePath } from 'next/cache'
import { Nango } from '@nangohq/node'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import type { IntegrationProvider } from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Provider config key mapping
// Must match the provider config keys registered in the Nango dashboard.
// Mirrors PROVIDER_CONFIG_KEYS from apps/web/src/lib/integrations/nango.ts.
// ---------------------------------------------------------------------------
const PROVIDER_CONFIG_KEYS: Record<IntegrationProvider, string> = {
  gmail: 'google-mail',
  outlook: 'outlook',
  google_calendar: 'google-calendar',
  outlook_calendar: 'outlook-calendar',
}

// Minimum scopes per provider (ADR-013 §Scope Minimization).
// These are stored in the integrations row for UI display only;
// actual OAuth scopes are enforced at the Nango / provider level.
const PROVIDER_SCOPES: Record<IntegrationProvider, string[]> = {
  gmail: ['gmail.readonly', 'gmail.send'],
  outlook: ['mail.read', 'mail.send'],
  google_calendar: ['calendar.readonly', 'calendar.events'],
  outlook_calendar: ['calendars.read', 'calendars.readwrite'],
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getNangoClient(): Nango {
  const apiKey = process.env.NANGO_SECRET_KEY
  if (!apiKey) throw new Error('[integrations] NANGO_SECRET_KEY is not set')
  const host = process.env.NANGO_HOST
  if (!host) throw new Error('[integrations] NANGO_HOST is not set')
  return new Nango({ apiKey, host })
}

async function getAuthenticatedUser() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  return user
}

function isValidProvider(value: unknown): value is IntegrationProvider {
  return (
    value === 'gmail' ||
    value === 'outlook' ||
    value === 'google_calendar' ||
    value === 'outlook_calendar'
  )
}

// ---------------------------------------------------------------------------
// createConnectSession
// ---------------------------------------------------------------------------

/**
 * Creates a Nango connect session token for the authenticated user.
 * The short-lived token is returned to the client and passed to
 * `@nangohq/frontend`'s `openConnectUI` — keeping NANGO_SECRET_KEY server-side.
 */
export async function createConnectSession(
  provider: string,
): Promise<{ token?: string; error?: string }> {
  if (!isValidProvider(provider)) {
    return { error: 'Invalid provider' }
  }

  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>
  try {
    user = await getAuthenticatedUser()
  } catch {
    return { error: 'Unauthorized' }
  }

  try {
    const nango = getNangoClient()
    const session = await nango.createConnectSession({
      end_user: {
        id: user.id,
        email: user.email ?? undefined,
      },
      // Restrict the Connect UI to only the requested provider.
      allowed_integrations: [PROVIDER_CONFIG_KEYS[provider]],
    })
    return { token: session.data.token }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'integrations.createConnectSession.error',
        provider,
        error: String(err),
      }),
    )
    return { error: 'Failed to initiate connection. Please try again.' }
  }
}

// ---------------------------------------------------------------------------
// recordConnection
// ---------------------------------------------------------------------------

/**
 * Records a successfully completed OAuth connection in the `integrations` table.
 * Called by the client after the Nango frontend SDK reports a successful auth.
 *
 * The client-reported connection ID is treated only as a hint. The authoritative
 * connection ID is resolved server-side by asking Nango for the connections bound
 * to this user's `end_user.id` (set in createConnectSession) for this provider.
 * This prevents a client from registering a connection it doesn't own: Nango only
 * returns connections associated with the authenticated user's end_user.id.
 */
export async function recordConnection(
  provider: string,
  nangoConnectionId: string,
): Promise<{ error?: string }> {
  if (!isValidProvider(provider)) {
    return { error: 'Invalid provider' }
  }

  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>
  try {
    user = await getAuthenticatedUser()
  } catch {
    return { error: 'Unauthorized' }
  }

  // Resolve the authoritative connection ID from Nango, scoped to this user's
  // end_user.id. Never trust the client-supplied ID as the source of truth.
  let connectionId: string
  try {
    const nango = getNangoClient()
    const { connections } = await nango.listConnections({
      userId: user.id,
      integrationId: PROVIDER_CONFIG_KEYS[provider],
    })

    if (!connections || connections.length === 0) {
      console.error(
        JSON.stringify({
          event: 'integrations.recordConnection.no_connection_found',
          userId: user.id,
          provider,
        }),
      )
      return { error: 'No connection found. Please try connecting again.' }
    }

    // Prefer the connection the client reported (defense: it must be present in
    // the user-scoped list); otherwise fall back to the sole connection for this
    // user + provider.
    const match = connections.find((c) => c.connection_id === nangoConnectionId)
    connectionId = match?.connection_id ?? connections[0].connection_id
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'integrations.recordConnection.nango_lookup_error',
        provider,
        userId: user.id,
        error: String(err),
      }),
    )
    return { error: 'Failed to verify connection. Please try again.' }
  }

  try {
    const supabase = await createAuthServerClient()
    const { error } = await supabase.from('integrations').upsert(
      {
        user_id: user.id,
        provider,
        nango_connection_id: connectionId,
        scopes: PROVIDER_SCOPES[provider],
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    )

    if (error) {
      console.error(
        JSON.stringify({
          event: 'integrations.recordConnection.db_error',
          provider,
          userId: user.id,
          error: error.message,
        }),
      )
      return { error: 'Failed to save connection.' }
    }

    console.log(
      JSON.stringify({
        event: 'integrations.connected',
        provider,
        userId: user.id,
      }),
    )
    revalidatePath('/settings/integrations')
    return {}
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'integrations.recordConnection.unexpected_error',
        provider,
        userId: user.id,
        error: String(err),
      }),
    )
    return { error: 'An unexpected error occurred.' }
  }
}

// ---------------------------------------------------------------------------
// disconnectProvider
// ---------------------------------------------------------------------------

/**
 * Disconnects a provider:
 *   1. Deletes the connection in Nango (revokes token at source).
 *   2. Only if that succeeds (or Nango returns not-found), deletes the DB row.
 *   3. On Nango failure (non-404), preserves the DB row and returns an error.
 *
 * Compensation ordering per wave plan: never show disconnected when Nango
 * still holds the token.
 */
export async function disconnectProvider(
  provider: string,
): Promise<{ error?: string }> {
  if (!isValidProvider(provider)) {
    return { error: 'Invalid provider' }
  }

  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>
  try {
    user = await getAuthenticatedUser()
  } catch {
    return { error: 'Unauthorized' }
  }

  const supabase = await createAuthServerClient()

  // Look up the stored connection ID (Nango-generated, not the user UUID).
  const { data: row } = await supabase
    .from('integrations')
    .select('nango_connection_id')
    .eq('user_id', user.id)
    .eq('provider', provider)
    .maybeSingle()

  // No row: nothing to disconnect — treat as success (idempotent).
  if (!row) {
    revalidatePath('/settings/integrations')
    return {}
  }

  // Step 1: Delete from Nango first, using the stored connection ID.
  try {
    const nango = getNangoClient()
    await nango.deleteConnection(PROVIDER_CONFIG_KEYS[provider], row.nango_connection_id)
  } catch (err) {
    const errStr = String(err)
    // 404 / not-found: connection was already gone in Nango — proceed to DB cleanup.
    const isNotFound =
      errStr.includes('404') ||
      errStr.toLowerCase().includes('not found') ||
      errStr.toLowerCase().includes('connection not found')

    if (!isNotFound) {
      console.error(
        JSON.stringify({
          event: 'integrations.disconnectProvider.nango_error',
          provider,
          userId: user.id,
          error: errStr,
        }),
      )
      return {
        error:
          'Failed to revoke the connection at the provider. Please try again.',
      }
    }

    console.log(
      JSON.stringify({
        event: 'integrations.disconnectProvider.nango_not_found',
        provider,
        userId: user.id,
      }),
    )
  }

  // Step 2: Remove the DB row.
  try {
    const { error } = await supabase
      .from('integrations')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', provider)

    if (error) {
      console.error(
        JSON.stringify({
          event: 'integrations.disconnectProvider.db_error',
          provider,
          userId: user.id,
          error: error.message,
        }),
      )
      return { error: 'Failed to remove connection record.' }
    }

    console.log(
      JSON.stringify({
        event: 'integrations.disconnected',
        provider,
        userId: user.id,
      }),
    )
    revalidatePath('/settings/integrations')
    return {}
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'integrations.disconnectProvider.unexpected_error',
        provider,
        userId: user.id,
        error: String(err),
      }),
    )
    return { error: 'An unexpected error occurred.' }
  }
}
