/**
 * Audit writer service — the ONLY code path that writes to audit_log.
 *
 * Uses the service-role client to bypass RLS.
 * Authenticated users have no INSERT/UPDATE/DELETE policy on audit_log;
 * this module is the exclusive writer (ADR-013 §Audit Trail).
 *
 * Never throws to callers — logs internally and returns a success/failure signal.
 */

import { createServiceClient } from '@/lib/supabase/server'
import type { ApprovalActionType, ApprovalProvider, AuditDelegation } from '@personal-assistant/types'

export interface WriteAuditParams {
  userId: string
  approvalId: string | null
  actionType: ApprovalActionType | string
  provider: ApprovalProvider | string
  /** Resulting status at the time of this entry, e.g. 'proposed', 'approved', 'cancelled' */
  status: string
  errorCode?: string | null
  delegation: AuditDelegation
}

export interface WriteAuditResult {
  success: boolean
  auditId?: string
}

/**
 * Append a single entry to audit_log via the service-role client.
 * Never throws — catches all errors, logs them, and returns { success: false }.
 */
export async function writeAudit(params: WriteAuditParams): Promise<WriteAuditResult> {
  const { userId, approvalId, actionType, provider, status, errorCode, delegation } = params

  // Audit entries must never contain tokens, secrets, or raw response bodies.
  // The delegation shape is: { user, actor: 'coriven', connection: { provider, nango_connection_id | null } }
  const delegationRecord = {
    user: delegation.user,
    actor: delegation.actor,
    connection: {
      provider: delegation.connection.provider,
      nango_connection_id: delegation.connection.nango_connection_id,
    },
  }

  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('audit_log')
      .insert({
        user_id: userId,
        approval_id: approvalId,
        action_type: actionType,
        provider,
        status,
        error_code: errorCode ?? null,
        delegation: delegationRecord,
      })
      .select('id')
      .single()

    if (error) {
      console.error(
        JSON.stringify({
          event: 'audit_write_error',
          userId,
          approvalId,
          actionType,
          status,
          error: error.message,
        }),
      )
      return { success: false }
    }

    console.log(
      JSON.stringify({
        event: 'audit_written',
        auditId: data.id,
        userId,
        approvalId,
        actionType,
        provider,
        status,
      }),
    )

    return { success: true, auditId: data.id }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'audit_write_unexpected_error',
        userId,
        approvalId,
        actionType,
        status,
        error: String(err),
      }),
    )
    return { success: false }
  }
}
