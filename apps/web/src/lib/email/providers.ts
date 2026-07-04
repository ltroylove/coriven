/**
 * Email provider header-fetch clients.
 *
 * Server-only module. Tokens are obtained exclusively through getProviderToken
 * (ADR-013 §Integration Platform Architecture).  No token values are logged.
 *
 * Gmail:   Gmail REST API v1 — messages.list + messages.get (metadata format)
 * Outlook: Microsoft Graph v1.0 — /me/messages with $filter and $select
 *
 * Both providers return normalized EmailHeader[].
 * On token null (not connected) → return [].
 * On API error → log + return [] (per-user fault isolation per spec).
 *
 * Per-run message cap: MAX_MESSAGES_PER_RUN (50).
 */

import { getProviderToken } from '@/lib/integrations/nango'
import type { EmailHeader, EmailBody } from '@personal-assistant/types'

const MAX_MESSAGES_PER_RUN = 50

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

/**
 * Gmail messages.list uses a `q` filter with `after:<unix-epoch-seconds>`.
 * We fetch the message list (IDs only), then batch-fetch metadata for each
 * message using individual messages.get calls with format=METADATA.
 * Header names fetched: From, Subject, Date.
 */
async function fetchGmailHeaders(
  token: string,
  sinceIso: string,
): Promise<EmailHeader[]> {
  const sinceEpoch = Math.floor(new Date(sinceIso).getTime() / 1000)
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  listUrl.searchParams.set('q', `after:${sinceEpoch}`)
  listUrl.searchParams.set('maxResults', String(MAX_MESSAGES_PER_RUN))

  const listResp = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!listResp.ok) {
    const errText = await listResp.text().catch(() => '')
    throw new Error(`Gmail messages.list failed: ${listResp.status} ${errText}`)
  }

  const listData = (await listResp.json()) as { messages?: { id: string; threadId: string }[] }
  const messages = listData.messages ?? []

  if (messages.length === 0) return []

  // Fetch metadata for each message individually (Gmail does not have a free-tier batch endpoint)
  const headers: EmailHeader[] = []
  for (const { id, threadId } of messages) {
    const metaUrl = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
    )
    metaUrl.searchParams.set('format', 'METADATA')
    metaUrl.searchParams.set('metadataHeaders', 'From')
    metaUrl.searchParams.set('metadataHeaders', 'Subject')
    metaUrl.searchParams.set('metadataHeaders', 'Date')

    const metaResp = await fetch(metaUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!metaResp.ok) {
      // Skip this message and continue
      console.warn(
        JSON.stringify({
          event: 'email.providers.gmail.metadata_skip',
          messageId: id,
          status: metaResp.status,
        }),
      )
      continue
    }

    const meta = (await metaResp.json()) as {
      id: string
      threadId: string
      payload?: { headers?: { name: string; value: string }[] }
      internalDate?: string
    }

    const headerMap: Record<string, string> = {}
    for (const h of meta.payload?.headers ?? []) {
      headerMap[h.name.toLowerCase()] = h.value
    }

    // internalDate is milliseconds since epoch
    const receivedAt = meta.internalDate
      ? new Date(parseInt(meta.internalDate, 10)).toISOString()
      : new Date().toISOString()

    headers.push({
      message_id: meta.id,
      thread_id: meta.threadId ?? threadId ?? null,
      from_address: headerMap['from'] ?? '',
      subject: headerMap['subject'] ?? '',
      received_at: receivedAt,
    })
  }

  return headers
}

/**
 * Gmail messages.get with format=FULL — extracts plain-text parts recursively.
 * Returns null on any failure.
 */
async function fetchGmailBody(
  token: string,
  messageId: string,
): Promise<EmailBody | null> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
  )
  url.searchParams.set('format', 'FULL')

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`Gmail messages.get failed: ${resp.status} ${errText}`)
  }

  const msg = (await resp.json()) as {
    id: string
    threadId?: string
    internalDate?: string
    payload?: GmailPart & { headers?: { name: string; value: string }[] }
  }

  const headerMap: Record<string, string> = {}
  for (const h of msg.payload?.headers ?? []) {
    headerMap[h.name.toLowerCase()] = h.value
  }

  const receivedAt = msg.internalDate
    ? new Date(parseInt(msg.internalDate, 10)).toISOString()
    : new Date().toISOString()

  const bodyText = extractGmailText(msg.payload)

  return {
    subject: headerMap['subject'] ?? '',
    from: headerMap['from'] ?? '',
    received_at: receivedAt,
    body_text: bodyText,
  }
}

