'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { writeAudit } from '@/lib/approvals/audit'
import { validatePayload } from '@/lib/approvals/payload-validator'
import { executeApprovedAction } from '@/lib/approvals/executors/router'
import type { ApprovalActionType, ApprovalProvider, ApprovalQueueRow } from '@personal-assistant/types'
import type { Json } from '@/types/supabase'

async function getAuthenticatedUser() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  return { supabase, user }
}

/**
 * Approve a pending approval queue item and immediately execute the approved action.
 *
 * Flow:
 *   1. Validate ownership and status (must be 'pending').
 *   2. Transition status pending → approved (race-safe conditional update).
 *   3. Write 'approved' audit entry.
 *   4. Execute the action via the router (router transitions to 'executed' or 'failed').
 *   5. revalidatePath so the UI reflects the terminal state.
 *
 * The router owns the terminal status write and the execution audit entry.
 * This action owns the pending→approved transition and its audit entry.
 */
export async function approveAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase, user } = await getAuthenticatedUser()

    // Fetch the full item for ownership check and payload (needed by executor)
    const { data: item, error: fetchError } = await supabase
      .from('approval_queue')
      .select('id, user_id, status, action_type, provider, payload')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !item) {
      return { error: 'Approval item not found or access denied' }
    }

    if (item.status !== 'pending') {
      return { error: `Cannot approve: item is already in status "${item.status}"` }
    }

    const { error: updateError } = await supabase
      .from('approval_queue')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'pending') // double-guard against race conditions

    if (updateError) {
      console.error(
        JSON.stringify({
          event: 'approvals.approveAction.update_error',
          userId: user.id,
          id,
          error: updateError.message,
        }),
      )
      return { error: 'Failed to approve the action. Please try again.' }
    }

    // Audit the approval decision (fire-and-forget; never blocks the execution path)
    void writeAudit({
      userId: user.id,
      approvalId: id,
      actionType: item.action_type as ApprovalActionType,
      provider: item.provider as ApprovalProvider,
      status: 'approved',
      delegation: {
        user: user.id,
        actor: 'coriven',
        connection: { provider: item.provider, nango_connection_id: null },
      },
    })

    // Execute — router writes terminal status + audit entry
    const approvedItem: ApprovalQueueRow = {
      ...(item as unknown as ApprovalQueueRow),
      status: 'approved',
    }
    await executeApprovedAction(approvedItem, ['approved'])

    revalidatePath('/approvals')
    return {}
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'approvals.approveAction.unexpected_error',
        id,
        error: String(err),
      }),
    )
    return { error: 'An unexpected error occurred. Please try again.' }
  }
}

/**
 * Cancel a pending approval queue item.
 * Only valid from 'pending' status; sets status → 'cancelled' and stamps reviewed_at.
 * Cancelled items cannot be executed. Appends an audit entry.
 */
export async function cancelAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase, user } = await getAuthenticatedUser()

    const { data: item, error: fetchError } = await supabase
      .from('approval_queue')
      .select('id, user_id, status, action_type, provider')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !item) {
      return { error: 'Approval item not found or access denied' }
    }

    if (item.status !== 'pending') {
      return { error: `Cannot cancel: item is already in status "${item.status}"` }
    }

    const { error: updateError } = await supabase
      .from('approval_queue')
      .update({ status: 'cancelled', reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'pending')

    if (updateError) {
      console.error(
        JSON.stringify({
          event: 'approvals.cancelAction.update_error',
          userId: user.id,
          id,
          error: updateError.message,
        }),
      )
      return { error: 'Failed to cancel the action. Please try again.' }
    }

    void writeAudit({
      userId: user.id,
      approvalId: id,
      actionType: item.action_type as ApprovalActionType,
      provider: item.provider as ApprovalProvider,
      status: 'cancelled',
      delegation: {
        user: user.id,
        actor: 'coriven',
        connection: { provider: item.provider, nango_connection_id: null },
      },
    })

    revalidatePath('/approvals')
    return {}
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'approvals.cancelAction.unexpected_error',
        id,
        error: String(err),
      }),
    )
    return { error: 'An unexpected error occurred. Please try again.' }
  }
}

