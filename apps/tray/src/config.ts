import 'dotenv/config'
import * as path from 'path'
import * as os from 'os'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const CONFIG = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  email: required('USER_EMAIL'),
  password: required('USER_PASSWORD'),
  appUrl: process.env.APP_URL ?? 'http://localhost:3001',
  sessionPath: path.join(os.homedir(), '.personal-assistant', 'session.json'),
  pollIntervalMs: 5 * 60 * 1000,  // fetch from DB every 5 minutes
  checkIntervalMs: 30 * 1000,     // check for due reminders every 30 seconds
}
