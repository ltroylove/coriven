# BL-002 — UI/UX Overhaul: Design Direction

**Status:** Approved — implementation planned as **Epic 9: Experience Redesign** (`docs/implementation/_main/epic-9-experience-redesign.md`)
**Date:** 2026-07-11
**Area:** Epic 9 (standalone, active) — the design source of truth; the 5 phases below map to Features 9.1–9.5
**Author:** Claude (with Roy)

---

## 0. TL;DR

Coriven is not an AI chat app with addons, and it's not a workspace app with a chat helper — it's a productivity system whose *interface* is conversation and whose *state* (tasks, goals, email, briefings) is real and first-class. The redesign encodes both halves: **chat is permanently anchored on the left and never moves**; the right panel's home state is a live **overview board** — need-based cards (briefing, attention items, email triage, tasks due, goals momentum) that expand into full working surfaces. Navigation shrinks from nine flat tabs to a slim icon rail with **four working surfaces** (Overview, Tasks, Goals, Email) plus Settings. Approvals stop being a destination and become an interrupt (inline in chat + attention card). Memory and Constraints fold into a grouped Settings area. The two-conversation split-brain is unified, a command palette handles fast navigation and actions, and a design-token pass gives the whole thing a deliberate visual identity instead of default Tailwind.

---

## 1. What's wrong today

### 1.1 The layout fights the product

Current structure (`apps/web/src/app/(app)/layout.tsx` + `resizable-panels.tsx`):

```
┌──────────────────────────────────────────────────────────────┐
│ Coriven   Today Chat Email Tasks Goals Approvals Memory ...   │  ← 9 flat tabs
├───────────────────────────────────┬──────────────────────────┤
│                                   │                          │
│   Page content (62%)              │   Docked ChatPane (38%)  │
│                                   │                          │
└───────────────────────────────────┴──────────────────────────┘
```

On `/chat`, the right dock is hidden and a *different* chat renders full-width with its own conversation list. Consequences:

1. **Chat teleports.** It's full-screen center on `/chat`, then jumps to a narrow right dock on every other route. The most important surface in the product has no stable home.
2. **Chat has a split brain.** The docked panel keys its conversation on `localStorage['chat-panel-conversation-id']`; the Chat tab keys on `chat-tab-active-id`. They are *literally different conversations*. Ask the assistant something on `/chat`, click Tasks, and the docked chat has no memory of it. For a product whose pitch is "an assistant that remembers," the UI itself forgets mid-session.
3. **Nine flat tabs bury the hierarchy.** Today, Chat, Email, Tasks, Goals, Approvals, Memory, Constraints, Settings — all peers. But they aren't peers. Chat is the interface; Approvals is a safety gate; Constraints and Memory are the assistant's brain settings; Settings is plumbing. Flat IA tells the user "figure out the map yourself."
4. **No visual identity.** Default Tailwind grays, no type scale, no spacing system, no motion language. Functional, but generic — and BL-002's premise is that first impressions drive trial conversion.
5. **No keyboard layer.** Every action is mouse-first. For a daily-driver productivity tool, that caps power-user speed.

### 1.2 The root cause

The layout was designed as "a workspace app with a chat helper docked on the side" — the Cursor/Copilot pattern. That pattern is correct for IDEs because *the artifact (code) is the product* and chat is an accessory. Coriven is the opposite: **the conversation is the product** and the pages are evidence of what the conversation accomplished. The layout should encode that.

---

## 2. How the best current apps solve this

| App | Layout model | What it teaches us |
|---|---|---|
| **ChatGPT** | Chat permanently center. Left sidebar = conversation history. Canvas/artifacts open as a right split; chat compresses but never relocates. | The chat column is sacred. Secondary content *joins* the chat; it never displaces it. |
| **Claude.ai** | Same skeleton: left conversation sidebar, chat center, artifacts panel slides in right, resizable. | The side-panel pattern scales from code to documents to dashboards. One panel slot, many content types. |
| **Perplexity** | Query-first center column, slim left icon rail (Home, Discover, Spaces), sources/context on the right. | A ~56px icon rail carries an entire product's navigation without stealing horizontal space from the main column. |
| **Linear** | Left sidebar nav, but the real interface is Cmd+K + keyboard shortcuts. Dense, fast, opinionated visual system. | Speed *is* the brand. A command palette makes nav depth irrelevant. Design tokens make density feel calm, not cramped. |
| **Superhuman** | One thing on screen at a time, keyboard-driven triage (archive/snooze/reply without touching the mouse). | Triage flows (email, approvals) want single-focus + keyboard verbs, not dashboards. |
| **Cursor / VS Code Copilot** | Work central, chat docked right. | The pattern Coriven currently copies — and the counter-example. Correct only when the artifact is the product. |
| **Notion AI** | Assistant summoned *inside* documents. | The inverse relationship. Not our model, but instructive: they made the assistant come to the work; we make the work come to the assistant. |
| **Raycast** | Launcher: summon, type, act, dismiss. | The ethos for the future Tauri tray (blueprint §13): Coriven should be *summonable* from anywhere on the desktop. |

