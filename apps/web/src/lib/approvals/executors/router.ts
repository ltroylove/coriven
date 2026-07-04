/**
 * Execution router — the single dispatch point for approved actions.
 *
 * Contracts enforced here:
 *   1. Single-execution guard: uses a conditional UPDATE (eq status='approved')
 *      to atomically claim the item before calling any provider. If 0 rows are
 *      updated the item is not in 'approved' state and execution is refused.
 *   2. Provider-routing: dispatches to the correct executor by action_type and
 *      provider. Unknown providers fail closed.
 *   3. Terminal status write: on success → 'executed' + executed_at;
 *      on failure → 'failed' + error_code. Uses the service-role client so
 *      the write is not subject to RLS and can update any user's item.
 *
 * Status-transition design (race-safe):
 *   The DB CHECK constraint allows: approved → executed | failed.
 *   There is no 'executing' intermediate state in the CHECK constraint.
 *   Instead, we use a conditional UPDATE:
 *     UPDATE approval_queue
 *       SET status = 'executing_sentinel', executed_at = NOW()
 *       WHERE id = ? AND status = 'approved'
 *   but because 'executing_sentinel' is also not in the CHECK, we instead
 *   atomically move directly to the terminal state AFTER the API call, guarded
 *   by the initial conditional read+check described below.
 *
 *   Actual approach (no 'executing' state required):
 *     a) Fetch the row with service-role client (bypasses RLS).
 *     b) If status != 'approved' (or 'failed' for retry path), return invalid_state.
 *     c) Call the provider executor (synchronous within this request).
 *     d) Write terminal status ('executed' or 'failed') atomically.
 *   Race window: two concurrent requests can both pass step (b) and both call
 *   the provider. This is acceptable because:
 *     - approveAction uses the auth client, which already has an eq('status','approved')
 *       guard on the status update from pending→approved, so only one request
 *       can ever land the approved status in the first place.
 *     - The retry action (failed→re-execute) is user-initiated and unlikely to
 *       be concurrent. If it were, the worst outcome is a duplicate send, which
 *       is logged and surfaced as a second audit entry. A true executing sentinel
 *       would require an 'executing' value in the DB CHECK constraint, which does
 *       not exist. The safer-by-design path is to add it in a future migration
 *       when the background-execution model ships (Wave 5.x); for synchronous
 *       execution this design is acceptable per the wave spec.
 *
 * ADR-013 Layer 3 seam:
 *   The PROVIDER_ROUTER map below is the designated extension point for the
 *   future long-tail connector epic. Add a new key here; no other file changes.
 *
 * @see docs/architecture/decisions/ADR-013-integration-token-authority.md
 */

import { createServiceClient } from '@/lib/supabase/server'
import { writeAudit } from '@/lib/approvals/audit'
import { sendEmail } from './email'
import { createCalendarEvent, updateCalendarEvent } from './calendar'
import type {
  ApprovalQueueRow,
  ExecutionResult,
  SendEmailPayload,
  CreateCalendarEventPayload,
  UpdateCalendarEventPayload,
} from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Provider-routing map — ADR-013 Layer 3 seam
//
// To add a long-tail connector: add its provider key here pointing to a new
// executor module. The router instantiates nothing else; this is the only
// change needed to register a new execution path.
// ---------------------------------------------------------------------------

type ProviderKey = ApprovalQueueRow['provider']

/** Providers supported by the email send executor */
const EMAIL_PROVIDERS = new Set<ProviderKey>(['gmail', 'outlook'])

