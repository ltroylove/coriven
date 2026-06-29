'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Zap, CheckCircle2, XCircle } from 'lucide-react'
import type { ChatMessage, ToolUseBlock, ToolResultBlock } from './types'

function ToolCallCard({ block, result }: { block: ToolUseBlock; result?: ToolResultBlock }) {
  const [expanded, setExpanded] = useState(false)
  const hasResult = result !== undefined
  const isError = result?.is_error

  return (
    <div className="my-3 rounded-lg border border-amber-800/40 bg-amber-950/20 overflow-hidden text-xs">
      <button
        onClick={() => setExpanded(v => !v)}
        aria-label={`Tool used: ${block.name}. ${expanded ? 'Collapse' : 'Expand'} details`}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-950/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      >
        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="font-mono text-amber-300 font-medium">{block.name}</span>
        <span className="text-amber-600/60 ml-auto flex items-center gap-1.5">
          {hasResult ? (
            isError
              ? <><XCircle className="w-3 h-3 text-red-400" /><span className="text-red-400">error</span></>
              : <><CheckCircle2 className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">done</span></>
          ) : (
            <span className="text-amber-500 animate-pulse">running…</span>
          )}
          {expanded ? <ChevronDown className="w-3 h-3 ml-1" /> : <ChevronRight className="w-3 h-3 ml-1" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-amber-800/30">
          <div className="px-3 py-2 bg-black/20">
            <p className="text-amber-600/60 uppercase tracking-widest text-[10px] mb-1">input</p>
            <pre className="text-amber-200/80 font-mono text-[11px] whitespace-pre-wrap break-all">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
          {hasResult && (
            <div
              className="px-3 py-2 border-t border-amber-800/20 bg-black/10"
              aria-label={`Tool result for ${block.name}: ${isError ? 'error' : 'success'}`}
            >
              <p className={`uppercase tracking-widest text-[10px] mb-1 ${isError ? 'text-red-500/60' : 'text-emerald-600/60'}`}>
                {/* Text label accompanies icon — meaning not conveyed by color alone (WCAG 1.4.1) */}
                result
              </p>
              <pre className={`font-mono text-[11px] whitespace-pre-wrap break-all ${isError ? 'text-red-300/80' : 'text-emerald-200/80'}`}>
                {result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UserMessage({ message }: { message: ChatMessage }) {
  const textBlocks = message.content.filter(b => b.type === 'text') as { type: 'text'; text: string }[]

  return (
    <div className="group flex flex-col gap-1 py-5">
      <div className="flex items-baseline gap-3">
        <span className="text-[10px] uppercase tracking-widest font-medium text-gray-600 shrink-0 w-16 text-right">you</span>
        <div className="flex-1 bg-gray-800/60 rounded-xl px-4 py-3 border border-gray-700/40">
          {textBlocks.map((b, i) => (
            <p key={i} className="text-sm font-mono text-gray-200 leading-relaxed whitespace-pre-wrap">
              {b.text}
            </p>
          ))}
        </div>
      </div>
      <div className="flex justify-end pr-0">
        <span className="text-[10px] text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity mr-1">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

function AssistantMessage({ message, isStreaming }: { message: ChatMessage; isStreaming?: boolean }) {
  const toolUseBlocks = message.content.filter(b => b.type === 'tool_use') as ToolUseBlock[]
  const toolResultBlocks = message.content.filter(b => b.type === 'tool_result') as ToolResultBlock[]
  const textBlocks = message.content.filter(b => b.type === 'text') as { type: 'text'; text: string }[]

  const resultMap = Object.fromEntries(toolResultBlocks.map(r => [r.tool_use_id, r]))

  return (
    <div className="group flex gap-3 py-5">
      <div className="shrink-0 w-16 flex justify-end pt-0.5">
        <div className="w-1.5 h-5 rounded-full bg-emerald-500/40 mt-0.5" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-widest font-medium text-emerald-600/80 block mb-2">
          assistant
        </span>

        {toolUseBlocks.map(block => (
          <ToolCallCard
            key={block.id}
            block={block}
            result={resultMap[block.id]}
          />
        ))}

        {textBlocks.map((b, i) => (
          <p key={i} className="text-sm text-gray-200 leading-7 whitespace-pre-wrap">
            {b.text}
            {isStreaming && i === textBlocks.length - 1 && (
              <span className="inline-block w-[2px] h-4 bg-emerald-400 ml-0.5 align-middle motion-safe:animate-[blink_1s_step-end_infinite]" aria-hidden="true" />
            )}
          </p>
        ))}

        {isStreaming && textBlocks.length === 0 && toolUseBlocks.length === 0 && (
          <span className="inline-block w-[2px] h-4 bg-emerald-400 align-middle motion-safe:animate-[blink_1s_step-end_infinite]" aria-hidden="true" />
        )}

        <span className="text-[10px] text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity block mt-2">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

export function Message({ message, isStreaming }: { message: ChatMessage; isStreaming?: boolean }) {
  if (message.role === 'user') return <UserMessage message={message} />
  return <AssistantMessage message={message} isStreaming={isStreaming} />
}
