---
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: foundation-ux
status: Draft
domain: product
product:
  - "coriven"
tags: [coriven, ux-foundations, designer-passes]
relateddocuments:
  - "03-Business-Requirements.md"
  - "04-Architecture.md"
  - "05-User-Experience.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Coriven — UX Foundations (6-Pass Designer Analysis)

> Produced before visual design (per `ux-foundations-design`). Each pass forces a designer mindset so the visual spec (`05-User-Experience.md`) is usable, not just pretty. Inputs: Business Requirements, Architecture, and the master blueprint.

## Pass 1 — Mental Model Alignment

**Primary user intent (one sentence):** "Help me run my life around what actually matters, and remember everything so I don't have to."

**Mental model analogy:** A *chief of staff who never forgets* — not a to-do list, not a chatbot. The user delegates remembering and organizing; the assistant briefs them, nudges them, and asks permission before acting outward.

**Likely misconceptions to correct:**
- "It's a task app" → it's goal-first; tasks ladder up to goals.
- "It autonomously does things" → it drafts and proposes; **the user approves** external actions.
- "Memory is magic/opaque" → memory is **visible and correctable** on `/memory`.
- "Reminders are separate things" → reminders are a facet of a task.

**Language / terminology (use the user's words):** Life Area, Goal, Project, Task, Reminder, Briefing, Memory, Entity (person/place/project/thing/resource), Approval, Constraint. Avoid jargon like "embedding," "Sentinel," "RLS" in the UI — these are internal.

## Pass 2 — Information Architecture

**Exhaustive list of user-visible concepts:** chat conversation; tasks; reminders (on tasks); goals; life areas; projects; momentum; daily briefing; weekly review; memories; entities; conversation summaries; tool permissions; behavioral constraints; emails (triaged); calendar events; meeting prep; approvals queue; audit history; subscription/tier; account/profile; timezone/briefing-time settings; notifications.

**Grouped by user mental model (not system architecture):**
- **Today / Act** — Chat, Tasks (with reminders), Daily Briefing, Approvals.
- **Direction / Why** — Goals (Life Areas → Goals → Projects), momentum, weekly review.
- **What it knows** — Memory (Entities + Memories), Constraints.
- **Inbox / World** — Email, Calendar, Meeting prep (comms phase).
- **Settings** — Tool permissions, integrations, briefing time/timezone, subscription, profile, data export/delete.

**Progressive disclosure (Primary / Secondary / Hidden):**
- **Primary (always reachable):** Chat, Tasks, Goals, Briefing.
- **Secondary (one level in):** Memory, Approvals, Email/Calendar, Settings.
- **Hidden (deep/admin):** Audit history, constraint authoring, data export/delete, raw conversation summaries.

**Navigation hierarchy:** Persistent left/primary nav: **Today · Chat · Tasks · Goals · Memory · (Email) · (Approvals) · Settings.** Chat is co-present (a docked pane) on most screens so the assistant is always one message away. Current built layout already uses a resizable two-pane (content + chat) shell — keep it.

## Pass 3 — Affordances & Action Clarity

**Every action → signal mapping (representative):**
- Send a message → text composer + Send button + Enter; "thinking" indicator while streaming.
- Create task/goal → primary button; inline form; natural-language creation via chat is equally first-class.
- Complete task → checkbox with immediate (optimistic) state change.
- Snooze/dismiss reminder → action buttons on the tray notification *and* on the task card (Snooze 15m / 1h / Dismiss).
- Edit/correct a memory → editable fields on `/memory`; "supersede" shown as history, not destructive delete.
- Approve/Modify/Cancel an action → three distinct buttons; Approve is primary, Cancel is destructive styling, Modify opens inline editing of the payload.
- Toggle a tool permission → switch control with on/off label.
- Author a constraint → explicit "Add constraint" with a required *rationale* field and a lock indicator.

**Affordance rules:**
- Anything clickable looks clickable (buttons, links, switches have consistent styling).
- **Destructive vs reversible:** deletes and external sends use destructive styling + confirmation; internal edits are reversible and need no confirm.
- **AI-touched content is labeled:** triaged email urgency, AI summaries, and proposed actions carry a clear "AI" / "proposed" marker.

**Interaction patterns:** Primary action per screen is visually dominant; secondary actions are quiet; destructive actions are separated and confirmed.

## Pass 4 — Cognitive Load & Decision Minimization

**Friction points:** deciding what to do next (mitigated by the briefing + momentum); fear that the AI will act without asking (mitigated by approval gates + clear labeling); uncertainty about what the AI remembers (mitigated by visible `/memory`); too many reminder/recurrence options.

**Defaults that cover 80%+:**
- New reminder defaults to a sensible time and `recurrence_type = none`.
- New task default priority `medium`, status `pending`.
- Briefing default 7:00 AM local.
- Tools sensible-default enabled for the core set; risky/external tools default off until the relevant phase.

**Progressive disclosure strategy:** show the common path first; reveal recurrence, scoping, success metrics, and advanced fields on demand. Don't surface comms/approvals UI until integrations are connected.

**Cognitive-load budget:** **≤3 primary decisions per screen.** The briefing is read-first (zero required decisions). Chat is a single decision (what to say). Approvals are a single 3-way decision (Approve/Modify/Cancel).

## Pass 5 — State Design & Feedback

For each major element, the five states:

| Element | Empty | Loading | Success | Partial | Error |
|---|---|---|---|---|---|
| **Chat** | Greeting + suggested prompts | Streaming "thinking" indicator | Streamed reply (+ tool actions shown) | Reply with stale context (Sentinel fallback) — invisible to user | "Couldn't reach the assistant — retry" |
| **Tasks** | "No tasks yet — add one or ask in chat" | Skeleton list | Task cards with reminder chips | Some reminders failed to load → show task, flag reminders | Inline error + retry |
| **Reminders (tray)** | n/a | n/a | Native toast with Snooze/Dismiss | Offline → fire from cached payload | Silent retry on next poll |
| **Goals** | "Set your first goal — what matters?" | Skeleton cards | Goal cards with momentum label | Momentum not yet computed → "calculating" | Error banner |
| **Memory** | "I haven't learned anything yet" | Skeleton | Entity + memory lists, editable | Superseded facts shown as history | Error + retry |
| **Approvals** | "Nothing waiting for review" | Skeleton | Pending cards (what + why) | Execution pending after approve → "executing…" | "Execution failed — retry/cancel", logged |
| **Briefing** | "Your first briefing arrives tomorrow at 7am" | Generating | Sectioned briefing | Comms sections absent until connected | Fallback to last briefing |

**State transitions:** optimistic updates for internal actions (task complete, snooze); server-confirmed for external actions (approval → executing → executed). **Feedback timing:** immediate (<100ms) for clicks; streaming for chat; toast confirmations for background completions.

## Pass 6 — Flow Integrity Check

**Flow risks (where users get lost / fail):**
- Not realizing the assistant remembers → mitigate with a visible Memory page and occasional "I'll remember that" confirmations.
- Fear of unwanted external actions → mitigate with universal approval gating + explicit labeling of "proposed."
- Reminders missed because the tray isn't running → mitigate with briefing-on-startup + (later) Web Push as a second channel.
- Goal abandonment going unnoticed → mitigate with stale-goal nudges.

**Visibility decisions (must be visible vs can be implied):**
- **Must be visible:** approval gates; what the AI remembers; reminder snooze/dismiss controls; momentum/stalled state; tier limits when hit.
- **Can be implied:** the Sentinel/async memory machinery; embeddings; recurrence math; fallback behavior.

**First-time user path (zero documentation required):** Sign in → land on Today/Chat with a greeting and 2–3 suggested actions ("Add a task," "Tell me about your week," "Set a goal") → create one task with a reminder → see it on Tasks → (later) get the first briefing. The onboarding wizard (Phase 6) formalizes this into 4 steps ending in a first goal + task.

**Hard UX constraints for the visual phase:**
1. Every external-action UI must show *what* will happen and *why*, with Approve/Modify/Cancel.
2. AI-generated or AI-proposed content must be visually labeled.
3. Memory must be viewable and correctable; corrections use supersession, not silent deletion.
4. ≤3 primary decisions per screen; the briefing requires none.
5. Reminders are presented as a facet of tasks, never a separate top-level "reminders" section.
6. Chat is co-present (docked pane) wherever practical.
7. WCAG 2.1 AA: keyboard-navigable, labeled, focus-visible, `prefers-reduced-motion` respected.

## Foundations → Visual Spec Mapping

| Pass | Feeds into (05-User-Experience.md) |
|---|---|
| 1 Mental model | UX Strategy: philosophy, principles, terminology |
| 2 Information architecture | Site map, navigation, content strategy |
| 3 Affordances | Component library + interaction patterns |
| 4 Cognitive load | Simplified flows + defaults |
| 5 State design | State tables per screen |
| 6 Flow integrity | User-flow guardrails + first-run path |

## Document Information

- **Created By**: Roy Love
- **Creation Date**: 2026-06-29
- **Version**: 1.0
- **Document Status**: Draft
- **Next Review Date**: Before Phase 3 UI work