**The decision rule that falls out:** *Is the primary object the conversation or the artifact?* For Coriven, the user's mental model is "I tell Coriven things and Coriven handles them." Primary object = conversation → chat-anchored layout, Perplexity-style rail, Linear keyboard layer.

**Where we deliberately diverge from the AI-chat pattern:** in ChatGPT/Claude, the side panel shows *outputs of the conversation* (artifacts) and is empty until you produce one. Coriven's panel shows *the live state of your life* — tasks, inbox, goals exist whether or not you chatted today. So our panel is **open by default** with a curated status board (§4.1a), not a blank slot waiting for an artifact. Coriven is a productivity system whose interface is conversation, not a chatbot with plugins.

---

## 3. What Coriven is (design anchor)

Coriven is a **chief of staff, not a filing cabinet — and not just a chatbot**. The user's job is to talk; the assistant's job is to act (through tools), remember (memory + Sentinel), protect (constraints, approvals), and anticipate (briefings, patterns, nudges). But the state Coriven manages — your tasks, your inbox, your goals — is real, lives independently of any conversation, and deserves to be visible without asking. Therefore:

- The **conversation** is the command line and the audit log of the relationship. It anchors left and never moves.
- The **working surfaces** (Today, Tasks, Goals, Email) are first-class: glanceable at rest (overview board), one click to work in fully. This is what separates Coriven from an AI chat with plugins — you see your day the moment you open the app, before you type anything.
- The **trust and config surfaces** (Memory, Constraints, Settings) are visited rarely; they need findability, not prominence.
- **Proactive output** (daily briefing, nudges, weekly review) arrives *in the conversation* — that's where you already are — with the board as the glanceable, at-rest form.

Design principle, one line: **"Talk on the left, see your day on the right."**

The navigation rule that falls out: **frequency earns navigation.** Daily surfaces get rail icons; interrupt surfaces (approvals) come to you; rare surfaces (memory, constraints, settings) group behind one icon.

---

## 4. The proposed layout

### 4.1 Desktop skeleton

```
┌────┬─────────────────────────────────────┬──────────────────────────┐
│    │                                     │  WORKSPACE PANEL         │
│ ◈  │                                     │  home = OVERVIEW BOARD   │
│ ➕ │           CHAT                      │ ┌──────────────────────┐ │
│ 🕘 │   (anchored left — never moves,     │ │ ⚠ Needs attention    │ │
│    │    never changes identity)          │ │   2 approvals pending│ │
│────│                                     │ ├──────────────────────┤ │
│ ☀  │                                     │ │ ☀ Briefing           │ │
│ ✓  │                                     │ │   3 goals in motion… │ │
│ ◎  │                                     │ ├──────────────────────┤ │
│ ✉  │                                     │ │ ✓ Due today (4)      │ │
│    │                                     │ │   ☐ Renew passport   │ │
│    │                                     │ ├──────────────────────┤ │
│    │                                     │ │ ✉ Inbox — 2 replies  │ │
│    │                                     │ ├──────────────────────┤ │
│────│  ┌───────────────────────────────┐  │ │ ◎ Goals momentum     │ │
│ ⚙  │  │  composer                     │  │ └──────────────────────┘ │
│    │  └───────────────────────────────┘  │  rail icon → full surface│
└────┴─────────────────────────────────────┴──────────────────────────┘
 rail            chat column                     workspace panel
(56px)        (flex, min 480px)               (25–60%, resizable,
                                               open by default)
```

Three zones:

1. **Icon rail (left, ~56px, fixed).** Top: Coriven mark, New chat, History (opens conversation flyout). Middle — **four working surfaces only**: *Overview (Today)* · *Tasks* · *Goals* · *Email*. Bottom: Settings (gear). Tooltips on hover; active surface gets an accent indicator. Replaces the top tab bar entirely — the top bar disappears, reclaiming vertical space. Note what's *not* here: no Approvals icon (it's an interrupt — see §4.1b) and no Memory/Constraints icons (they group under Settings — see §6). **Frequency earns navigation.**
2. **Chat column (left-anchored, permanent).** One chat, one conversation system, everywhere. It never jumps, reflows its history, or swaps conversations. If the user closes the panel, chat takes the full width with a readable max-width (~52rem).
3. **Workspace panel (right, open by default).** Its home state is the **overview board** (§4.1a). Clicking a rail icon fills the panel with that full surface — one click, no intermediate step. Resizable (drag handle, 25–60%), closable (`Esc` or ✕). One panel slot; switching surfaces swaps content in place. **Opening the app shows chat + your day simultaneously** — that's the product statement: Coriven is not a chatbot you must interrogate; it already knows the state of your life when you arrive.

