'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowUp, Square } from 'lucide-react'

type Props = {
  onSend: (message: string) => void
  isStreaming: boolean
  onStop: () => void
  disabled?: boolean
}

export function Composer({ onSend, isStreaming, onStop, disabled }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [value])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || isStreaming || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  return (
    <div className="shrink-0 border-t border-gray-800 bg-gray-950 px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-3 bg-gray-900 border border-gray-700/60 rounded-2xl px-4 py-3 focus-within:border-gray-600 transition-colors">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message your assistant…"
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 resize-none focus:outline-none leading-relaxed min-h-[1.5rem] max-h-[200px] font-mono disabled:opacity-40"
          />
          <div className="flex items-center gap-2 shrink-0 pb-0.5">
            {isStreaming ? (
              <button
                onClick={onStop}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors text-white"
                title="Stop generating"
              >
                <Square className="w-3 h-3 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!value.trim() || disabled}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-600 transition-colors text-white"
                title="Send (Enter)"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="text-[10px] text-gray-700 text-center mt-2">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
