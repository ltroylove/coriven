import { execSync } from 'child_process'
import * as path from 'path'

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const APP_NAME = 'PersonalAssistant'

export function registerStartup(exePath: string): void {
  const quoted = `"${path.resolve(exePath)}"`
  try {
    execSync(`reg add "${REG_KEY}" /v ${APP_NAME} /t REG_SZ /d ${quoted} /f`)
    console.log('Registered startup entry:', quoted)
  } catch (err) {
    console.error('Failed to register startup entry:', err)
  }
}

export function unregisterStartup(): void {
  try {
    execSync(`reg delete "${REG_KEY}" /v ${APP_NAME} /f`)
    console.log('Removed startup entry')
  } catch {
    // Key may not exist — ignore
  }
}

export function isStartupRegistered(): boolean {
  try {
    execSync(`reg query "${REG_KEY}" /v ${APP_NAME}`)
    return true
  } catch {
    return false
  }
}