/**
 * Approve a pending approval after the user has modified its payload inline.
 * Re-validates the modified payload before accepting; only valid from 'pending'.
 */
export async function approveWithModifiedPayload(
  id: string,
  modifiedPayload: Record<string, unknown>,
): Promise<{ error?: string }> {
  try {
    const { supabase, user } = await getAuthenticatedUser()

    const { data: item, error: fetchError } = await supabase
      .from('approval_queue')
      .select('id, user_id, status, action_type, provider')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !item) {
      return { error: 'Approval item not found or access denied' }
    }

    if (item.status !== 'pending') {
      return { error: `Cannot modify and approve: item is already in status "${item.status}"` }
    }

    // Re-validate the modified payload — same validator as submit time
    const validation = validatePayload(item.action_type, modifiedPayload)
    if (!validation.valid) {
      return { error: `Modified payload is invalid: ${validation.errors.join('; ')}` }
    }

    const { error: updateError } = await supabase
      .from('approval_queue')
      .update({
        payload: modifiedPayload as Json,
        status: 'approved',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'pending')

    if (updateError) {
      console.error(
        JSON.stringify({
          event: 'approvals.approveWithModifiedPayload.update_error',
          userId: user.id,
          id,
          error: updateError.message,
        }),
      )
      return { error: 'Failed to approve the action. Please try again.' }
    }

    void writeAudit({
      userId: user.id,
      approvalId: id,
      actionType: item.action_type as ApprovalActionType,
      provider: item.provider as ApprovalProvider,
      status: 'approved',
      delegation: {
        user: user.id,
        actor: 'coriven',
        connection: { provider: item.provider, nango_connection_id: null },
      },
    })

    // Execute with the modified payload
    const approvedItem: ApprovalQueueRow = {
      id: item.id as string,
      user_id: item.user_id as string,
      action_type: item.action_type as ApprovalActionType,
      provider: item.provider as ApprovalProvider,
      payload: modifiedPayload as unknown as ApprovalQueueRow['payload'],
      ai_summary: null,
      status: 'approved',
      created_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      executed_at: null,
      error_code: null,
    }
    await executeApprovedAction(approvedItem, ['approved'])

    revalidatePath('/approvals')
    return {}
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'approvals.approveWithModifiedPayload.unexpected_error',
        id,
        error: String(err),
      }),
    )
    return { error: 'An unexpected error occurred. Please try again.' }
  }
}

/**
 * Retry a failed approval queue item.
 *
 * Only valid from 'failed' status. Re-executes the stored (already-approved)
 * payload through the router without requiring a new approval decision.
 *
 * Retry design and CHECK constraint:
 *   The DB CHECK constraint is a simple IN check on the five allowed values
 *   (pending, approved, cancelled, executed, failed). It does NOT restrict
 *   state transitions — the column can be updated to any of those five values
 *   regardless of its current value. This means failed → executed is valid.
 *   The retry action leverages this: it passes allowedStatuses=['failed'] to
 *   the router, which will write 'executed' or 'failed' as the terminal state.
 *
 * A second audit entry is written for the retry execution outcome.
 */
export async function retryAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase, user } = await getAuthenticatedUser()

    // Fetch full row — need payload for re-execution
    const { data: item, error: fetchError } = await supabase
      .from('approval_queue')
      .select('id, user_id, status, action_type, provider, payload, ai_summary, created_at, reviewed_at, executed_at, error_code')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !item) {
      return { error: 'Approval item not found or access denied' }
    }

    if (item.status !== 'failed') {
      return { error: `Cannot retry: item is in status "${item.status}" (only failed items can be retried)` }
    }

    // Router will guard allowedStatuses=['failed'] and write terminal status + audit
    const failedItem: ApprovalQueueRow = item as unknown as ApprovalQueueRow
    await executeApprovedAction(failedItem, ['failed'])

    revalidatePath('/approvals')
    return {}
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'approvals.retryAction.unexpected_error',
        id,
        error: String(err),
      }),
    )
    return { error: 'An unexpected error occurred. Please try again.' }
  }
}
