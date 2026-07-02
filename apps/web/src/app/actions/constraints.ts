'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

export async function addConstraintAction(formData: FormData): Promise<{ error?: string }> {
  const rule = String(formData.get('rule') ?? '').trim()
  const rationale = String(formData.get('rationale') ?? '').trim()
  const scope = String(formData.get('scope') ?? 'all').trim() || 'all'
  const is_locked = formData.get('is_locked') === 'true'

  if (!rule) return { error: 'Rule is required.' }
  if (!rationale) return { error: 'Rationale is required.' }

  const db = await createAuthServerClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { error } = await db
    .from('behavioral_constraints')
    .insert({ user_id: user.id, rule, rationale, scope, is_locked })

  if (error) return { error: error.message }

  console.log(JSON.stringify({ event: 'constraint_ui_add', userId: user.id }))
  revalidatePath('/constraints')
  return {}
}

export async function removeConstraintAction(id: string): Promise<{ error?: string }> {
  const db = await createAuthServerClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { error } = await db
    .from('behavioral_constraints')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }

  console.log(JSON.stringify({ event: 'constraint_ui_remove', userId: user.id, constraintId: id }))
  revalidatePath('/constraints')
  return {}
}

export async function lockConstraintAction(id: string): Promise<{ error?: string }> {
  const db = await createAuthServerClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { error } = await db
    .from('behavioral_constraints')
    .update({ is_locked: true })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }

  console.log(JSON.stringify({ event: 'constraint_ui_lock', userId: user.id, constraintId: id }))
  revalidatePath('/constraints')
  return {}
}
