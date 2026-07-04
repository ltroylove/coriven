/**
 * Email executor — sends an approved email draft via the connected provider.
 *
 * Gmail:   POST gmail/v1/users/me/messages/send with a base64url RFC 2822 message.
 * Outlook: POST graph.microsoft.com/v1.0/me/sendMail with a JSON message body.
 *
 * Token is fetched from Nango per-call (ADR-013). Tokens are never logged.
 * Payload bodies are never logged.
 * Plain-text bodies only.
 *
 * All provider errors map to stable ExecutionErrorCode values.
 */

import { getProviderToken } from '@/lib/integrations/nango'
import type { SendEmailPayload, ExecutionErrorCode } from '@personal-assistant/types'

const FETCH_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

/**
 * Defense-in-depth: strip all CR and LF bytes from a header field value.
 *
 * The payload-validator (validateSendEmail) is the primary guard — it rejects
 * any payload whose "to" or "subject" contains \r or \n before this code is
 * ever reached. This function is a second line of defense: even if a value
 * somehow bypassed validation it will never reach an RFC 2822 header line as
 * a raw CR/LF byte.
 *
 * Approach: strip rather than encode. A subject that contained a literal CRLF
 * is already invalid per the validator; collapsing it here is a safe fallback.
 * Non-ASCII characters in subjects are left as UTF-8 bytes (Gmail's API accepts
 * UTF-8 in the raw message body when the base64url-encoded blob is used).
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, '')
}

/**
 * Encodes an RFC 2822 email message to base64url, as required by the Gmail
 * messages.send endpoint.
 *
 * Header-injection defense: "to" and "subject" are passed through
 * sanitizeHeaderValue() before being written into header lines. The validator
 * is the primary guard; sanitization here is defense-in-depth. Body content
 * is NOT sanitized — newlines in the body are normal RFC 2822 content.
 *
 * Non-ASCII subjects are kept as raw UTF-8 bytes, which Gmail accepts in the
 * base64url-encoded raw message. Full RFC 2047 encoded-word encoding is not
 * implemented here but can be added if provider requirements change.
 */
function buildRfc2822Base64url(payload: SendEmailPayload): string {
  // Defense-in-depth: strip CRLF from header fields (validator is primary guard)
  const safeTo = sanitizeHeaderValue(payload.to)
  const safeSubject = sanitizeHeaderValue(payload.subject)

  const lines = [
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    payload.body,
  ]
  const raw = lines.join('\r\n')
  // Node Buffer: encode as base64 then make URL-safe
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

async function sendViaGmail(
  token: string,
  payload: SendEmailPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode }> {
  const raw = buildRfc2822Base64url(payload)

  let response: Response
  try {
    response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    // fetch threw — network-level failure (timeout, DNS, etc.)
    console.error(
      JSON.stringify({ event: 'executor.email.gmail.network_error' }),
    )
    return { ok: false, errorCode: 'network_error' }
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: 'executor.email.gmail.provider_rejected',
        status: response.status,
      }),
    )
    return { ok: false, errorCode: 'provider_rejected' }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Outlook (Microsoft Graph)
// ---------------------------------------------------------------------------

async function sendViaOutlook(
  token: string,
  payload: SendEmailPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode }> {
  const body = {
    message: {
      subject: payload.subject,
      body: {
        contentType: 'Text',
        content: payload.body,
      },
      toRecipients: [
        {
          emailAddress: {
            address: payload.to,
          },
        },
      ],
    },
    saveToSentItems: 'true',
  }

  let response: Response
  try {
    response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    console.error(
      JSON.stringify({ event: 'executor.email.outlook.network_error' }),
    )
    return { ok: false, errorCode: 'network_error' }
  }

  // Graph sendMail returns 202 on success
  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: 'executor.email.outlook.provider_rejected',
        status: response.status,
      }),
    )
    return { ok: false, errorCode: 'provider_rejected' }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends an email via the specified provider using an approved payload.
 * Token is fetched per-call from Nango.
 *
 * Returns { ok: true } on success.
 * Returns { ok: false, errorCode } on any failure — never throws.
 */
export async function sendEmail(
  userId: string,
  provider: 'gmail' | 'outlook',
  payload: SendEmailPayload,
): Promise<{ ok: boolean; errorCode?: ExecutionErrorCode }> {
  const token = await getProviderToken(userId, provider)
  if (!token) {
    console.error(
      JSON.stringify({
        event: 'executor.email.token_unavailable',
        userId,
        provider,
      }),
    )
    return { ok: false, errorCode: 'token_unavailable' }
  }

  try {
    if (provider === 'gmail') {
      return await sendViaGmail(token, payload)
    }
    return await sendViaOutlook(token, payload)
  } catch {
    // Unexpected error inside executor (should not happen after per-provider try/catch)
    console.error(
      JSON.stringify({
        event: 'executor.email.unexpected_error',
        userId,
        provider,
      }),
    )
    return { ok: false, errorCode: 'executor_error' }
  }
}
