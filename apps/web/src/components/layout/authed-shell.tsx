/**
 * AuthedShell — shared server component composition.
 *
 * FLAGGED BOUNDED EDIT (Wave 9.1.3 task 9.1.3.1.1):
 * Extracted so that BOTH `(app)/layout.tsx` and the root `page.tsx` (which is
 * OUTSIDE the (app) route group and therefore does NOT inherit (app)/layout.tsx's
 * providers) can render the same provider + shell stack without duplication.
 *
 * Consumer contract:
 *   - Pass `userEmail` (from auth) and `timezone` (from profiles table or fallback).
 *   - Pass `children` as the panel content to render inside WorkspacePanel.
 *
 * This component is SERVER-side only — no 'use client'. Providers inside
 * AppShell are client components (PanelProvider, ConversationProvider, etc.).
 */

import { TimezoneProvider } from '@/components/providers/timezone-provider'
import { PanelProvider } from '@/components/providers/panel-provider'
import { AppShell } from '@/components/layout/app-shell'

interface AuthedShellProps {
  children: React.ReactNode
  userEmail: string
  timezone: string
}

export function AuthedShell({ children, userEmail, timezone }: AuthedShellProps) {
  return (
    <TimezoneProvider timezone={timezone}>
      <PanelProvider>
        <div className="h-screen flex bg-gray-950 text-white overflow-hidden">
          <AppShell userEmail={userEmail}>
            <div className="h-full overflow-auto p-6">{children}</div>
          </AppShell>
        </div>
      </PanelProvider>
    </TimezoneProvider>
  )
}
