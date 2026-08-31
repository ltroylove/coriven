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
tags: [coriven, ux, screens, flows]
relateddocuments:
  - "05a-UX-Foundations.md"
  - "03-Business-Requirements.md"
  - "04-Architecture.md"
  - "docs/planning/2026-06-24-coriven-master-blueprint.md"
---

# Coriven — User Experience

> Visual specifications, derived from `05a-UX-Foundations.md`. Reflects the as-built two-pane (content + docked chat) shell and extends it per phase. The blueprint governs on conflict.

## Document Overview

### Purpose

Define the UX: principles, information architecture, flows, components, screens, states, accessibility, and success metrics.

### Scope

Web/PWA UI and the Tauri tray notifications. Covers built screens (Tasks, Chat, Settings) and future screens (Today/Briefing, Goals, Memory, Email, Approvals, Onboarding).

### Audience

Owner/developer; future contributors.

## UX Strategy

### Design Philosophy

A *chief of staff who never forgets*. Calm, goal-first, trustworthy. The assistant is always one message away (docked chat), it shows what it knows, and it never reaches into the world without asking.

#### Core UX Principles (from Pass 1 + Pass 6)

1. **Goal-first, not list-first** — surface *why*, not just *what*.
2. **Visible, correctable memory** — the user can always see and fix what Coriven knows.
3. **Human-in-the-loop** — external actions are proposed and approved, never silent.
4. **Calm proactivity** — briefings and nudges inform; they don't nag.
5. **Progressive disclosure** — common path first; complexity on demand (≤3 decisions/screen).

#### AI-Specific UX Considerations

- **Explainability**: AI-proposed content and triage are labeled; approvals show what + why.
- **Trust building**: approval gates, visible memory, audit history.
- **Error recovery**: edit/override memory; Modify/Cancel approvals; graceful AI-unavailable states.
- **Learning feedback**: "I'll remember that" confirmations; corrections via supersession.

### Target User Analysis

#### Primary Persona: Roy (owner)

- **Demographics**: Technical founder, high AI comfort.
- **Goals**: Run life by goals; offload remembering; be nudged early; trust constraints.
- **Context of use**: Desktop daily (web + tray); later mobile (PWA).
- **Success Metrics**: Reminders fire reliably; memory compounds and is correct; goals tracked.

#### Secondary Persona: Free-tier Beta User

- Medium technical skill; wants quick wins and to feel "it remembers me"; converts at the entity/reminder cap.

### User Journey Mapping

#### Future State Journey: Owner (daily)

```
1. Morning: tray toast → open Today/Briefing (goals in motion, upcoming, stalled, approvals)
2. Add/triage tasks via chat or Tasks page; reminders set inline
3. Throughout day: tray fires due reminders → Snooze/Dismiss
4. Ask Coriven things; it recalls people/projects without re-statement
5. (Comms) Review triaged email; draft reply → Approvals → approve → sent
6. Friday: weekly review surfaces wins/blockers
Benefits: less remembering, goal alignment, proactive surfacing, safe external actions
```

### User Experience Goals

1. **Goal**: Zero re-statement of standing context.
   - **Target**: cross-session recall works first try. **Measurement**: recall-win events.
2. **Goal**: Confidence that nothing external happens without approval.
   - **Target**: 100% of external actions gated. **Measurement**: audit log; user trust.

## Information Architecture

### Site Map / Navigation Structure (from Pass 2)

```
Coriven
├── Today (Briefing)            [Phase 3]
├── Chat                        [built — also docked on most screens]
├── Tasks (with reminders)      [built]
├── Goals                       [Phase 3]
│   ├── Life Areas → Goals (momentum)
│   ├── Goal detail
│   └── Project detail
├── Memory                      [Phase 2]
│   ├── Entities
│   └── Memories (with history/supersession)
├── Email                       [Phase 4]
│   ├── Triaged inbox
│   └── Thread / Meeting prep
├── Approvals                   [Phase 4]
├── Constraints                 [conditional, post-Phase 2]
└── Settings
    ├── Tool permissions        [built]
    ├── Integrations            [Phase 4]
    ├── Briefing time / timezone[Phase 3]
    ├── Subscription            [Phase 6]
    └── Account / Data export & delete
```

