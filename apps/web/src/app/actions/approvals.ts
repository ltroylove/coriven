'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { writeAudit } from '@/lib/approvals/audit'
import { validatePayload } from '@/lib/approvals/payload-validator'
import type { ApprovalActionType, ApprovalProvider } from '@personal-assistant/types'
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
 * Approve a pending approval queue item.
 * Only valid from 'pending' status; sets status → 'approved' and stamps reviewed_at.
 * Appends an audit entry. Wave 5.3.2 adds the executor that picks up 'approved' items.
 */
export async function approveAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase, user } = await getAuthenticatedUser()

    // Fetch the item first to validate ownership and status
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
      return { error: `Cannot approve: item is already in status "${item.status}"` }
    }

    const { error: updateError } = await supabase
      .from('approval_queue')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'pending') // double-guard against race conditions

    if (updateError) {
      console.error('[approvals] approveAction failed', { userId: user.id, id, error: updateError.message })
      return { error: 'Failed to approve the action. Please try again.' }
    }

    // Append audit entry via service-role writer
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

    revalidatePath('/approvals')
    return {}
  } catch (err) {
    console.error('[approvals] approveAction unexpected error', { id, err })
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
      console.error('[approvals] cancelAction failed', { userId: user.id, id, error: updateError.message })
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
    console.error('[approvals] cancelAction unexpected error', { id, err })
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
      console.error('[approvals] approveWithModifiedPayload failed', { userId: user.id, id, error: updateError.message })
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

    revalidatePath('/approvals')
    return {}
  } catch (err) {
    console.error('[approvals] approveWithModifiedPayload unexpected error', { id, err })
    return { error: 'An unexpected error occurred. Please try again.' }
  }
}