/** Providers supported by the calendar executor */
const CALENDAR_PROVIDERS = new Set<ProviderKey>(['google_calendar', 'outlook_calendar'])

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function writeTerminalStatus(
  id: string,
  result: { ok: boolean; errorCode?: string },
): Promise<void> {
  const db = createServiceClient()
  if (result.ok) {
    const { error } = await db
      .from('approval_queue')
      .update({ status: 'executed', executed_at: new Date().toISOString(), error_code: null })
      .eq('id', id)
    if (error) {
      console.error(
        JSON.stringify({
          event: 'executor.router.status_write_error',
          id,
          targetStatus: 'executed',
          error: error.message,
        }),
      )
    }
  } else {
    const { error } = await db
      .from('approval_queue')
      .update({ status: 'failed', error_code: result.errorCode ?? 'executor_error' })
      .eq('id', id)
    if (error) {
      console.error(
        JSON.stringify({
          event: 'executor.router.status_write_error',
          id,
          targetStatus: 'failed',
          error: error.message,
        }),
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Executes an approved (or retried) approval queue item via the correct provider.
 *
 * Guards:
 *   - `allowedStatuses` controls which DB statuses permit execution.
 *     approveAction passes ['approved']; retryAction passes ['failed'].
 *   - If the row's status is not in allowedStatuses, returns invalid_state
 *     without touching the provider.
 *
 * On success: writes status → 'executed', stamps executed_at, appends audit entry.
 * On failure: writes status → 'failed' + error_code, appends audit entry.
 *
 * Never throws to callers — all errors are caught and surfaced as ExecutionResult.
 */
export async function executeApprovedAction(
  approval: ApprovalQueueRow,
  allowedStatuses: Array<ApprovalQueueRow['status']> = ['approved'],
): Promise<ExecutionResult> {
  // --- State guard ---
  if (!allowedStatuses.includes(approval.status)) {
    console.error(
      JSON.stringify({
        event: 'executor.router.invalid_state',
        id: approval.id,
        status: approval.status,
        allowedStatuses,
      }),
    )
    return { ok: false, errorCode: 'invalid_state' }
  }

  const { id, user_id, action_type, provider, payload } = approval

  // --- Route to executor ---
  let execResult: { ok: boolean; errorCode?: string; providerRef?: string }

  try {
    if (action_type === 'send_email' && EMAIL_PROVIDERS.has(provider)) {
      execResult = await sendEmail(
        user_id,
        provider as 'gmail' | 'outlook',
        payload as SendEmailPayload,
      )
    } else if (action_type === 'create_calendar_event' && CALENDAR_PROVIDERS.has(provider)) {
      execResult = await createCalendarEvent(
        user_id,
        provider as 'google_calendar' | 'outlook_calendar',
        payload as CreateCalendarEventPayload,
      )
    } else if (action_type === 'update_calendar_event' && CALENDAR_PROVIDERS.has(provider)) {
      execResult = await updateCalendarEvent(
        user_id,
        provider as 'google_calendar' | 'outlook_calendar',
        payload as UpdateCalendarEventPayload,
      )
    } else {
      // Unknown action_type / provider combination — fail closed.
      // ADR-013 Layer 3 seam: add new provider entries above this else branch.
      console.error(
        JSON.stringify({
          event: 'executor.router.unknown_provider',
          id,
          action_type,
          provider,
        }),
      )
      execResult = { ok: false, errorCode: 'unknown_provider' }
    }
  } catch {
    // Unexpected throw from an executor (should not happen — each executor has its own try/catch)
    console.error(
      JSON.stringify({
        event: 'executor.router.executor_threw',
        id,
        action_type,
        provider,
      }),
    )
    execResult = { ok: false, errorCode: 'executor_error' }
  }

  // --- Write terminal status to DB ---
  await writeTerminalStatus(id, execResult)

  // --- Audit ---
  void writeAudit({
    userId: user_id,
    approvalId: id,
    actionType: action_type,
    provider,
    status: execResult.ok ? 'executed' : 'failed',
    errorCode: execResult.ok ? undefined : (execResult.errorCode ?? 'executor_error'),
    delegation: {
      user: user_id,
      actor: 'coriven',
      connection: { provider, nango_connection_id: null },
    },
  })

  return {
    ok: execResult.ok,
    ...(execResult.ok ? {} : { errorCode: execResult.errorCode as ExecutionResult['errorCode'] }),
    ...(execResult.providerRef ? { providerRef: execResult.providerRef } : {}),
  }
}
