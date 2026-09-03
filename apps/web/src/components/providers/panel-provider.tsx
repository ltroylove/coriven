'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { surfaceForPathname, SURFACE_MAP, type SurfaceId } from '@/lib/surfaces/registry'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH_STORAGE_KEY = 'panel-width-pct'
const DEFAULT_WIDTH_PCT = 38
const MIN_WIDTH_PCT = 25
const MAX_WIDTH_PCT = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PanelState {
  openSurface: SurfaceId | null
  widthPct: number
}

export interface PanelContextValue extends PanelState {
  openPanel: (surface: SurfaceId, opts?: { focusId?: string }) => void
  closePanel: () => void
  togglePanel: () => void
  setWidth: (pct: number) => void
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const PanelContext = createContext<PanelContextValue | null>(null)

// ---------------------------------------------------------------------------
// Helper: clamp widthPct to 25–60
// ---------------------------------------------------------------------------
export function clampWidth(pct: number): number {
  return Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, pct))
}

// ---------------------------------------------------------------------------
// PanelProvider
// ---------------------------------------------------------------------------
export function PanelProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  // openSurface is derived from the URL (URL is source of truth)
  const urlSurface = surfaceForPathname(pathname)

  // Explicit close state — Esc/✕ closes the panel WITHOUT changing the URL
  // so refresh restores it. We track a "manually closed" flag that overrides
  // the URL-derived surface until the next navigation.
  const [manuallyClosed, setManuallyClosed] = useState(false)

  // Reset manual-close whenever the URL changes (navigation opens a surface again)
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    setManuallyClosed(false)
  }

  const openSurface: SurfaceId | null = manuallyClosed ? null : urlSurface

  // widthPct persists across reloads
  const [widthPct, setWidthPctState] = useState<number>(DEFAULT_WIDTH_PCT)

  useEffect(() => {
    const stored = typeof window !== 'undefined'
      ? localStorage.getItem(WIDTH_STORAGE_KEY)
      : null
    if (stored !== null) {
      const parsed = Number(stored)
      if (!Number.isNaN(parsed)) {
        setWidthPctState(clampWidth(parsed))
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  /**
   * openPanel — navigates to the surface route (URL is source of truth).
   * Appends `?focus=<focusId>` when provided so the surface can scroll/highlight.
   */
  const openPanel = useCallback(
    (surface: SurfaceId, opts?: { focusId?: string }) => {
      setManuallyClosed(false)
      const entry = SURFACE_MAP[surface]
      const url = opts?.focusId
        ? `${entry.route}?focus=${encodeURIComponent(opts.focusId)}`
        : entry.route
      router.push(url)
    },
    [router],
  )

  /**
   * closePanel — panel closed without changing URL; refresh restores from URL.
   */
  const closePanel = useCallback(() => {
    setManuallyClosed(true)
  }, [])

  /**
   * togglePanel — if open, close; if closed, re-open the URL-derived surface.
   */
  const togglePanel = useCallback(() => {
    if (openSurface !== null) {
      setManuallyClosed(true)
    } else {
      setManuallyClosed(false)
    }
  }, [openSurface])

  /**
   * setWidth — clamped 25–60, persisted.
   */
  const setWidth = useCallback((pct: number) => {
    const clamped = clampWidth(pct)
    setWidthPctState(clamped)
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped))
    } catch {
      // localStorage unavailable (SSR hydration guard)
    }
  }, [])

  const value: PanelContextValue = {
    openSurface,
    widthPct,
    openPanel,
    closePanel,
    togglePanel,
    setWidth,
  }

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
}

// ---------------------------------------------------------------------------
// usePanel hook
// ---------------------------------------------------------------------------
export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext)
  if (!ctx) {
    throw new Error('usePanel must be used within a PanelProvider')
  }
  return ctx
}