### 4.1a The overview board (panel home)

The board is what the old "Today" page wanted to be — but its cards are **need-based, not icon-mapped**, and the assistant curates them:

- **Needs attention** (amber) — appears *only* when something is pending: approvals to review, failed executions to retry, a gated action waiting. Always sorts to the top. Disappears when empty — no dead placeholder.
- **Briefing** — prominent until read, then compacts to a one-line summary. Regenerates each morning.
- **Due today / overdue** — top 3–5 tasks with inline check-off and snooze; working rows, not links.
- **Inbox** — needs-reply count + top 2–3 triage items; archive inline.
- **Goals momentum** — compact momentum strip; stalled goals get a nudge row.

Card rules:

- Every card is a **working summary**, not a link tile: 2–3 actionable rows (complete a task, archive an email, approve an action *on the card*).
- Card header → opens the full surface in the panel.
- Ordering is **assistant-curated** (attention > briefing > due > inbox > goals by default, re-weighted by time of day and pending state); irrelevant cards compact or drop. This is the chief-of-staff move no generic AI chat makes: the right side of the screen is *the assistant's status board for you*, not a menu.

### 4.1b Approvals: an interrupt, not a destination

An approvals page is empty dead weight most of the time; a queue that's usually empty shouldn't own permanent navigation. Approvals surface three ways:

1. **Inline in chat** — when an action gets gated mid-conversation, the approval card renders in the conversation (raw payload primary, per ADR-013) and you approve where you asked.
2. **Attention card** on the overview board whenever anything is pending — amber, top position, impossible to miss.
3. **Tray notification** (already built, Epic 6).

The only genuine "page" need is **history/audit** (past actions, failures, retry) — reachable from the attention card's footer and the command palette, not the rail.

### 4.2 Routing model (keeps deep links, minimal rework)

This maps cleanly onto the existing Next.js structure by *inverting the current layout arrangement*:

- `(app)/layout.tsx` renders: rail + **persistent ChatPane** + panel container.
- The route child (`children`) becomes the **panel content** instead of the main column.
- `/` = chat + overview board (the default state). `/tasks`, `/goals/[id]`, `/email`… = that surface open in the panel. Approvals history keeps a URL (`/activity` or similar) for audit deep-links even without a rail icon.
- URLs stay shareable and the browser back button switches panel content naturally.

This is nearly a two-file inversion (`layout.tsx`, `resizable-panels.tsx`) for the skeleton — the panel *content* pages already exist.

### 4.3 One conversation system (kill the split brain)

- Delete the `chat-panel-conversation-id` / `chat-tab-active-id` split. One active conversation, one store, addressable from anywhere.
- Conversation history moves to a **flyout from the rail's History icon** (ChatGPT-sidebar style, but summoned rather than permanent — horizontal space stays with chat and panel).
- Conversations are persisted and listed **server-side** via a new `conversations` table (§8.2) — messages already carry `conversation_id`; the list UI currently only knows localStorage. The flyout lists real history with titles, relative times in the user's timezone, and search.

### 4.4 Chat ↔ panel integration (the payoff)

The panel isn't just navigation — it's how the assistant *shows its work*:

- **Tool → panel affordance.** When a tool call touches a surface, the tool card in chat gets a deep link: `create_task` → "View in Tasks"; `generate_weekly_review` → "Open review". Clicking opens/focuses the panel at the right spot.
- **Assistant-opened panels.** "Show me my tasks" → the assistant answers *and* opens the Tasks panel. A lightweight `open_surface` UI action (client-side event emitted from tool results) — no new backend.
- **Panel → chat context.** Rows in panels get an "Ask Coriven" affordance that drops a reference chip into the composer ("about *Renew passport*: …"). The panel feeds the conversation, not just vice versa.
- **Briefing lands in chat.** The morning briefing arrives as a proactive assistant message in the conversation (compact card form) — the Today panel remains the glanceable full dashboard. Same for stale-goal nudges and the weekly review. Rule: *if Coriven has something to say, it says it where you talk.*

### 4.5 Command palette (⌘K / Ctrl+K)

