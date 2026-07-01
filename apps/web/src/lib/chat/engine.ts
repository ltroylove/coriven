import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, CHAT_MODEL_SMART } from '@/lib/anthropic'
import { createServiceClient } from '@/lib/supabase/server'
import { TOOL_REGISTRY } from '@/lib/chat/tools/registry'
import { executeToolHandler } from '@/lib/chat/tools/handlers'
import type { ChatMessage, TextBlock, ToolUseBlock, ToolResultBlock } from '@/components/chat/types'
import { loadMemoryContext } from '@/lib/memory/context-loader'
import type { MemoryContext } from '@/lib/memory/context-loader'
import { runSentinel } from '@/lib/memory/sentinel'
import { loadConstraintsForUser, evaluateConstraint } from '@/lib/chat/constraints'
import type { BehavioralConstraint } from '@personal-assistant/types'

export type SSEEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string }

function buildSystemPrompt(disabledTools: string[], memoryContext?: MemoryContext): string {
  const now = new Date().toISOString()
  let prompt = `You are a personal assistant that helps the user manage tasks and reminders.
Today is ${now}.

## How tasks work
Tasks are the single source of truth. A "reminder" is just a task with a \`remind_at\` time set.
When the user says "remind me about X", always call list_tasks first to check if a task for X already exists.
- If a matching task is found: call update_task to set remind_at (and recurrence_type if they want it to repeat).
- If no task is found: call create_task with remind_at set.
Never ask the user to repeat information that's already in an existing task.

## Reminders
- remind_at: when to notify the user (ISO 8601)
- recurrence_type: none | daily | weekdays | weekly | monthly | yearly
- snoozed_until: set automatically when the user snoozes

## General rules
- Use ISO 8601 for all datetimes (e.g. "2026-06-20T09:00:00").
- Be concise. After using a tool, confirm in one sentence what you did.
- Never invent task IDs — always get them from list_tasks first.`

  if (memoryContext) {
    if (memoryContext.entityProfiles.length > 0) {
      prompt += '\n\n## What I know about the people, places, and projects in your life\n'
      for (const e of memoryContext.entityProfiles) {
        const aliases = e.aliases.length > 0 ? ` (also known as: ${e.aliases.join(', ')})` : ''
        prompt += `- **${e.name}**${aliases} [${e.type}]${e.description ? ': ' + e.description : ''}\n`
      }
    }

    if (memoryContext.memories.length > 0) {
      prompt += '\n## Relevant memories\n'
      for (const m of memoryContext.memories) {
        prompt += `- ${m.content}\n`
      }
    }

    if (memoryContext.summaries.length > 0) {
      prompt += '\n## Recent conversation summaries\n'
      for (const s of memoryContext.summaries) {
        prompt += `- ${s.summary}\n`
      }
    }

    if (memoryContext.userContext) {
      const prefs = Object.entries(memoryContext.userContext.preferences)
      const facts = Object.entries(memoryContext.userContext.facts)
      if (prefs.length > 0 || facts.length > 0) {
        prompt += '\n## User preferences and facts\n'
        for (const [k, v] of prefs) prompt += `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}\n`
        for (const [k, v] of facts) prompt += `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}\n`
      }
    }
  }

  prompt += `

## Behavioral constraints
The owner has configured behavioral constraints — rules you must always follow. Constraints are
enforced at the engine level before any tool executes. When a tool call is blocked you will receive
a tool_result with is_error: true explaining which constraint was matched. Do NOT retry a blocked
action. When calling add_constraint on behalf of the user, always include the user's stated reason
as the \`rationale\` field — it is required and cannot be empty.`

  if (disabledTools.length > 0) {
    prompt += `

The following tools are currently disabled: ${disabledTools.join(', ')}.
If the user asks you to do something that requires one of these disabled tools, do NOT attempt to use it.
Instead, tell them: "To do that, you'll need to enable [tool name] in Settings → Tools."
Do not pretend you can perform the action.`
  }

  return prompt
}

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
      if (text) result.push({ role: 'user', content: text })
    } else {
      const textBlocks = msg.content.filter((b): b is TextBlock => b.type === 'text')
      const toolUseBlocks = msg.content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
      const toolResultBlocks = msg.content.filter((b): b is ToolResultBlock => b.type === 'tool_result')

      if (toolUseBlocks.length > 0) {
        const assistantContent: Anthropic.ContentBlockParam[] = [
          ...textBlocks.map(b => ({ type: 'text' as const, text: b.text })),
          ...toolUseBlocks.map(b => ({
            type: 'tool_use' as const,
            id: b.id,
            name: b.name,
            input: b.input,
          })),
        ]
        if (assistantContent.length > 0) {
          result.push({ role: 'assistant', content: assistantContent })
        }
        if (toolResultBlocks.length > 0) {
          result.push({
            role: 'user',
            content: toolResultBlocks.map(b => ({
              type: 'tool_result' as const,
              tool_use_id: b.tool_use_id,
              content: b.content,
              ...(b.is_error ? { is_error: b.is_error } : {}),
            })),
          })
        }
      } else {
        const text = textBlocks.map(b => b.text).join('\n')
        if (text) result.push({ role: 'assistant', content: text })
      }
    }
  }

  return result
}

