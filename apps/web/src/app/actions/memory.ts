'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function editEntity(
  entityId: string,
  updates: { name: string; description?: string; aliases?: string[] }
): Promise<{ error?: string }> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { error: 'Not authenticated' }
  if (!updates.name?.trim()) return { error: 'Name is required' }

  const db = createServiceClient()

  const { error } = await db
    .from('entity_profiles')
    .update({
      name: updates.name.trim(),
      description: updates.description ?? null,
      aliases: updates.aliases ?? [],
    })
    .eq('id', entityId)
    .eq('user_id', userId)

  if (error) return { error: error.message }

  revalidatePath('/memory')
  return {}
}

export async function deleteEntity(entityId: string): Promise<{ error?: string }> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { error: 'Not authenticated' }

  const db = createServiceClient()

  const { error } = await db
    .from('entity_profiles')
    .delete()
    .eq('id', entityId)
    .eq('user_id', userId)

  if (error) return { error: error.message }

  revalidatePath('/memory')
  return {}
}

export async function deleteMemory(memoryId: string): Promise<{ error?: string }> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { error: 'Not authenticated' }

  const db = createServiceClient()

  // Create tombstone memory
  const { data: tombstone, error: tErr } = await db
    .from('memories')
    .insert({
      user_id: userId,
      content: '__deleted__',
      source: 'tombstone',
    })
    .select('id')
    .single()

  if (tErr || !tombstone) return { error: tErr?.message ?? 'Failed to delete' }

  const { error: updateErr } = await db
    .from('memories')
    .update({ superseded_by: tombstone.id })
    .eq('id', memoryId)
    .eq('user_id', userId)

  if (updateErr) return { error: updateErr.message }

  revalidatePath('/memory')
  return {}
}
