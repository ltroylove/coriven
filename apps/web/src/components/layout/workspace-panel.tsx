'use client'

import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { usePanel } from '@/components/providers/panel-provider'
import { SURFACE_MAP } from '@/lib/surfaces/registry'

interface WorkspacePanelProps {
  children: React.ReactNode
  chatPane: React.ReactNode
}

const CHAT_MIN_PX = 480

export function WorkspacePanel({ children, chatPane }: WorkspacePanelProps) {
  const { openSurface, widthPct, setWidth, closePanel } = usePanel()
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const panelOpen = openSurface !== null
  const surfaceLabel = panelOpen ? SURFACE_MAP[openSurface].label : null

  // ---------------------------------------------------------------------------
  // Global Esc listener — close panel, but IGNORE editable elements
  // (pre-clears the path for 9.3.2's shortcut registry)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (!panelOpen) return

      const target = e.target as HTMLElement | null
      if (!target) return

      // Ignore Esc when focus is inside a text input, textarea, or contenteditable
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return
      }

      closePanel()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [panelOpen, closePanel])

  // ---------------------------------------------------------------------------
  // Drag-handle resize logic (mouse)
  // ---------------------------------------------------------------------------
  const onMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMouseMove(e: MouseEvent) {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      // Panel is on the right; widthPct is the panel width as % of the container
      const panelPx = rect.right - e.clientX
      const totalPx = rect.width
      const pct = (panelPx / totalPx) * 100
      setWidth(pct)
    }

    function onMouseUp() {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [setWidth])

  // ---------------------------------------------------------------------------
  // Keyboard resize on the divider (arrow keys, ±2% per press)
  // ---------------------------------------------------------------------------
  const onDividerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setWidth(widthPct + 2) // moving divider left → panel gets wider
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setWidth(widthPct - 2) // moving divider right → panel shrinks
      }
    },
    [widthPct, setWidth],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!panelOpen) {
    // Panel closed — chat takes full width, centered at a readable max-width
    return (
      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="flex-1 flex justify-center overflow-hidden min-w-0">
          <div className="w-full max-w-[52rem]">{chatPane}</div>
        </div>
      </div>
    )
  }

  // Panel open — chat left (min 480px), divider, panel right (widthPct%)
  const panelWidthPct = widthPct
  // Ensure chat gets at least CHAT_MIN_PX. We express panel as a % so the
  // browser enforces the floor through the container flex layout.
  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden min-h-0">
      {/* Chat column */}
      <div
        className="overflow-hidden min-w-0 flex-1"
        style={{ minWidth: `${CHAT_MIN_PX}px` }}
      >
        {chatPane}
      </div>

      {/* Drag handle / divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={panelWidthPct}
        aria-valuemin={25}
        aria-valuemax={60}
        tabIndex={0}
        className={[
          'shrink-0 w-1 bg-gray-800',
          'hover:bg-emerald-600 focus:bg-emerald-600 active:bg-emerald-500',
          'cursor-col-resize transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500',
        ].join(' ')}
        onMouseDown={onMouseDown}
        onKeyDown={onDividerKeyDown}
      />

      {/* Workspace panel */}
      <div
        className="flex flex-col overflow-hidden min-w-0 border-l border-gray-800 motion-safe:transition-[width] motion-safe:duration-200"
        style={{ width: `${panelWidthPct}%` }}
      >
        {/* Panel chrome: header with surface label + close button */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900">
          <span className="text-sm font-medium text-gray-200">{surfaceLabel}</span>
          <button
            type="button"
            aria-label={`Close ${surfaceLabel} panel`}
            onClick={closePanel}
            className={[
              'flex items-center justify-center w-6 h-6 rounded',
              'text-gray-400 hover:text-white hover:bg-gray-800',
              'transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500',
            ].join(' ')}
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Panel content (route children) */}
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  )
}