### Content Strategy

| Content Type | Purpose | User Need | Priority |
|---|---|---|---|
| Briefing | Daily orientation | "What matters today?" | High |
| Chat replies | Assistance + actions | Get things done | High |
| Tasks/reminders | Execution | Don't drop the ball | High |
| Goals + momentum | Direction | "Am I on track?" | High |
| Memory/entities | Transparency | "What does it know?" | Medium |
| Approvals | Trust/control | Safe external actions | High (comms) |

### User Flow Design

#### Core Flow: Natural-language task + reminder (built)

```mermaid
graph TD
    A[User: "remind me to call mom tomorrow 9am"] --> B[Chat engine selects create_task + add_reminder]
    B --> C[Tools execute - task_reminders row created]
    C --> D[Assistant confirms; task appears on Tasks]
    D --> E[Next day 9am: tray toast fires]
    E --> F{User action}
    F -->|Snooze 15m/1h| G[snoozed_until updated]
    F -->|Dismiss| H[fired; recurrence advances if any]
```

#### Core Flow: Draft → Approval → Send (Phase 4)

```mermaid
graph TD
    A[User: "reply to Sarah declining tomorrow"] --> B[Claude drafts + submit_for_approval]
    B --> C[approval_queue pending; payload validated]
    C --> D[Tray: action waiting for approval]
    D --> E[/Approvals: review what + why/]
    E --> F{Decision}
    F -->|Approve| G[audit_log + executor sends → executed]
    F -->|Modify| E
    F -->|Cancel| H[logged; nothing sent]
```

#### Flow: First-time user (from Pass 6)

Sign in → Today/Chat greeting + 2–3 suggested actions → create first task w/ reminder → see it on Tasks → first briefing next morning. (Phase 6 formalizes as a 4-step wizard ending in a first goal + task.)

## Interface Design

### Design System

#### Visual Design Principles

- **Clarity**: calm, uncluttered, goal-first.
- **Consistency**: shared components across screens; reuse the built chat/task components.
- **Accessibility**: WCAG 2.1 AA.
- **AI transparency**: clear indicators when content is AI-generated or proposed.

> Color palette, typography scale, and spacing are **TO BE DETERMINED** with the `frontend-design` / `taste-design` skills during implementation — Tailwind 4 tokens, no component library yet. Hard rule: AA contrast, focus-visible, `prefers-reduced-motion` respected.

### Component Library (affordance-aware, from Pass 3)

Existing/needed components:

- **Composer** (built — `components/chat/composer.tsx`): textarea + Send; Enter to send; disabled while streaming.
- **Message** (built — `components/chat/message.tsx`): role-styled bubble; renders tool actions taken; AI label.
- **TaskCard** (built — `components/tasks/task-card.tsx`): title, priority, due, reminder chips, complete checkbox (optimistic), snooze/dismiss.
- **TaskForm** (built — `components/tasks/task-form.tsx`): create/edit with sensible defaults; recurrence on demand.
- **ToolPermissionToggle** (built — settings): switch with on/off label.
- **GoalCard** (Phase 3): title, why, momentum badge (improving/stable/stalled), linked tasks count.
- **MemoryEntityRow** (Phase 2): editable entity (name, type, description, aliases); history for superseded facts.
- **ApprovalCard** (Phase 4): action type, description (what), rationale (why), payload preview; Approve (primary) / Modify / Cancel (destructive).
- **BriefingSection** (Phase 3): read-first sections; no required decisions.
- **NotificationToast** (tray): native; Snooze 15m / 1h / Dismiss action buttons.

Component contracts (illustrative):