Linear-grade palette, staged:

- **v1 — navigate:** jump to any surface, any conversation, any task/goal by name.
- **v2 — act:** "new task…", "remind me…", "snooze…" — thin wrappers over existing server actions.
- **v3 — ask:** fall through to chat — anything unrecognized becomes a chat message.

Plus a small fixed shortcut map: `⌘K` palette · `⌘/` focus composer · `Esc` close panel · `[` toggle panel · `g t / g g / g e` go-to surfaces (Linear-style chords).

### 4.6 Mobile / responsive

Current app is desktop-only in practice. Target model:

- **< 768px:** chat is the app, full screen. Rail collapses to a top-left menu button + bottom-anchored composer. Surfaces open as full-screen slide-overs (panel → page). Bottom sheet for quick actions.
- **768–1100px:** rail + chat; panel opens as an overlay sheet over chat rather than a side-by-side split.
- **> 1100px:** full three-zone layout.

The future Tauri tray (blueprint §13) is the fourth breakpoint in spirit: summon-chat-anywhere (Raycast ethos), sharing the same conversation system.

---

## 5. Visual identity & design system

The current dark theme has good instincts (calm, low-chrome, emerald accent). Formalize it instead of replacing it.

### 5.1 Direction — "mission control at midnight"

Quiet, dark, precise. The assistant is a presence, not a mascot. Color signals *meaning*, never decoration:

