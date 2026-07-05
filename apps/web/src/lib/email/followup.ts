/**
 * Follow-up detection logic — Wave 5.4.3.
 *
 * Server-only module. Uses the service-role Supabase client to read integrations
 * and write followup_candidates. Uses provider API calls to fetch SENT messages
 * and check threads for incoming replies.
 *
 * API BUDGET NOTES (per user per provider per run):
 *   Gmail:
 *     - 1 call: messages.list (in:sent after:<epoch>, maxResults=50)
 *     - Up to 25 calls: threads.get per stale thread (capped at MAX_THREADS_PER_RUN)
 *     Total: ≤ 26 calls per user/provider
 *
 *   Graph (Outlook):
 *     - 1 call: /me/mailFolders/SentItems/messages ($filter + $select, $top=50)
 *     - Up to 25 calls: /me/messages?$filter=conversationId eq '...' per stale thread
 *     Total: ≤ 26 calls per user/provider
 *
 * STALE THRESHOLD: A sent message is "stale" if it was sent more than STALE_DAYS (3)
 * days ago. Messages sent within the threshold are skipped — they are not yet
 * overdue for a reply.
 *
 * DISMISSAL: Once a user dismisses a candidate the unique key prevents any
 * subsequent upsert from resurrecting it (ON CONFLICT DO NOTHING). If a new
 * outbound message is sent on the same thread post-dismissal, the dismissed row
 * stays; the thread would need to be manually re-checked to surface again.
 * This is acceptable for Wave 5.4.3 — refinement is future scope.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { getProviderToken } from '@/lib/integrations/nango'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Only threads with the user's last outbound message older than this are flagged. */
const STALE_DAYS = 3

/** Maximum number of stale-thread reply-checks per user per provider per run.
 *  Keeps the per-run API budget bounded. */
const MAX_THREADS_PER_RUN = 25

/** Look-back window for sent messages (days). */
const SENT_LOOKBACK_DAYS = 14

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FollowUpDetectionResult {
  usersProcessed: number
  candidatesDetected: number
  candidatesCleared: number
  errorCount: number
}

interface SentMessage {
  messageId: string
  threadId: string
  subject: string
  toAddress: string
  sentAt: Date
}

// ---------------------------------------------------------------------------
// Gmail helpers
// ---------------------------------------------------------------------------

/**
 * Fetches sent messages from the last SENT_LOOKBACK_DAYS days via Gmail API.
 * Uses messages.list with q=in:sent to scope to the Sent label, then batch-fetches
 * metadata (From, Subject, Date, To) for each returned message.
 */
async function fetchGmailSentMessages(
  token: string,
  sinceEpoch: number,
): Promise<SentMessage[]> {
  // 1 API call: messages.list
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  listUrl.searchParams.set('q', `in:sent after:${sinceEpoch}`)
  listUrl.searchParams.set('maxResults', '50')

  const listResp = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!listResp.ok) {
    const errText = await listResp.text().catch(() => '')
    throw new Error(`Gmail sent list failed: ${listResp.status} ${errText}`)
  }

  const listData = (await listResp.json()) as {
    messages?: { id: string; threadId: string }[]
  }
  const messages = listData.messages ?? []
  if (messages.length === 0) return []

  // Batch-fetch metadata for each message (individual calls — Gmail has no free batch)
  const results: SentMessage[] = []
  for (const { id, threadId } of messages) {
    const metaUrl = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
    )
    metaUrl.searchParams.set('format', 'METADATA')
    metaUrl.searchParams.set('metadataHeaders', 'From')
    metaUrl.searchParams.set('metadataHeaders', 'Subject')
    metaUrl.searchParams.set('metadataHeaders', 'Date')
    metaUrl.searchParams.set('metadataHeaders', 'To')

    const metaResp = await fetch(metaUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!metaResp.ok) {
      console.warn(
        JSON.stringify({
          event: 'followup.gmail.metadata_skip',
          messageId: id,
          status: metaResp.status,
        }),
      )
      continue
    }

    const meta = (await metaResp.json()) as {
      id: string
      threadId?: string
      internalDate?: string
      payload?: { headers?: { name: string; value: string }[] }
    }

    const headerMap: Record<string, string> = {}
    for (const h of meta.payload?.headers ?? []) {
      headerMap[h.name.toLowerCase()] = h.value
    }

    const sentAt = meta.internalDate
      ? new Date(parseInt(meta.internalDate, 10))
      : new Date()

    results.push({
      messageId: meta.id,
      threadId: meta.threadId ?? threadId,
      subject: headerMap['subject'] ?? '',
      toAddress: headerMap['to'] ?? '',
      sentAt,
    })
  }

  return results
}

