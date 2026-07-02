'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

async function getAuthenticatedUser() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  return { supabase, user }
}

export async function updateGoalStatus(id: string, status: string): Promise<void> {
  const { supabase, user } = await getAuthenticatedUser()
  const { error } = await supabase
    .from('goals')
    .update({ status: status as 'active' | 'achieved' | 'paused' | 'abandoned' })
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) {
    console.error('[goals] updateGoalStatus failed', error)
    throw new Error('Failed to update goal status')
  }
  revalidatePath(`/goals/${id}`)
  revalidatePath('/goals')
}

export async function updateGoalConfidence(id: string, confidence: string): Promise<void> {
  const { supabase, user } = await getAuthenticatedUser()
  const { error } = await supabase
    .from('goals')
    .update({ confidence: confidence as 'high' | 'medium' | 'low' })
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) {
    console.error('[goals] updateGoalConfidence failed', error)
    throw new Error('Failed to update goal confidence')
  }
  revalidatePath(`/goals/${id}`)
  revalidatePath('/goals')
}

export async function updateProjectStatus(id: string, status: string): Promise<void> {
  const { supabase, user } = await getAuthenticatedUser()
  const { error } = await supabase
    .from('projects')
    .update({ status: status as 'pending' | 'in_progress' | 'done' | 'cancelled' })
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) {
    console.error('[goals] updateProjectStatus failed', error)
    throw new Error('Failed to update project status')
  }
  revalidatePath(`/projects/${id}`)
  revalidatePath('/goals')
}

// FormData-accepting wrappers for use with HTML forms in Server Components
export async function updateGoalStatusForm(formData: FormData): Promise<void> {
  const id = formData.get('id') as string
  const status = formData.get('status') as string
  if (!id || !status) throw new Error('Missing id or status')
  return updateGoalStatus(id, status)
}

export async function updateGoalConfidenceForm(formData: FormData): Promise<void> {
  const id = formData.get('id') as string
  const confidence = formData.get('confidence') as string
  if (!id || !confidence) throw new Error('Missing id or confidence')
  return updateGoalConfidence(id, confidence)
}

export async function updateProjectStatusForm(formData: FormData): Promise<void> {
  const id = formData.get('id') as string
  const status = formData.get('status') as string
  if (!id || !status) throw new Error('Missing id or status')
  return updateProjectStatus(id, status)
}