type GmailPart = {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

function extractGmailText(part: GmailPart | undefined): string {
  if (!part) return ''

  // Prefer text/plain; fall back to stripping HTML from text/html
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8')
  }

  if (part.parts) {
    for (const child of part.parts) {
      const text = extractGmailText(child)
      if (text) return text
    }
  }

  // text/html fallback — strip tags naively (no external dep)
  if (part.mimeType === 'text/html' && part.body?.data) {
    const html = Buffer.from(part.body.data, 'base64url').toString('utf-8')
    return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
  }

  return ''
}

// ---------------------------------------------------------------------------
// Microsoft Graph (Outlook)
// ---------------------------------------------------------------------------

/**
 * Graph /me/messages with $filter on receivedDateTime and $select for the
 * fields we need. Returns up to $top=50 results.
 */
async function fetchOutlookHeaders(
  token: string,
  sinceIso: string,
): Promise<EmailHeader[]> {
  const url = new URL('https://graph.microsoft.com/v1.0/me/messages')
  url.searchParams.set(
    '$filter',
    `receivedDateTime ge ${sinceIso}`,
  )
  url.searchParams.set(
    '$select',
    'id,conversationId,from,subject,receivedDateTime',
  )
  url.searchParams.set('$top', String(MAX_MESSAGES_PER_RUN))
  url.searchParams.set('$orderby', 'receivedDateTime desc')

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`Graph messages failed: ${resp.status} ${errText}`)
  }

  const data = (await resp.json()) as {
    value?: Array<{
      id: string
      conversationId?: string
      from?: { emailAddress?: { address?: string; name?: string } }
      subject?: string
      receivedDateTime?: string
    }>
  }

  return (data.value ?? []).map(msg => ({
    message_id: msg.id,
    thread_id: msg.conversationId ?? null,
    from_address: formatGraphSender(msg.from),
    subject: msg.subject ?? '',
    received_at: msg.receivedDateTime ?? new Date().toISOString(),
  }))
}

function formatGraphSender(
  from?: { emailAddress?: { address?: string; name?: string } },
): string {
  const addr = from?.emailAddress
  if (!addr) return ''
  if (addr.name) return `${addr.name} <${addr.address ?? ''}>`
  return addr.address ?? ''
}

/**
 * Graph /me/messages/{id} — body content with text conversion requested via
 * Prefer: outlook.body-content-type="text" header.
 */
async function fetchOutlookBody(
  token: string,
  messageId: string,
): Promise<EmailBody | null> {
  const url = new URL(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`,
  )
  url.searchParams.set('$select', 'subject,from,receivedDateTime,body')

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Prefer: 'outlook.body-content-type="text"',
    },
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`Graph message body failed: ${resp.status} ${errText}`)
  }

  const msg = (await resp.json()) as {
    subject?: string
    from?: { emailAddress?: { address?: string; name?: string } }
    receivedDateTime?: string
    body?: { contentType?: string; content?: string }
  }

  const bodyContent = msg.body?.content ?? ''
  // If Graph returns HTML despite our Prefer header, strip tags
  const bodyText =
    msg.body?.contentType === 'html'
      ? bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
      : bodyContent

  return {
    subject: msg.subject ?? '',
    from: formatGraphSender(msg.from),
    received_at: msg.receivedDateTime ?? new Date().toISOString(),
    body_text: bodyText,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches new message headers for a user+provider since sinceIso.
 * Returns [] on any error (per-user fault isolation).
 */
export async function fetchNewMessageHeaders(
  userId: string,
  provider: 'gmail' | 'outlook',
  sinceIso: string,
): Promise<EmailHeader[]> {
  const token = await getProviderToken(userId, provider)
  if (!token) {
    // Not connected — not an error; just skip
    console.log(
      JSON.stringify({
        event: 'email.providers.fetchHeaders.not_connected',
        userId,
        provider,
      }),
    )
    return []
  }

  try {
    if (provider === 'gmail') {
      return await fetchGmailHeaders(token, sinceIso)
    } else {
      return await fetchOutlookHeaders(token, sinceIso)
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'email.providers.fetchHeaders.error',
        userId,
        provider,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return []
  }
}

/**
 * Fetches the full body of a specific message on demand.
 * Returns null on error or not-connected.
 * Body text must be wrapped in hostile-content framing before being shown to a model.
 */
export async function fetchEmailBody(
  userId: string,
  provider: 'gmail' | 'outlook',
  messageId: string,
): Promise<EmailBody | null> {
  const token = await getProviderToken(userId, provider)
  if (!token) {
    console.error(
      JSON.stringify({
        event: 'email.providers.fetchBody.not_connected',
        userId,
        provider,
      }),
    )
    return null
  }

  try {
    if (provider === 'gmail') {
      return await fetchGmailBody(token, messageId)
    } else {
      return await fetchOutlookBody(token, messageId)
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'email.providers.fetchBody.error',
        userId,
        provider,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return null
  }
}
