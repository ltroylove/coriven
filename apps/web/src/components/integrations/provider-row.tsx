'use client'

/**
 * ProviderRow — client component for a single OAuth provider in the integrations list.
 *
 * Connect flow uses the Nango Connect Session Token approach (session-token flow):
 *   1. Calls createConnectSession() server action to get a short-lived session token.
 *   2. Opens nango.openConnectUI() with that token — Nango handles the OAuth iframe/popup.
 *   3. On success event, calls recordConnection() server action to persist the DB row.
 *   4. On cancel or error, no partial row is written.
 *
 * Disconnect flow:
 *   1. Shows a confirmation dialog before any destructive action.
 *   2. Calls disconnectProvider() server action which revokes in Nango then removes DB row.
 *
 * Required public env var (safe to ship to browser):
 *   NEXT_PUBLIC_NANGO_HOST — base URL of the self-hosted Nango instance
 *                            e.g. https://nango.example.com
 */

import { useState, useCallback } from 'react'
import Nango from '@nangohq/frontend'
import {
  createConnectSession,
  disconnectProvider,
  recordConnection,
} from '@/app/actions/integrations'
import type { IntegrationProvider } from '@personal-assistant/types'

export interface ProviderRowProps {
  provider: IntegrationProvider
  label: string
  description: string
  isConnected: boolean
  connectedAt: string | null
  grantedScopes: string[]
}

export function ProviderRow({
  provider,
  label,
  description,
  isConnected: initialConnected,
  connectedAt,
  grantedScopes,
}: ProviderRowProps) {
  const [isConnected, setIsConnected] = useState(initialConnected)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const handleConnect = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)

    try {
      // Step 1: Get a connect session token from the server (NANGO_SECRET_KEY stays server-side).
      const result = await createConnectSession(provider)
      if (result.error || !result.token) {
        setErrorMsg(result.error ?? 'Failed to start connection.')
        setLoading(false)
        return
      }

      const nangoHost = process.env.NEXT_PUBLIC_NANGO_HOST
      if (!nangoHost) {
        setErrorMsg('Nango host is not configured. Contact support.')
        setLoading(false)
        return
      }

      // Step 2: Open the Nango Connect UI iframe with the session token.
      const nango = new Nango({ host: nangoHost })
      const connectUI = nango.openConnectUI({
        sessionToken: result.token,
        baseURL: nangoHost,
        apiURL: nangoHost,
        onEvent: async (event) => {
          if (event.type === 'connect') {
            // Step 3: Record the connection in our DB.
            const connectionId = event.payload.connectionId
            const recordResult = await recordConnection(provider, connectionId)
            if (recordResult.error) {
              setErrorMsg(recordResult.error)
            } else {
              setIsConnected(true)
            }
            connectUI.close()
            setLoading(false)
          } else if (event.type === 'close') {
            // User closed the popup without completing auth — no row written.
            setLoading(false)
          } else if (event.type === 'error') {
            if (event.payload.errorType !== 'window_closed') {
              setErrorMsg(event.payload.errorMessage || 'Authorization failed.')
            }
            setLoading(false)
          }
        },
      })
      connectUI.open()
    } catch {
      setErrorMsg('An unexpected error occurred. Please try again.')
      setLoading(false)
    }
  }, [provider])

  const handleDisconnectConfirm = useCallback(async () => {
    setConfirming(false)
    setLoading(true)
    setErrorMsg(null)

    const result = await disconnectProvider(provider)
    if (result.error) {
      setErrorMsg(result.error)
      setLoading(false)
      return
    }

    setIsConnected(false)
    setLoading(false)
  }, [provider])

  return (
    <div className="flex flex-col gap-3 py-4 px-5 rounded-lg border border-gray-800 bg-gray-900/60">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-200">{label}</p>
            <StatusBadge isConnected={isConnected} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
          {isConnected && connectedAt && (
            <p className="text-xs text-gray-600 mt-1">
              Connected {new Date(connectedAt).toLocaleDateString()}
            </p>
          )}
          {isConnected && grantedScopes.length > 0 && (
            <p className="text-xs text-gray-600 mt-0.5">
              Scopes: {grantedScopes.join(', ')}
            </p>
          )}
        </div>

        <div className="shrink-0">
          {isConnected ? (
            confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Are you sure?</span>
                <button
                  onClick={handleDisconnectConfirm}
                  disabled={loading}
                  aria-label={`Confirm disconnect ${label}`}
                  className="px-2 py-1 text-xs font-medium rounded-md bg-red-700 text-white hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 transition-colors"
                >
                  Yes, disconnect
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={loading}
                  className="px-2 py-1 text-xs font-medium rounded-md border border-gray-700 text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                disabled={loading}
                aria-label={`Disconnect ${label}`}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )
          ) : (
            <button
              onClick={handleConnect}
              disabled={loading}
              aria-label={`Connect ${label}`}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-700 text-white hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <p
          role="alert"
          className="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded-md px-3 py-2"
        >
          {errorMsg}
        </p>
      )}
    </div>
  )
}

function StatusBadge({ isConnected }: { isConnected: boolean }) {
  if (isConnected) {
    return (
      <span
        aria-label="Connected"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        Connected
      </span>
    )
  }
  return (
    <span
      aria-label="Not connected"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-800/60 text-gray-500 border border-gray-700/40"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-gray-600" aria-hidden="true" />
      Not connected
    </span>
  )
}