```typescript
interface ApprovalCardProps {
  actionType: string;        // send_email | create_event | ...
  description: string;       // what will happen
  rationale: string;         // why (from the source context)
  payload: unknown;          // editable on Modify
  onApprove: () => void;
  onModify: (next: unknown) => void;
  onCancel: () => void;
}

interface GoalCardProps {
  title: string;
  whyItMatters?: string;
  momentum: 'improving' | 'stable' | 'declining';
  linkedTaskCount: number;
  onOpen: () => void;
}
```

### Screen Designs

#### Today / Briefing (Phase 3)

**Purpose**: daily orientation; read-first, zero required decisions.

```
┌───────────────────────────────────────────────┬─────────────┐
│ GOOD MORNING, ROY. Mon, Jun 29.                │  Chat       │
│                                                │  (docked)   │
│ GOALS IN MOTION                                │             │
│   Lose 100 lbs — improving                     │  "Ask me    │
│   Ship Coriven v1 — stable                     │   anything" │
│                                                │             │
│ UPCOMING (7 days)                              │             │
│   • Gym — today 7am                            │             │
│   • Dentist — Wed 2pm                          │             │
│                                                │             │
│ STALLED (needs attention)                      │             │
│   Read 12 books — no activity 16 days          │             │
│                                                │             │
│ APPROVALS PENDING: 2 → Review                  │             │
└───────────────────────────────────────────────┴─────────────┘
```

#### Tasks (built)

**Purpose**: execution with reminders as a facet of tasks.

```
┌───────────────────────────────────────────────┬─────────────┐
│ Tasks                         [+ New Task]     │  Chat       │
│ Filters: All | Pending | Done                  │  (docked)   │
│ ┌───────────────────────────────────────────┐ │             │
│ │ ☐ Call mom        high   due tomorrow 9am  │ │             │
│ │   ⏰ tomorrow 9am  [Snooze ▾] [Dismiss]     │ │             │
│ ├───────────────────────────────────────────┤ │             │
│ │ ☑ Submit invoice  done                     │ │             │
│ └───────────────────────────────────────────┘ │             │
└───────────────────────────────────────────────┴─────────────┘
```

#### Goals (Phase 3)

**Purpose**: organize by why; show momentum.

```
┌──────────────────────────────────────────────────────────────┐
│ Goals          Life Areas: Health · Career · Family · Finance  │
├───────────────┬───────────────┬───────────────┬──────────────┤
│ HEALTH        │ CAREER        │ FAMILY        │ FINANCE      │
│ ┌───────────┐ │ ┌───────────┐ │               │              │
│ │Lose 100lbs│ │ │Ship v1    │ │               │              │
│ │improving ▲│ │ │stable —   │ │               │              │
│ │why: ...   │ │ │3 tasks    │ │               │              │
│ └───────────┘ │ └───────────┘ │               │              │
└───────────────┴───────────────┴───────────────┴──────────────┘
```

#### Memory (Phase 2)

**Purpose**: transparency — view and correct what Coriven knows.

```
┌───────────────────────────────────────────────┬─────────────┐
│ Memory      [Entities] [Memories]              │  Chat       │
│ ENTITIES                                       │             │
│ ┌───────────────────────────────────────────┐ │             │
│ │ Sarah  (person)   [edit]                   │ │             │
│ │ "your sister, lives in Austin"             │ │             │
│ │ aliases: sis · history: was Denver→Austin  │ │             │
│ └───────────────────────────────────────────┘ │             │
│ MEMORIES (searchable)                          │             │
│   • prefers Coke over Pepsi          [edit]    │             │
└───────────────────────────────────────────────┴─────────────┘
```

#### Approvals (Phase 4)

**Purpose**: single 3-way decision; what + why.

