import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { CONFIG } from './config'

export type Session = { access_token: string; refresh_token: string; expires_at: number }

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function loadSavedSession(): Session | null {
  try {
    const raw = fs.readFileSync(CONFIG.sessionPath, 'utf-8')
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

function saveSession(session: Session) {
  ensureDir(CONFIG.sessionPath)
  fs.writeFileSync(CONFIG.sessionPath, JSON.stringify(session, null, 2))
}

export async function getValidSession(): Promise<Session> {
  const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  const saved = loadSavedSession()

  if (saved) {
    const expiresInMs = saved.expires_at * 1000 - Date.now()
    if (expiresInMs > 60_000) {
      return saved
    }
    // Refresh the session
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: saved.refresh_token })
    if (!error && data.session) {
      const refreshed: Session = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      }
      saveSession(refreshed)
      return refreshed
    }
  }

  // Sign in fresh
  const { data, error } = await supabase.auth.signInWithPassword({
    email: CONFIG.email,
    password: CONFIG.password,
  })
  if (error || !data.session) throw new Error(`Auth failed: ${error?.message}`)

  const session: Session = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  }
  saveSession(session)
  return session
}
