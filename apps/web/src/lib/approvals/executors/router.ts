/**
 * Execution router — the single dispatch point for approved actions.
 *
 * Contracts enforced here:
 *   1. Atomic claim (M-2 race guard): before calling any provider, perform a
 *      conditional UPDATE that transitions status → 'executing' WHERE status IN
 *      (allowedStatuses). If 0 rows are updated, another request already claimed
 *      the item → return { ok: false, errorCode: 'invalid_state' } without
 *      touching any provider. This eliminates the retry-path race window.
 *   2. Re-fetch for M-3 (ownership re-verification): after claiming, re-fetch
 *      the row from the DB using the service-role client and use the DB-
 *      authoritative user_id/payload for execution. The passed-in row's id is
 *      trusted for the WHERE clause; all other fields come from the re-fetch.
 *   3. Provider-routing: dispatches to the correct executor by action_type and
 *      provider. Unknown providers fail closed.
 *   4. Terminal status write: on success → 'executed' + executed_at;
 *      on failure → 'failed' + error_code. Uses the service-role client so
 *      the write is not subject to RLS and can update any user's item.
 *
 * Status-transition design (race-safe, M-2):
 *   Before this migration (20260705060000), the DB CHECK allowed only:
 *     pending, approved, cancelled, executed, failed
 *   After migration: 'executing' is added, enabling the atomic-claim pattern:
 *     UPDATE approval_queue SET status = 'executing'
 *     WHERE id = ? AND status IN ('approved' | 'failed')
 *   Exactly 1 row affected → claim succeeded.
 *   0 rows affected → another request already claimed or status changed → bail.
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
import { loadConstraintsForUser } from '@/lib/chat/constraints/loader'
import { evaluateConstraint } from '@/lib/chat/constraints/evaluator'
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

/**
 * Atomically claim the row by transitioning its status to 'executing'.
 *
 * Uses a conditional UPDATE with WHERE status IN (allowedStatuses) so that
 * exactly one concurrent request can succeed. Returns the count of updated
 * rows: 1 = claimed, 0 = already claimed by another request or status changed.
 *
 * This is the M-2 race-condition fix. The 'executing' value was added to the
 * DB CHECK constraint in migration 20260705060000.
 */
async function claimForExecution(
  id: string,
  allowedStatuses: Array<ApprovalQueueRow['status']>,
): Promise<number> {
  const db = createServiceClient()

  // Supabase JS v2: update() with { count: 'exact' } returns the affected row count.
  // WHERE id = ? AND status IN (allowedStatuses) ensures only one concurrent
  // request can transition to 'executing'.
  const { count, error } = await db
    .from('approval_queue')
    .update({ status: 'executing' }, { count: 'exact' })
    .eq('id', id)
    .in('status', allowedStatuses)

  if (error) {
    console.error(
      JSON.stringify({
        event: 'executor.router.claim_error',
        id,
        allowedStatuses,
        error: error.message,
      }),
    )
    return 0
  }

  return count ?? 0
}

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
// Constraint gate (Wave 5.3.3)
// ---------------------------------------------------------------------------

/**
 * Evaluate the user's behavioral constraints against the proposed action.
 *
 * Semantics (fail-CLOSED — contrast with chat engine's fail-open):
 *   External actions are irreversible; conservatism is correct.
 *
 * Returns:
 *   { blocked: false, warning: null }       — no match; proceed
 *   { blocked: false, warning: string }     — unlocked match; warn but proceed
 *   { blocked: true,  reason: string }      — locked match; block execution
 *   { blocked: true,  reason: 'constraint_check_failed' } — evaluator error; block
 */
