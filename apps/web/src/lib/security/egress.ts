/**
 * Egress allowlist utility — Wave 5.3.3 Zero-Trust Enforcement
 *
 * Neutralizes untrusted URLs and auto-fetchable resources in text that is
 * about to be shown to the user or sent externally.  Both 2025 incidents
 * (ShadowLeak, EchoLeak / CVE-2025-32711) exfiltrated data via URLs and
 * auto-fetched resources embedded in model output, not via approved actions.
 * This is the egress-control requirement in ADR-013 §Security.
 *
 * Design choices:
 *   - Neutralization strategy: "[link removed: <hostname>]" rather than
 *     defanging (hxxps://evil[.]com/x).  Defanged URLs are trivially
 *     re-assembled by a copy-paste; the bracketed form is unambiguous to a
 *     human reader and has no protocol prefix that a renderer might treat as
 *     clickable.  It preserves enough information (the hostname) for
 *     legitimate debugging without transmitting the full path.
 *   - Markdown images `![alt](url)` are stripped entirely (replaced with
 *     "[image removed]") because they trigger automatic HTTP fetches in many
 *     markdown renderers — they are a well-documented exfiltration vector
 *     (ShadowLeak, EchoLeak) even if the URL would have passed the allowlist.
 *   - Protocol-less www. links (www.example.com) are matched and neutralized
 *     because browsers treat them as implicit http/https.
 *   - The app's own origin (NEXT_PUBLIC_APP_URL) is always in the allowlist so
 *     internal navigation links survive.
 *   - Default allowlist is empty: everything is neutralized unless
 *     explicitly permitted.  Callers may pass additional allowed hostnames
 *     (lower-cased, no trailing slash).
 *
 * Placement rationale (why applied in handleGetEmailThread):
 *   The raw email body passes through the model as summarization *data* — the
 *   model needs the full text to summarize it, so we cannot strip it at ingress.
 *   The model's *response* (what the user sees) is where egress control applies.
 *   handleGetEmailThread returns text to the model context as a tool result;
 *   the model then constructs a natural-language reply to the user.  By applying
 *   neutralization to the tool-result content we ensure that even if the model
 *   echoes a hostile URL verbatim from the email body, the echoed version reaches
 *   the model's reply pipeline already neutralized.  The /email detail page
 *   renders plain-text snippets stored in email_metadata (subject, from, snippet)
 *   — not full bodies — so it does not need additional egress filtering.
 *
 * @module security/egress
 */

// Matches markdown image syntax: ![any alt text](any url)
// Must be applied BEFORE URL neutralization so the URL inside isn't double-processed.
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g

// Matches http/https URLs (with or without www) and bare www. links.
// Capture group 1: full match (used for extraction).
// Stops at whitespace, ), ], ", ', > — common URL terminators in markdown/HTML.
const URL_RE =
  /https?:\/\/[^\s)"'\]>]+|www\.[^\s)"'\]>]+/gi

/** Extract the hostname from a matched URL string. */
function extractHostname(raw: string): string {
  try {
    // For bare www. links, add a scheme so URL can parse it.
    const href = raw.startsWith('http') ? raw : `https://${raw}`
    return new URL(href).hostname.toLowerCase()
  } catch {
    // Malformed URL — treat the whole string as the hostname for display purposes.
    return raw.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase()
  }
}

/** Return the set of always-allowed hostnames. */
function buildAllowSet(extra: string[]): Set<string> {
  const set = new Set<string>(extra.map(h => h.toLowerCase()))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      set.add(new URL(appUrl).hostname.toLowerCase())
    } catch {
      // Ignore malformed NEXT_PUBLIC_APP_URL
    }
  }

  return set
}

/**
 * Neutralize untrusted URLs and markdown images in `text`.
 *
 * @param text         - The text to sanitize (model output or tool-result content).
 * @param allowedHosts - Optional additional hostnames that should pass through
 *                       (lower-cased, no trailing slash, no scheme).
 * @returns            The sanitized text.
 */
export function neutralizeUntrustedOutput(text: string, allowedHosts: string[] = []): string {
  if (!text) return text

  const allowSet = buildAllowSet(allowedHosts)

  // Step 1: strip markdown images entirely (auto-fetch vector — never safe regardless of host)
  let result = text.replace(MD_IMAGE_RE, '[image removed]')

  // Step 2: neutralize non-allowlisted URLs
  result = result.replace(URL_RE, (match) => {
    const host = extractHostname(match)
    if (allowSet.has(host)) return match
    return `[link removed: ${host}]`
  })

  return result
}
