/**
 * GET /api/cron/email-poll
 *
 * Vercel Cron endpoint (runs every 15 minutes — schedule added by the
 * orchestrator to vercel.json). Auth: Authorization: Bearer <CRON_SECRET>
 * compared with crypto.timingSafeEqual — 401 on any mismatch.
 *
 * For each user with a connected gmail or outlook integration:
 *   1. Determine the polling checkpoint (max received_at in email_metadata
 *      for that user+provider, defaulting to 24 hours ago).
 *   2. Fetch new message headers via the provider client.
 *   3. Triage the batch with Haiku.
 *   4. Upsert rows into email_metadata (ON CONFLICT DO NOTHING via ignoreDuplicates).
 *
 * Per-user/per-provider errors are caught and counted — one failure never
 * aborts the run for other users.
 *
 * Response: { usersProcessed, messagesIngested, errorCount } — no raw error
 * details or message content in the response body.
 */

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchNewMessageHeaders } from '@/lib/email/providers'
import { triageBatch } from '@/lib/email/triage'

const EMAIL_PROVIDERS = ['gmail', 'outlook'] as const
type EmailProvider = (typeof EMAIL_PROVIDERS)[number]

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function verifySecret(provided: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !provided) return false
  try {
    const a = Buffer.from(provided)
    const b = Buffer.from(secret)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Checkpoint resolution
// ---------------------------------------------------------------------------

/**
 * Returns the ISO timestamp to poll from for a given user+provider.
 * Uses the latest received_at in email_metadata; defaults to 24 hours ago.
 */
async function getCheckpoint(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  provider: EmailProvider,
): Promise<string> {
  const fallback = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('email_metadata')
    .select('received_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data?.received_at) return fallback
  return data.received_at
}

// ---------------------------------------------------------------------------
// Per-user/per-provider poll
// ---------------------------------------------------------------------------

async function pollUserProvider(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  provider: EmailProvider,
): Promise<{ ingested: number }> {
  const since = await getCheckpoint(db, userId, provider)

  const headers = await fetchNewMessageHeaders(userId, provider, since)
  if (headers.length === 0) return { ingested: 0 }

  const triageResults = await triageBatch(headers)

  // Build upsert rows — triage result is keyed by message_id
  const triageMap = new Map(triageResults.map(t => [t.message_id, t]))

  const rows = headers.map(h => {
    const triage = triageMap.get(h.message_id)
    return {
      user_id: userId,
      provider,
      message_id: h.message_id,
      thread_id: h.thread_id,
      from_address: h.from_address,
      subject: h.subject,
      received_at: h.received_at,
      urgency: triage?.urgency ?? 'normal',
      category: triage?.category ?? 'informational',
      ai_summary: triage?.summary ?? (h.subject || '(no subject)'),
      is_read: false,
    }
  })

  // ON CONFLICT (user_id, provider, message_id) DO NOTHING — the checkpoint
  // query can re-return the newest already-ingested message, so duplicates
  // are expected and must be skipped, not errored. Only newly inserted rows
  // come back from .select(), so `ingested` counts real insertions.
  const { data: inserted, error } = await db
    .from('email_metadata')
    .upsert(rows, { onConflict: 'user_id,provider,message_id', ignoreDuplicates: true })
    .select('id')

  if (error) {
    throw new Error(`DB upsert failed for user ${userId} provider ${provider}: ${error.message}`)
  }

  return { ingested: inserted?.length ?? 0 }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // 1. Auth — must be first, before any DB access
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '') ?? null
  if (!verifySecret(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runAt = new Date().toISOString()
  console.log(JSON.stringify({ event: 'cron.email_poll.start', runAt }))

  const db = createServiceClient()

  // 2. Find all users with at least one connected email integration
  const { data: integrations, error: integrationsError } = await db
    .from('integrations')
    .select('user_id, provider')
    .in('provider', [...EMAIL_PROVIDERS])

  if (integrationsError) {
    console.error(
      JSON.stringify({
        event: 'cron.email_poll.integrations_fetch_error',
        error: integrationsError.message,
      }),
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // Deduplicate user+provider pairs (there should be at most one row per
  // user+provider in integrations, but be defensive)
  const pairs = Array.from(
    new Map(
      (integrations ?? []).map(row => [`${row.user_id}:${row.provider}`, row]),
    ).values(),
  ) as { user_id: string; provider: string }[]

  // Group by user_id for clean per-user accounting
  const userProviders = new Map<string, EmailProvider[]>()
  for (const { user_id, provider } of pairs) {
    if (!EMAIL_PROVIDERS.includes(provider as EmailProvider)) continue
    const list = userProviders.get(user_id) ?? []
    list.push(provider as EmailProvider)
    userProviders.set(user_id, list)
  }

  let usersProcessed = 0
  let messagesIngested = 0
  let errorCount = 0

  // 3. Process each user×provider with per-user error isolation
  for (const [userId, providers] of userProviders) {
    usersProcessed++
    for (const provider of providers) {
      try {
        const { ingested } = await pollUserProvider(db, userId, provider)
        messagesIngested += ingested
        console.log(
          JSON.stringify({
            event: 'cron.email_poll.user_provider_done',
            userId,
            provider,
            ingested,
          }),
        )
      } catch (err) {
        errorCount++
        console.error(
          JSON.stringify({
            event: 'cron.email_poll.user_provider_error',
            userId,
            provider,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        // Continue to next provider/user — one failure must not abort the run
      }
    }
  }

  const response = { usersProcessed, messagesIngested, errorCount }
  console.log(JSON.stringify({ event: 'cron.email_poll.complete', ...response }))
  return NextResponse.json(response)
}