async function runConstraintGate(
  approval: ApprovalQueueRow,
): Promise<{ blocked: boolean; reason?: string; warning?: string | null }> {
  try {
    const constraints = await loadConstraintsForUser(approval.user_id)
    if (constraints.length === 0) return { blocked: false, warning: null }

    // Build a tool-call-shaped input so the evaluator can match on action_type
    // and payload fields (recipient addresses, titles, etc.).
    const toolInput: Record<string, unknown> = {
      action_type: approval.action_type,
      provider: approval.provider,
      ...(approval.payload as unknown as Record<string, unknown>),
    }

    const result = evaluateConstraint(approval.action_type, toolInput, constraints)

    if (!result.matched) return { blocked: false, warning: null }

    const { constraint, isLocked } = result

    if (isLocked) {
      return {
        blocked: true,
        reason: `Locked constraint blocked execution: "${constraint.rule}" — ${constraint.rationale}`,
      }
    }

    // Unlocked match: surface a warning, but allow execution.
    return {
      blocked: false,
      warning: `Constraint advisory: "${constraint.rule}" — ${constraint.rationale}`,
    }
  } catch (err) {
    // Evaluator or loader threw — fail closed.
    console.error(
      JSON.stringify({
        event: 'executor.router.constraint_gate_error',
        id: approval.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return { blocked: true, reason: 'constraint_check_failed' }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Executes an approved (or retried) approval queue item via the correct provider.
 *
 * Guards:
 *   - Atomic claim (M-2): conditionally update status → 'executing' WHERE id=?
 *     AND status IN (allowedStatuses). If 0 rows affected, bail with invalid_state.
 *     This eliminates the concurrent-execution race window.
 *   - Re-fetch (M-3): after claiming, re-fetch the row from DB using the
 *     service-role client. The DB-authoritative user_id and payload are used
 *     for all subsequent operations. Only the row id from the caller is trusted.
 *   - Behavioral constraint gate (Wave 5.3.3): evaluated before any executor
 *     runs; fail-closed on error or locked match.
 *
 * On success: writes status → 'executed', stamps executed_at, appends audit entry.
 * On failure: writes status → 'failed' + error_code, appends audit entry.
 *
 * Never throws to callers — all errors are caught and surfaced as ExecutionResult.
 */
export async function executeApprovedAction(
  approval: Pick<ApprovalQueueRow, 'id'> & Partial<ApprovalQueueRow>,
  allowedStatuses: Array<ApprovalQueueRow['status']> = ['approved'],
): Promise<ExecutionResult> {
  const { id } = approval

  // --- M-2: Atomic claim — transition to 'executing' WHERE status IN allowedStatuses ---
  const claimed = await claimForExecution(id, allowedStatuses)
  if (claimed === 0) {
    console.error(
      JSON.stringify({
        event: 'executor.router.invalid_state',
        id,
        allowedStatuses,
        reason: 'claim returned 0 rows — concurrent request or status mismatch',
      }),
    )
    return { ok: false, errorCode: 'invalid_state' }
  }

  // --- M-3: Re-fetch DB-authoritative row (do not trust passed-in mutable fields) ---
  const db = createServiceClient()
  const { data: row, error: fetchError } = await db
    .from('approval_queue')
    .select('id, user_id, action_type, provider, payload')
    .eq('id', id)
    .single()

  if (fetchError || !row) {
    console.error(
      JSON.stringify({
        event: 'executor.router.refetch_failed',
        id,
        error: fetchError?.message ?? 'row not found after claim',
      }),
    )
    // Write failed status — we claimed but can't proceed
    await writeTerminalStatus(id, { ok: false, errorCode: 'executor_error' })
    return { ok: false, errorCode: 'executor_error' }
  }

  const { user_id, action_type, provider, payload } = row as unknown as ApprovalQueueRow

  // --- Behavioral constraint gate (Wave 5.3.3, fail-CLOSED) ---
  // Run gate against DB-authoritative row data
  const approvalForGate: ApprovalQueueRow = {
    id,
    user_id,
    action_type,
    provider,
    payload,
    ai_summary: null,
    status: 'executing',
    created_at: new Date().toISOString(),
    reviewed_at: null,
    executed_at: null,
    error_code: null,
  }
  const gate = await runConstraintGate(approvalForGate)
  if (gate.blocked) {
    const errorCode =
      gate.reason === 'constraint_check_failed'
        ? 'constraint_check_failed'
        : 'constraint_blocked'

    console.error(
      JSON.stringify({
        event: 'executor.router.constraint_blocked',
        id,
        errorCode,
        reason: gate.reason,
      }),
    )

    await writeTerminalStatus(id, { ok: false, errorCode })

    await writeAudit({
      userId: user_id,
      approvalId: id,
      actionType: action_type,
      provider,
      status: 'failed',
      errorCode,
      delegation: {
        user: user_id,
        actor: 'coriven',
        connection: { provider, nango_connection_id: null },
      },
    })

    return { ok: false, errorCode: errorCode as ExecutionResult['errorCode'] }
  }

  if (gate.warning) {
    console.log(
      JSON.stringify({
        event: 'executor.router.constraint_advisory',
        id,
        warning: gate.warning,
      }),
    )
  }

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
  await writeAudit({
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
