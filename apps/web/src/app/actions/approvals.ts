'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { writeAudit } from '@/lib/approvals/audit'
import { validatePayload } from '@/lib/approvals/payload-validator'
import { executeApprovedAction } from '@/lib/approvals/executors/router'
import type { ApprovalActionType, ApprovalProvider } from '@personal-assistant/types'
import type { Json } from '@/types/supabase'

/**
 * Fetch a single approval_queue row by id, scoped to the authenticated user.
 *
 * Used by the inline approval card to refresh status when a conversation is
 * reloaded from history. RLS ensures a row belonging to a different user is
 * invisible; Supabase returns no row (null data) in that case, which is
 * treated identically to a missing row — the caller gets { error }.
 *
 * No caching: the card needs the current DB status every time.
 */
export async function getApproval(id: string): Promise<
  | {
      id: string
      action_type: string
      provider: string
      payload: import('@/types/supabase').Json
      ai_summary: string | null
      status: string
      created_at: string
    }
  | { error: string }
> {
  try {
    const { supabase } = await getAuthenticatedUser()

    const { data, error } = await supabase
      .from('approval_queue')
      .select('id, action_type, provider, payload, ai_summary, status, created_at')
      .eq('id', id)
      .single()

    if (error || !data) {
      return { error: 'Approval not found or access denied' }
    }

    return {
      id: data.id,
      action_type: data.action_type,
      provider: data.provider,
      payload: data.payload,
      ai_summary: data.ai_summary,
      status: data.status,
      created_at: data.created_at,
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'approvals.getApproval.unexpected_error',
        id,
        error: String(err),
      }),
    )
    return { error: 'An unexpected error occurred. Please try again.' }
  }
}

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
    await writeAudit({
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

    // Execute — router atomically claims (approved→executing) and re-fetches
    // the DB-authoritative row before calling any provider (M-2 + M-3).
    await executeApprovedAction({ id }, ['approved'])

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

    await writeAudit({
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

    await writeAudit({
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

    // Execute — router atomically claims (approved→executing) and re-fetches
    // the DB-authoritative row (which now contains the modified payload because
    // we wrote it above with the status update). M-2 + M-3.
    await executeApprovedAction({ id }, ['approved'])

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
 * Retry design:
 *   The router atomically claims the row by transitioning failed → executing
 *   (M-2 race guard). If two retry requests race, only one will claim the row
 *   (the other gets invalid_state from the router). Ownership is verified both
 *   here (eq user_id on the auth client) and in the router (M-3 re-fetch uses
 *   the service client to confirm the row still exists after claiming).
 *
 * A second audit entry is written for the retry execution outcome.
 */
export async function retryAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase, user } = await getAuthenticatedUser()

    // Auth-scoped ownership check: only the owning user can retry their own item.
    const { data: item, error: fetchError } = await supabase
      .from('approval_queue')
      .select('id, user_id, status')
      .eq('id', id)
      .eq('user_id', user.id)  // M-2: own-row scoped like approveAction
      .single()

    if (fetchError || !item) {
      return { error: 'Approval item not found or access denied' }
    }

    if (item.status !== 'failed') {
      return { error: `Cannot retry: item is in status "${item.status}" (only failed items can be retried)` }
    }

    // Pass only { id } — the router will atomically claim and re-fetch the DB-
    // authoritative row (M-2 claim + M-3 re-fetch). allowedStatuses=['failed']
    // means the conditional UPDATE only succeeds from failed state.
    await executeApprovedAction({ id }, ['failed'])

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
