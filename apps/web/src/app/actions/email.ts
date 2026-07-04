'use server'

/**
 * Server Actions for email read-state management.
 *
 * RLS enforces per-user scoping — only the row owner can update their own rows.
 * revalidatePath keeps the inbox list in sync after a detail view is opened.
 */

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

/**
 * Marks a single email_metadata row as read for the currently signed-in user.
 *
 * Returns `{ success: true }` on success or `{ success: false, error: string }`
 * on failure — never throws, so callers can fire-and-forget safely.
 */
export async function markEmailRead(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createAuthServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthenticated' }
    }

    const { error } = await supabase
      .from('email_metadata')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', user.id) // Belt-and-suspenders in addition to RLS

    if (error) {
      console.error(
        JSON.stringify({
          event: 'email.actions.markRead.error',
          emailId: id,
          error: error.message,
        }),
      )
      return { success: false, error: error.message }
    }

    revalidatePath('/email')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        event: 'email.actions.markRead.unexpected',
        emailId: id,
        error: message,
      }),
    )
    return { success: false, error: message }
  }
}
