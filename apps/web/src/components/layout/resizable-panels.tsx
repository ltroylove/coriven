'use client'

import { useState, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'

interface ResizablePanelsProps {
  children: React.ReactNode
  rightPanel: React.ReactNode
  defaultLeftPercent?: number
}

const HIDE_RIGHT_PANEL_ROUTES = ['/chat']

export function ResizablePanels({ children, rightPanel, defaultLeftPercent = 62 }: ResizablePanelsProps) {
  const pathname = usePathname()
  const hideRight = HIDE_RIGHT_PANEL_ROUTES.includes(pathname)
  const [leftPercent, setLeftPercent] = useState(defaultLeftPercent)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onMouseDown = useCallback(() => {
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMouseMove(e: MouseEvent) {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPercent(Math.min(80, Math.max(20, pct)))
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
  }, [])

  if (hideRight) {
    return (
      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="flex-1 overflow-auto min-w-0">{children}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden min-h-0">
      <div className="overflow-auto min-w-0" style={{ width: `${leftPercent}%` }}>
        {children}
      </div>
      <div
        className="shrink-0 w-1 bg-gray-800 hover:bg-blue-600 active:bg-blue-500 cursor-col-resize transition-colors"
        onMouseDown={onMouseDown}
      />
      <div className="flex-1 overflow-hidden min-w-0 border-l border-gray-800">
        {rightPanel}
      </div>
    </div>
  )
}