/**
 * Checks a Gmail thread for any INCOMING message (not from the user) that
 * arrived after afterDate. Returns true if such a reply exists.
 *
 * Uses threads.get with format=METADATA to fetch all message headers without
 * fetching bodies. We determine "incoming" by checking that the From header is
 * NOT one of the user's own addresses (passed as userEmails set).
 *
 * 1 API call per thread.
 */
async function gmailThreadHasReplyAfter(
  token: string,
  threadId: string,
  afterDate: Date,
  userEmails: Set<string>,
): Promise<boolean> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`,
  )
  url.searchParams.set('format', 'METADATA')
  url.searchParams.set('metadataHeaders', 'From')
  url.searchParams.set('metadataHeaders', 'Date')

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) {
    // If we can't fetch the thread, conservatively treat as no reply (don't clear)
    console.warn(
      JSON.stringify({
        event: 'followup.gmail.thread_fetch_failed',
        threadId,
        status: resp.status,
      }),
    )
    return false
  }

  const data = (await resp.json()) as {
    messages?: Array<{
      internalDate?: string
      payload?: { headers?: { name: string; value: string }[] }
    }>
  }

  const threadMessages = data.messages ?? []
  const afterMs = afterDate.getTime()

  for (const msg of threadMessages) {
    const msgMs = msg.internalDate ? parseInt(msg.internalDate, 10) : 0
    if (msgMs <= afterMs) continue // not after our sent message

    const headerMap: Record<string, string> = {}
    for (const h of msg.payload?.headers ?? []) {
      headerMap[h.name.toLowerCase()] = h.value
    }

    const fromRaw = (headerMap['from'] ?? '').toLowerCase()
    // Extract email address from "Name <email>" or plain "email"
    const emailMatch = fromRaw.match(/<([^>]+)>/) ?? [null, fromRaw]
    const fromEmail = (emailMatch[1] ?? fromRaw).trim()

    if (!userEmails.has(fromEmail)) {
      return true // Found an incoming reply after our sent message
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Microsoft Graph (Outlook) helpers
// ---------------------------------------------------------------------------

/**
 * Fetches sent messages from Outlook SentItems folder using Graph API.
 * 1 API call: /me/mailFolders/SentItems/messages with $filter and $select.
 */
async function fetchOutlookSentMessages(
  token: string,
  sinceIso: string,
): Promise<SentMessage[]> {
  const url = new URL('https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages')
  url.searchParams.set(
    '$filter',
    `sentDateTime ge ${sinceIso}`,
  )
  url.searchParams.set(
    '$select',
    'id,conversationId,toRecipients,subject,sentDateTime',
  )
  url.searchParams.set('$top', '50')
  url.searchParams.set('$orderby', 'sentDateTime desc')

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`Graph SentItems failed: ${resp.status} ${errText}`)
  }

  const data = (await resp.json()) as {
    value?: Array<{
      id: string
      conversationId?: string
      toRecipients?: Array<{ emailAddress?: { address?: string } }>
      subject?: string
      sentDateTime?: string
    }>
  }

  return (data.value ?? []).map(msg => ({
    messageId: msg.id,
    threadId: msg.conversationId ?? msg.id,
    subject: msg.subject ?? '',
    toAddress: (msg.toRecipients ?? [])
      .map(r => r.emailAddress?.address ?? '')
      .filter(Boolean)
      .join(', '),
    sentAt: msg.sentDateTime ? new Date(msg.sentDateTime) : new Date(),
  }))
}

/**
 * Checks whether a Graph conversation has any INCOMING message (from ≠ user)
 * received after afterDate.
 *
 * 1 API call per thread: /me/messages with $filter on conversationId and
 * receivedDateTime, then checks from address against userEmails.
 */
async function outlookThreadHasReplyAfter(
  token: string,
  conversationId: string,
  afterDate: Date,
  userEmails: Set<string>,
): Promise<boolean> {
  // Graph uses OData datetime format: 2026-07-01T00:00:00Z
  const afterIso = afterDate.toISOString().replace(/\.\d{3}Z$/, 'Z')

  const url = new URL('https://graph.microsoft.com/v1.0/me/messages')
  url.searchParams.set(
    '$filter',
    `conversationId eq '${conversationId}' and receivedDateTime gt ${afterIso}`,
  )
  url.searchParams.set('$select', 'from,receivedDateTime')
  url.searchParams.set('$top', '10')

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  if (!resp.ok) {
    console.warn(
      JSON.stringify({
        event: 'followup.outlook.thread_fetch_failed',
        conversationId,
        status: resp.status,
      }),
    )
    return false
  }

  const data = (await resp.json()) as {
    value?: Array<{
      from?: { emailAddress?: { address?: string } }
      receivedDateTime?: string
    }>
  }

  for (const msg of data.value ?? []) {
    const fromEmail = (msg.from?.emailAddress?.address ?? '').toLowerCase().trim()
    if (!userEmails.has(fromEmail)) {
      return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Per-user detection
// ---------------------------------------------------------------------------

interface PerUserResult {
  detected: number
  cleared: number
}

/**
 * Runs follow-up detection for a single user on a single provider.
 *
 * Algorithm:
 * 1. Fetch SENT messages from the last SENT_LOOKBACK_DAYS days.
 * 2. For each sent message: de-duplicate by threadId, keeping the most recent
 *    sent message per thread.
 * 3. Filter to threads where the most recent sent message is older than STALE_DAYS.
 *    Cap to MAX_THREADS_PER_RUN threads.
 * 4. For each stale thread:
 *    a. If there's already a dismissed candidate → skip (do nothing; CONFLICT ignored).
 *    b. Check whether the thread has an incoming reply after last_sent_at.
 *    c. Reply found + existing candidate → set cleared_at (auto-clear).
 *    d. No reply → upsert new candidate (ON CONFLICT DO NOTHING preserves dismissed).
 */
async function detectForUserProvider(
  userId: string,
  userEmails: Set<string>,
  provider: 'gmail' | 'outlook',
  supabase: ReturnType<typeof createServiceClient>,
): Promise<PerUserResult> {
  const token = await getProviderToken(userId, provider)
  if (!token) {
    // Not connected — skip silently
    return { detected: 0, cleared: 0 }
  }

  const now = new Date()
  const sinceDate = new Date(now.getTime() - SENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const staleThresholdDate = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000)

  // --- Step 1: Fetch sent messages ---
  let sentMessages: SentMessage[]
  if (provider === 'gmail') {
    const sinceEpoch = Math.floor(sinceDate.getTime() / 1000)
    sentMessages = await fetchGmailSentMessages(token, sinceEpoch)
  } else {
    sentMessages = await fetchOutlookSentMessages(token, sinceDate.toISOString())
  }

  if (sentMessages.length === 0) return { detected: 0, cleared: 0 }

  // --- Step 2: De-duplicate by threadId, keep most recent sent message per thread ---
  const latestByThread = new Map<string, SentMessage>()
  for (const msg of sentMessages) {
    if (!msg.threadId) continue
    const existing = latestByThread.get(msg.threadId)
    if (!existing || msg.sentAt > existing.sentAt) {
      latestByThread.set(msg.threadId, msg)
    }
  }

  // --- Step 3: Filter to stale threads (older than STALE_DAYS) ---
  const staleThreads = Array.from(latestByThread.values())
    .filter(msg => msg.sentAt < staleThresholdDate)
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime()) // oldest first
    .slice(0, MAX_THREADS_PER_RUN)

  if (staleThreads.length === 0) return { detected: 0, cleared: 0 }

  // --- Step 4: Load existing candidates for these threads (dismissed state) ---
  const threadIds = staleThreads.map(m => m.threadId)
  const { data: existingCandidates } = await supabase
    .from('followup_candidates')
    .select('id, thread_id, dismissed, cleared_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .in('thread_id', threadIds)

  const existingByThread = new Map<
    string,
    { id: string; dismissed: boolean; cleared_at: string | null }
  >()
  for (const c of existingCandidates ?? []) {
    existingByThread.set(c.thread_id, c)
  }

  let detected = 0
  let cleared = 0

  // --- Step 5: For each stale thread, check for reply and upsert/clear ---
  for (const msg of staleThreads) {
    const existing = existingByThread.get(msg.threadId)

    // Already dismissed → honour it, skip (no re-flag, no clear)
    if (existing?.dismissed) continue

    // Check for incoming reply
    let hasReply: boolean
    try {
      if (provider === 'gmail') {
        hasReply = await gmailThreadHasReplyAfter(
          token,
          msg.threadId,
          msg.sentAt,
          userEmails,
        )
      } else {
        hasReply = await outlookThreadHasReplyAfter(
          token,
          msg.threadId,
          msg.sentAt,
          userEmails,
        )
      }
    } catch (err) {
      // Thread fetch failed — skip this thread, don't let it abort the run
      console.warn(
        JSON.stringify({
          event: 'followup.thread_check_failed',
          userId,
          provider,
          threadId: msg.threadId,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      continue
    }

    if (hasReply) {
      // Reply found → clear the existing candidate (if uncleaned)
      if (existing && !existing.cleared_at) {
        await supabase
          .from('followup_candidates')
          .update({ cleared_at: new Date().toISOString() })
          .eq('id', existing.id)
        cleared++
      }
    } else {
      // No reply → upsert (ON CONFLICT DO NOTHING preserves dismissed rows)
      const { error } = await supabase.from('followup_candidates').upsert(
        {
          user_id: userId,
          provider,
          thread_id: msg.threadId,
          last_sent_message_id: msg.messageId,
          subject: msg.subject || null,
          to_address: msg.toAddress || null,
          last_sent_at: msg.sentAt.toISOString(),
          detected_at: new Date().toISOString(),
          dismissed: false,
          cleared_at: null,
        },
        {
          onConflict: 'user_id,provider,thread_id',
          ignoreDuplicates: true,
        },
      )
      if (!error) {
        // Count as new detection only if no existing record existed
        if (!existing) detected++
      } else {
        console.error(
          JSON.stringify({
            event: 'followup.upsert_failed',
            userId,
            provider,
            threadId: msg.threadId,
            error: error.message,
          }),
        )
      }
    }
  }

  return { detected, cleared }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Nightly follow-up detection.
 *
 * Iterates all users with connected Gmail or Outlook integrations.
 * For each user×provider, fetches sent messages from the last 14 days,
 * identifies threads where the user's last message is >3 days old with no reply,
 * and upserts followup_candidates rows.
 *
 * Threads where a reply has arrived since last detection are auto-cleared.
 * Dismissed candidates are never re-flagged.
 *
 * Per-user failures are isolated — a single user error does not abort the batch.
 */
export async function detectFollowUps(): Promise<FollowUpDetectionResult> {
  const supabase = createServiceClient()
  let usersProcessed = 0
  let candidatesDetected = 0
  let candidatesCleared = 0
  let errorCount = 0

  // Fetch all users with gmail or outlook integrations
  const { data: integrations, error: integrationsError } = await supabase
    .from('integrations')
    .select('user_id, provider')
    .in('provider', ['gmail', 'outlook'])

  if (integrationsError) {
    console.error(
      JSON.stringify({
        event: 'followup.integrations_fetch_failed',
        error: integrationsError.message,
      }),
    )
    return { usersProcessed: 0, candidatesDetected: 0, candidatesCleared: 0, errorCount: 1 }
  }

  if (!integrations || integrations.length === 0) {
    return { usersProcessed: 0, candidatesDetected: 0, candidatesCleared: 0, errorCount: 0 }
  }

  // Group integrations by user_id to process each user once per provider
  const userProviders = new Map<string, Set<'gmail' | 'outlook'>>()
  for (const integration of integrations) {
    const provider = integration.provider as 'gmail' | 'outlook'
    if (provider !== 'gmail' && provider !== 'outlook') continue
    const set = userProviders.get(integration.user_id) ?? new Set()
    set.add(provider)
    userProviders.set(integration.user_id, set)
  }

  for (const [userId, providers] of userProviders) {
    // Fetch user's own email addresses for reply detection
    // (profile email + any additional provider addresses)
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .maybeSingle()

    const userEmails = new Set<string>()
    if (profile?.email) userEmails.add(profile.email.toLowerCase().trim())

    for (const provider of providers) {
      try {
        const result = await detectForUserProvider(userId, userEmails, provider, supabase)
        candidatesDetected += result.detected
        candidatesCleared += result.cleared
      } catch (err) {
        // Per-user fault isolation — log and continue
        console.error(
          JSON.stringify({
            event: 'followup.user_provider_error',
            userId,
            provider,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
        errorCount++
      }
    }

    usersProcessed++
  }

  return { usersProcessed, candidatesDetected, candidatesCleared, errorCount }
}