| Token role | Today (ad hoc) | Proposed |
|---|---|---|
| Canvas | `gray-950` | Near-black with a slight warm tint; one shade, everywhere |
| Surface / raised | `gray-900` / `gray-800` borders | 2-step elevation scale (surface, raised) + 1 border tone |
| Assistant accent | emerald (already used for the assistant's presence dot, cursor) | **Emerald stays the assistant's color** — its dot, its thinking cursor, its confirmations |
| Attention / gated | amber (approvals, tool cards) | Amber = "needs your judgment" (approvals, fallbacks, warnings) |
| Danger | red | Destructive + errors only |
| Text | gray-200/400/500/600 mix | 3-step scale: primary, secondary, muted |

### 5.2 Mechanics

- **Design tokens as CSS custom properties** + Tailwind theme extension (`--color-canvas`, `--color-assistant`, `--space-*`, `--radius-*`, `--duration-*`). Components reference tokens, never raw palette values. This is the single highest-leverage item for consistency and future theming (light mode, tray app parity).
- **Type scale:** keep the current sans (or adopt Geist); define 5 sizes with fixed line-heights. Keep the **mono-for-user-messages** quirk — it's a distinctive signature ("you type commands, Coriven speaks prose") — but make it a deliberate token, not an accident.
- **Spacing/radius/motion scales:** 4px spacing grid; 2 radii (interactive, container); motion durations 120/200/300ms with a standard ease; all animation behind `motion-safe:` (already the codebase's habit — keep it).
- **Component inventory (audit + consolidate):** Button (3 variants), Input/Select/Textarea, Card, Badge/Chip, Toast, Modal/Sheet, EmptyState, Skeleton, ToolCallCard, PanelHeader. Most exist informally; the pass extracts them into `components/ui/`.
- **States everywhere:** every surface gets designed empty (first-run with a nudge toward chat: "Ask Coriven to create your first task"), loading (skeletons, not spinners), and error (retry affordance) states. Empty states should *teach the chat-first model* — that's the onboarding.

### 5.3 Accessibility (WCAG 2.1 AA)

Carry forward the existing good habits (aria-live chat region, `motion-safe`, labeled tool cards) and close the gaps: full keyboard reachability for the rail/panel/palette, focus traps in flyouts, visible focus rings on the token system, 4.5:1 contrast verification on the muted grays (several current `text-gray-600`-on-`gray-950` pairings will fail — the token pass fixes them), and `prefers-reduced-motion` coverage for panel transitions.

---

## 6. Surface-by-surface notes (within the new frame)

- **Today / Overview** → *becomes the overview board* (§4.1a) — the panel's home state. Its content also arrives in chat each morning (§4.4). The standalone Today page retires; the board absorbs it.
- **Tasks** → stays list-first; add keyboard triage (`e` complete, `s` snooze, `enter` ask-about — Superhuman verbs). Timezone-correct times already done (BL-004).
- **Goals** → panel; goal detail replaces panel content (breadcrumb back), not a new page context.
- **Email** → triage view designed keyboard-first; pairs naturally with chat ("draft a reply" → approval flow).
- **Approvals** → no rail icon; interrupt model per §4.1b (inline chat card + attention card + tray). Amber identity everywhere it appears. History/audit reachable from the attention card and ⌘K.
- **Memory & Constraints** → no rail icons; they become sections inside a restructured **Settings** area (left sub-nav: *Assistant* — sentinel mode, briefing · *Mind* — Memory, Constraints · *Connections* — integrations · *Account*). They're trust surfaces: they need findability, not prominence — clear naming and ⌘K entries ("memory", "rules") cover discovery. Visual tone stays transparent, inspectable, calm.
- **Settings** → single gear at rail bottom; absorbs Memory and Constraints as above.

---

## 7. Phased plan

| Phase | Scope | Impact / effort |
|---|---|---|
| **1. The inversion** | Rail replaces top tabs (4 icons + gear); chat becomes the persistent left column (layout.tsx + resizable-panels.tsx inversion); routes render into the panel; existing Today page serves as interim panel home; unify the two conversation stores into one; server-backed conversation list + history flyout; Memory/Constraints fold into Settings | Highest impact. Fixes the stated complaints (tabs, chat moving) and the split brain. Modest code — the pages already exist. |
| **2. Tokens, components & the board** | CSS custom properties + Tailwind theme; extract `components/ui/`; type/spacing/motion scales; empty/loading/error states on all surfaces; contrast fixes; **rebuild Today as the overview board** (need-based cards, inline actions, attention card) | Makes everything after cheaper and consistent; the board is the visible payoff. |
| **3. Keyboard layer** | ⌘K palette (navigate → act); shortcut map; panel/composer focus management | Power-user speed; Linear ethos. |
| **4. Chat ↔ panel integration** | Tool-card deep links; assistant-opened panels; "Ask Coriven" context chips; briefing/nudges/review delivered in-chat | The differentiator — the assistant visibly *works* in its workspace. |
| **5. Responsive & polish** | Mobile/tablet breakpoints; panel↔sheet behavior; motion pass; WCAG audit | Launch-readiness for productization. |

Each phase ships independently behind normal PR flow; Phase 1 is deliberately front-loaded because it resolves the core UX complaints without waiting on the design system.

---

## 8. Decisions & remaining questions

**Resolved (2026-07-11):**

1. **Home route → single `/`.** `/` renders chat + overview board. `/chat` and `/today` 301-redirect to `/`. One canonical home; reinforces "zero teleports." Deep links to specific surfaces (`/tasks`, `/goals/[id]`, `/email`, `/activity`) still open that surface in the panel.
2. **Conversation persistence → new `conversations` table.** Columns: `id`, `user_id`, `title`, `created_at`, `updated_at` (RLS on `user_id` per project convention). Titled from the first user message; rows created on conversation start. Unlocks rename / pin / archive later without a second migration. The history flyout and ⌘K conversation search both read from it. (Migration + write on create/rename; messages already carry `conversation_id`.)
3. **Briefing cadence → every morning, automatically.** The daily briefing posts into the chat conversation each morning on schedule (compact card form), independent of whether the app is open — consistent presence over unread-pile avoidance. The overview board's briefing card is the same content at rest. *Implementation note:* post as a system-authored assistant message tied to the briefing's generation cron (Vercel Cron, per-user UTC-equivalent time — same scheduling already used for briefings); dedupe on `(user_id, briefing_date)` so a re-run or multi-device open never double-posts.

**Design guardrails (adopted, not open):**

4. **Board scope-creep guard.** Cards stay summaries: max ~5 rows of interactive UI per card. A card that wants more has outgrown the board — the full surface is one rail click away. This goes in the card component spec as a hard constraint, not a guideline.
5. **Mono user text — keep.** The mono-for-user / prose-for-assistant split is a deliberate signature ("you type commands, Coriven speaks prose"). Kept as a design token; revisit only with real user feedback during productization.

**Still open:**

6. **Light mode.** Out of scope until tokens exist; the token pass (Phase 2) makes it a follow-up rather than a rewrite. Decide during/after Phase 2 whether it's a launch requirement.

---

## 9. Success criteria

- Chat never changes position, size-class identity, or conversation when navigating. **Zero teleports.**
- One conversation state shared by every entry point (panel, full view, future tray).
- Opening the app shows the day's state (overview board) with **zero interactions** — no navigation required to know where you stand.
- Any working surface reachable in **1 click** (rail); anything else in ≤ 2 (⌘K + enter).
- Pending approvals visible within 1 second of app open (attention card) and actionable inline in chat.
- All working surfaces + board cards have designed empty/loading/error states.
- WCAG 2.1 AA pass on contrast, keyboard, and motion.
- Design tokens in the codebase; no raw palette values in components.