```
┌──────────────────────────────────────────────────────────────┐
│ Approvals (2 pending)                                          │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ SEND EMAIL — to Sarah                                      │ │
│ │ What: decline tomorrow's 2pm meeting                       │ │
│ │ Why: you asked me to reply declining                       │ │
│ │ [Preview draft ▾]                                          │ │
│ │ [Approve]   [Modify]   [Cancel]                            │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

#### Settings (built: Tool Permissions)

```
┌──────────────────────────────────────────────────────────────┐
│ Settings → Tool Permissions                                   │
│  create_task        [ on ]   list_tasks      [ on ]           │
│  add_reminder       [ on ]   delete_task     [ off]           │
│  (memory/goals/comms tools appear as phases ship)             │
└──────────────────────────────────────────────────────────────┘
```

### Responsive Design

| Device | Width | Layout |
|---|---|---|
| Mobile (PWA) | <768px | Single column; chat as full-screen modal; nav collapses; Web Push replaces tray |
| Tablet | 768–1024px | Condensed two-pane |
| Desktop | >1024px | Full two-pane (content + docked chat), resizable (as built) |

### Accessibility Design (WCAG 2.1 AA)

- **Contrast**: AA minimums across the palette (palette TBD but constrained to AA).
- **Keyboard**: full navigation; Enter sends in chat; Escape closes modals; visible focus.
- **Screen readers**: ARIA labels/landmarks; AI responses in an `aria-live="polite"` region.
- **Motion**: respect `prefers-reduced-motion`; animations 200–300ms, functional only.

#### Keyboard Shortcuts

| Shortcut | Action | Context |
|---|---|---|
| Enter | Send message | Chat |
| Ctrl+/ | Focus chat composer | Global |
| Escape | Close modal | Modals |

### Micro-Interactions & Feedback (from Pass 5)

- **Optimistic** for internal actions (complete task, snooze) — instant, reconcile on server.
- **Server-confirmed** for external actions (Approve → "executing…" → "executed").
- **Streaming** "thinking" indicator during chat; toast confirmations for background completions.

### Error Handling UX

- **Assistant unreachable**: inline "Couldn't reach the assistant — Retry."
- **Cap reached** (Free tier): contextual upgrade prompt at entity #10 / reminder #2-of-day.
- **Execution failed** (approval): "Execution failed — Retry / Cancel," logged to audit.
- **Sentinel fallback**: invisible to the user (slightly staler context at worst).

### Performance UX (budgets)

- Page load <3s; chat reply streams immediately; reminder delivery within the ~5-min poll window; skeletons while lists load.

## User Testing Strategy

### Methods

Task-based usability (owner + later beta), accessibility (keyboard + screen reader), and the memory-recall acceptance scenarios from Requirements.

### Test Scenarios

1. **First-run**: sign in → create first task+reminder within 5 minutes.
2. **Recall**: teach a fact, return next session, confirm recall (sister/Coke).
3. **Approval**: draft → review → approve → confirm sent (comms).

### Success Metrics

| Metric | Target | Method |
|---|---|---|
| Task completion (core flows) | >90% | usability sessions |
| Time to First Value | first reminder same day | analytics |
| Recall correctness | works first try | acceptance tests |
| Accessibility | AA pass | audit |

## Quality Gates

### UX Phase Quality Gates

- [x] Personas tie to Requirements roles.
- [x] Journeys map to business requirements and phases.
- [x] IA supports user goals (Pass 2).
- [x] Affordances mapped (Pass 3); states designed (Pass 5).
- [x] Accessibility (AA) specified.
- [x] Error/recovery paths defined.
- [x] Flow guardrails set (Pass 6).
- [ ] Visual design tokens finalized during implementation (frontend-design/taste-design).

### Approval Checklist

- [ ] Owner sign-off. [ ] Accessibility review at build time.

## Document Information

- **Created By**: Roy Love
- **Creation Date**: 2026-06-29
- **Version**: 1.0
- **Document Status**: Draft
- **Next Review Date**: Before Phase 3 UI work

## Appendices

### Appendix B: Wireframes

ASCII wireframes above are directional. High-fidelity mockups deferred to implementation with the design skills.
