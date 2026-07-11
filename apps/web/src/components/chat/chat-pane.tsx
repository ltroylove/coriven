'use client'

import { useState, useRef, useEffect } from 'react'
import { Message } from '@/components/chat/message'
import { Composer } from '@/components/chat/composer'
import { getChatHistory } from '@/app/actions/chat'
import type { ChatMessage } from '@/components/chat/types'
import type { SSEEvent } from '@/lib/chat/engine'

const PANEL_CONV_KEY = 'chat-panel-conversation-id'

function getOrCreatePanelConvId(): string {
  const stored = localStorage.getItem(PANEL_CONV_KEY)
  if (stored) return stored
  const id = crypto.randomUUID()
  localStorage.setItem(PANEL_CONV_KEY, id)
  return id
}

interface ChatPaneProps {
  conversationId?: string
  onFirstMessage?: (text: string) => void
}

export function ChatPane({ conversationId: propConvId, onFirstMessage }: ChatPaneProps) {
  const convIdRef = useRef<string | null>(propConvId ?? null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isBuildingContext, setIsBuildingContext] = useState(false)
  const [contextFallbackToast, setContextFallbackToast] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Resolve conversation ID and load history on mount.
  // Deduplication: persisted messages have stable DB-assigned UUIDs; any
  // in-session SSE messages that share an id (e.g. from an optimistic add)
  // are filtered out before merging to prevent duplicates (Story 1.4.1.1).
  useEffect(() => {
    if (!convIdRef.current) {
      convIdRef.current = getOrCreatePanelConvId()
    }
    getChatHistory(convIdRef.current).then(history => {
      setMessages(prev => {
        if (prev.length === 0) return history
        const existingIds = new Set(history.map(m => m.id))
        const newOnly = prev.filter(m => !existingIds.has(m.id))
        return [...history, ...newOnly]
      })
      setIsLoadingHistory(false)
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(text: string) {
    const convId = convIdRef.current!

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      created_at: new Date().toISOString(),
    }

    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setIsStreaming(true)
    setContextFallbackToast(false)

    if (messages.length === 0) onFirstMessage?.(text)

    const assistantId = crypto.randomUUID()
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: [],
      created_at: new Date().toISOString(),
    }])

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, conversationId: convId }),
        signal: abortRef.current.signal,
      })

      if (!response.ok || !response.body) throw new Error(`API error: ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as SSEEvent
            applySSEEvent(event, assistantId)
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: [{ type: 'text', text: `Error: ${String(err)}` }] }
            : m,
        ))
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  function applySSEEvent(event: SSEEvent, assistantId: string) {
    if (event.type === 'context_building') {
      setIsBuildingContext(true)
      return
    }
    if (event.type === 'done') {
      setIsBuildingContext(false)
      if (event.contextFallback) setContextFallbackToast(true)
      return
    }
    if (event.type === 'error') {
      setIsBuildingContext(false)
      return
    }
    setIsBuildingContext(false)
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === assistantId)
      if (idx === -1) return prev
      const msg = { ...prev[idx], content: [...prev[idx].content] }
      if (event.type === 'text_delta') {
        const last = msg.content[msg.content.length - 1]
        if (last?.type === 'text') {
          msg.content[msg.content.length - 1] = { type: 'text', text: last.text + event.delta }
        } else {
          msg.content.push({ type: 'text', text: event.delta })
        }
      } else if (event.type === 'tool_use') {
        msg.content.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input })
      } else if (event.type === 'tool_result') {
        msg.content.push({ type: 'tool_result', tool_use_id: event.tool_use_id, content: event.content, is_error: event.is_error })
      }
      const next = [...prev]
      next[idx] = msg
      return next
    })
  }

  function handleStop() {
    abortRef.current?.abort()
    setIsStreaming(false)
  }

  const isEmpty = !isLoadingHistory && messages.length === 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Scroll region — aria-live="polite" so screen readers announce newly
          appended messages without interrupting the user (UX Pass 6 §7, WCAG 2.1 AA).
          aria-busy conveys the loading state to assistive technology. */}
      <div
        className="flex-1 overflow-y-auto"
        aria-live="polite"
        aria-busy={isLoadingHistory}
        aria-label="Conversation messages"
      >
        {isLoadingHistory ? (
          /* role="status" + aria-label gives screen readers a meaningful
             announcement while history is being fetched (UX Pass 5 loading state).
             motion-safe: guards the pulse so prefers-reduced-motion is respected. */
          <div
            role="status"
            aria-label="Loading conversation history"
            className="h-full flex items-center justify-center"
          >
            <span className="text-xs text-gray-600 motion-safe:animate-pulse">
              Loading…
            </span>
          </div>
        ) : isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <div className="w-10 h-10 rounded-full border border-emerald-800/60 flex items-center justify-center mb-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <p className="text-sm text-gray-500 max-w-sm leading-relaxed">
              Ask me to create tasks, set reminders, or just think through what&apos;s on your plate.
            </p>
          </div>
        ) : (
          <div className="px-4 divide-y divide-gray-800/40">
            {messages.map((msg, i) => (
              <Message
                key={msg.id}
                message={msg}
                isStreaming={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
              />
            ))}
            {isStreaming && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-3 py-5">
                <div className="shrink-0 w-16 flex justify-end pt-0.5">
                  <div className="w-1.5 h-5 rounded-full bg-emerald-500/40 mt-0.5" />
                </div>
                <div className="pt-6">
                  {/* motion-safe: respects prefers-reduced-motion for the cursor blink */}
                  <span className="inline-block w-[2px] h-4 bg-emerald-400 align-middle motion-safe:animate-[blink_1s_step-end_infinite]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      {isBuildingContext && (
        <p aria-live="polite" className="px-4 pb-1 text-xs text-gray-500 motion-safe:animate-pulse">
          Building context…
        </p>
      )}
      {contextFallbackToast && (
        <div role="status" className="mx-4 mb-2 flex items-center justify-between rounded-md border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-400">
          <span>Context timed out — used previous snapshot</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setContextFallbackToast(false)}
            className="ml-3 text-amber-600 hover:text-amber-400"
          >
            ✕
          </button>
        </div>
      )}
      <Composer onSend={handleSend} isStreaming={isStreaming || isLoadingHistory} onStop={handleStop} />
    </div>
  )
}