async function loadToolPermissions(userId: string): Promise<{ enabled: Anthropic.Tool[]; disabledNames: string[] }> {
  const db = createServiceClient()
  const { data } = await db
    .from('tool_permissions')
    .select('tool_name, enabled')
    .eq('user_id', userId)

  if (!data || data.length === 0) return { enabled: [], disabledNames: [] }

  const enabled = data
    .filter(row => row.enabled)
    .map(row => TOOL_REGISTRY[row.tool_name as keyof typeof TOOL_REGISTRY])
    .filter(Boolean) as Anthropic.Tool[]

  const disabledNames = data
    .filter(row => !row.enabled)
    .map(row => row.tool_name)

  return { enabled, disabledNames }
}

async function saveMessage(
  userId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  toolCalls?: Anthropic.ToolUseBlock[],
): Promise<void> {
  const db = createServiceClient()
  await db.from('conversation_messages').insert({
    user_id: userId,
    conversation_id: conversationId,
    role,
    content,
    tool_calls: toolCalls && toolCalls.length > 0 ? (toolCalls as unknown as import('@/types/supabase').Json) : null,
  })
}

export async function runChatEngine({
  userId,
  conversationId,
  clientMessages,
  send,
}: {
  userId: string
  conversationId: string
  clientMessages: ChatMessage[]
  send: (event: SSEEvent) => void
}): Promise<void> {
  const { enabled: enabledTools, disabledNames } = await loadToolPermissions(userId)

  // Load constraints once per turn — gate is a pure function called per tool block (ADR-007)
  let constraints: BehavioralConstraint[] = []
  try {
    constraints = await loadConstraintsForUser(userId)
  } catch {
    // Fail-open: constraint load error must never break chat
    console.error(JSON.stringify({ event: 'constraint_load_error', userId, error: 'load failed at engine start' }))
  }

  // Load memory context via three-tier degradation (graceful — never blocks chat on failure)
  let memoryContext: MemoryContext | undefined
  try {
    const lastUserMessage = clientMessages.findLast(m => m.role === 'user')
    const lastText = lastUserMessage?.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.text)
      .join(' ') ?? ''
    memoryContext = await loadMemoryContext(userId, lastText)
  } catch (err) {
    console.warn('[engine] Memory context load failed; continuing without memory', err)
  }

  const system = buildSystemPrompt(disabledNames, memoryContext)
  const anthropicMessages = toAnthropicMessages(clientMessages)

  // Persist the new user message (last item in clientMessages)
  const lastUserMsg = clientMessages[clientMessages.length - 1]
  if (lastUserMsg?.role === 'user') {
    const text = lastUserMsg.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
    await saveMessage(userId, conversationId, 'user', text)
    runSentinel(userId, text, 'user').catch(() => {/* already handled internally */})
  }

  const loopMessages = [...anthropicMessages]
  let assistantText = ''
  const assistantToolCalls: Anthropic.ToolUseBlock[] = []

  for (let turn = 0; turn < 10; turn++) {
    const stream = anthropic.messages.stream({
      model: CHAT_MODEL_SMART,
      max_tokens: 4096,
      system,
      messages: loopMessages,
      ...(enabledTools.length > 0 ? { tools: enabledTools } : {}),
    })

    stream.on('text', (delta: string) => {
      assistantText += delta
      send({ type: 'text_delta', delta })
    })

    const finalMsg = await stream.finalMessage()
    loopMessages.push({ role: 'assistant', content: finalMsg.content })

    if (finalMsg.stop_reason !== 'tool_use') break

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of finalMsg.content) {
      if (block.type !== 'tool_use') continue
      assistantToolCalls.push(block)
      send({ type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> })

      // Pre-action constraint gate (ADR-007) — evaluated before any handler executes
      const gateResult = constraints.length > 0
        ? evaluateConstraint(block.name, block.input as Record<string, unknown>, constraints)
        : { matched: false as const }

      if (gateResult.matched && gateResult.isLocked) {
        const violationMsg = `Action blocked by constraint: "${gateResult.constraint.rule}". Reason: "${gateResult.constraint.rationale}". This constraint is locked and cannot be overridden.`
        console.log(JSON.stringify({ event: 'constraint_block', userId, toolName: block.name, matchedConstraintId: gateResult.constraint.id, isLocked: true }))
        send({ type: 'tool_result', tool_use_id: block.id, content: violationMsg, is_error: true })
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: violationMsg, is_error: true })
        continue
      }

      // For unlocked matches: log the warning but still execute the handler.
      // We prepend the warning to the tool result so the model sees it in a single tool_result.
      if (gateResult.matched && !gateResult.isLocked) {
        console.log(JSON.stringify({ event: 'constraint_warning', userId, toolName: block.name, matchedConstraintId: gateResult.constraint.id, isLocked: false }))
      }

      const result = await executeToolHandler(block.name, block.input as Record<string, unknown>, userId)

      const resultContent = (gateResult.matched && !gateResult.isLocked)
        ? `Note: this action may relate to a standing constraint: "${gateResult.constraint!.rule}". Reason: "${gateResult.constraint!.rationale}". Proceeding as the constraint is not locked.\n\n${result.content}`
        : result.content

      send({ type: 'tool_result', tool_use_id: block.id, content: resultContent, is_error: result.is_error })

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: resultContent,
        ...(result.is_error ? { is_error: result.is_error } : {}),
      })
    }

    loopMessages.push({ role: 'user', content: toolResults })
  }

  await saveMessage(userId, conversationId, 'assistant', assistantText, assistantToolCalls)
  runSentinel(userId, assistantText, 'assistant').catch(() => {/* already handled internally */})
}
