---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-11"
lastupdated: "2026-07-11T00:00:00"
version: "1.0"
type: epic
status: Planning
domain: implementation
product:
  - "coriven"
epic: "9"
priority: "High"
branch: "epic/9-experience-redesign"
architecture: ["ADR-016", "ADR-017"]
tags: [coriven, ux, ui, design-system, layout, chat-anchored, overview-board, command-palette, accessibility, design-tokens]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/architecture/_main/01-Product-Vision.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
  - "docs/architecture/_main/05-User-Experience.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Epic 9: Experience Redesign — The Conversational Workspace

## Epic Overview
- **Epic ID:** Epic-9
- **Status:** Planning
- **Duration:** Large (5 features / ~12 waves; phased, each ships independently)
- **Team:** Solo (owner/developer)
- **Priority:** High (fixes daily-use friction now; prerequisite for productization polish)

> **Design source of truth:** `docs/planning/bl-002-ui-ux-overhaul-design.md` (the full design direction, app comparisons, and resolved decisions). This epic is the *implementation plan* for that design — features and wave summaries. Detailed per-wave specs are generated via `/design-waves` when each wave is ready to build. Where this doc and the design doc conflict, the design doc's §8 Decisions win.

## Problem Statement

Coriven's current UI copies the IDE pattern — work central, chat docked on the right — which is correct only when the artifact is the product. For Coriven the **conversation is the product** and the surfaces (tasks, goals, email) are the assistant's workspace made visible. The mismatch produces concrete daily friction: chat *teleports* between a full-width view on `/chat` and a narrow right dock everywhere else; the dock and the Chat tab are literally **two different conversations** (`chat-panel-conversation-id` vs `chat-tab-active-id` in localStorage), so the assistant "forgets" mid-session; nine flat top tabs bury the real hierarchy; there is no visual identity (default Tailwind), no keyboard layer, and no responsive story.

This epic inverts the layout to a **chat-anchored conversational workspace**: chat is permanently anchored on the left and never moves; the right panel's home is a live, assistant-curated **overview board**; navigation shrinks to a four-icon rail plus Settings; approvals become an interrupt rather than a destination; the two conversation stores unify into one server-persisted model; and a design-token system replaces ad-hoc Tailwind. See the design doc for the full rationale and the ChatGPT / Claude / Perplexity / Linear / Superhuman comparison that grounds it.

## Goals and Success Criteria

A returning user opens Coriven and immediately sees their conversation **and** the state of their day, side by side, with zero navigation. Chat never changes position or identity again. Every daily surface is one click away; everything else is one `⌘K` away. The whole app runs on a committed design-token system and passes WCAG 2.1 AA.

**Success Metrics** (from design doc §9):
- Chat never changes position, size-class identity, or conversation when navigating — **zero teleports**.
- One conversation state shared by every entry point (panel, full view, future tray).
- Opening the app shows the day's state (overview board) with **zero interactions**.
- Any working surface reachable in **1 click** (rail); anything else in ≤ 2 (`⌘K` + Enter).
- Pending approvals visible within ~1s of app open (attention card) and actionable inline in chat.
- All working surfaces + board cards have designed empty/loading/error states.
- WCAG 2.1 AA pass on contrast, keyboard, and motion.
- Design tokens in the codebase; **no raw palette values** in components.

## Scope

### In Scope
- **Layout inversion:** icon rail replaces top tabs; persistent left-anchored chat; contextual right workspace panel (`layout.tsx` + `resizable-panels.tsx` rework; routes render into the panel).
- **Conversation unification:** kill the dual-localStorage split; a server-persisted `conversations` table; history flyout; one conversation everywhere.
- **Route consolidation:** `/` = chat + overview board; `/chat` and `/today` redirect; approvals de-railed to an interrupt model (inline chat card + attention card + existing tray); `/activity` audit route.
- **Design system:** CSS custom-property tokens + Tailwind theme (color/type/spacing/radius/motion); extracted `components/ui/` library; empty/loading/error states everywhere; contrast fixes.
- **Overview board:** need-based, assistant-curated cards with inline actions (rebuilds Today).
- **Keyboard layer:** `⌘K` command palette (navigate → act → ask fall-through) + global shortcut map + focus management.
- **Assistant–workspace integration:** tool-card deep links, assistant-opened panels, panel→chat context chips, proactive briefing/nudges/weekly-review delivered *in chat*.
- **Responsive + accessibility:** mobile/tablet/desktop breakpoints; panel↔sheet behavior; WCAG 2.1 AA audit; motion pass.

### Out of Scope
- Light mode — deferred until the token system exists (design doc §8.6); the token pass makes it a follow-up, not a rewrite. Re-decide after Feature 9.2.
- New assistant *capabilities* or tools — this epic is presentation/interaction only; it reuses existing server actions, jobs, and tools.
- The Tauri tray shell (Epic 6 / Epic 8 Feature 8.6) — the redesign's conversation model is tray-compatible by design, but tray parity work is not in this epic.
- Productization/billing surfaces (Epic 8) — independent; this epic can land first.

## Features & Waves

> Wave summaries below; detailed specs finalized per wave in `/design-waves`.

### Feature 9.1: Layout Inversion & Conversation Unification
- **Scope:** Replace the nine-tab top bar with a four-icon rail (Overview, Tasks, Goals, Email) + Settings gear; make chat a permanent left-anchored column; render route children into a contextual right panel; unify the two conversation stores into one server-persisted model; consolidate routes so `/` is chat + board and approvals leave the rail.
- **Key Technical Approach:** Invert `apps/web/src/app/(app)/layout.tsx` and `components/layout/resizable-panels.tsx` — the persistent `ChatPane` moves into the layout on the left; `children` become panel content. Add a `conversations` table (`id`, `user_id`, `title`, `created_at`, `updated_at`, RLS on `user_id`); messages already carry `conversation_id`. Delete the `chat-panel-conversation-id` / `chat-tab-active-id` localStorage split for a single active-conversation store addressable from anywhere. History flyout reads from the table. Approvals surface inline in chat (ADR-013 raw-payload rendering preserved) + attention card; `/activity` keeps an audit URL. `/chat` and `/today` 301-redirect to `/`.
- **Requirements:** Design doc §4.1–4.3, §8.1–8.2; UX Foundations Pass 1 (mental model), Pass 2 (information architecture); Business Requirements (chat as primary surface).
- **Dependencies:** None external — the panel *content* pages already exist. Highest-impact, front-loaded feature; resolves the two stated complaints (tabs, chat moving) and the split brain.
- **Wave Planning:**
  - **Wave 9.1.1 — Rail + persistent chat shell:** icon rail component; layout/resizable-panels inversion; routes render into the panel; existing Today page serves as interim panel home; `Esc`/✕ closes panel to full-width chat.
  - **Wave 9.1.2 — Conversation unification + server history:** `conversations` table + migration + regenerated types; single conversation store; history flyout (titles, timezone-correct times, search); rename/pin/archive-ready schema.
  - **Wave 9.1.3 — Route consolidation + approvals de-rail:** `/` home; `/chat` & `/today` redirects; approvals inline-in-chat card + attention surfacing; `/activity` audit route; remove Approvals/Memory/Constraints from the rail.

### Feature 9.2: Design System & Overview Board
- **Scope:** Establish the visual language as committed tokens, extract a reusable component library, give every surface designed empty/loading/error states, and rebuild Today as the assistant-curated overview board.
- **Key Technical Approach:** CSS custom properties (`--color-canvas`, `--color-assistant`, `--space-*`, `--radius-*`, `--duration-*`) + a Tailwind theme extension; components reference tokens, never raw palette values. Direction: "mission control at midnight" (design doc §5.1) — emerald stays the assistant's color, amber = "needs your judgment," mono-for-user-text kept as a signature token. Extract `components/ui/` (Button, Input/Select/Textarea, Card, Badge/Chip, Toast, Modal/Sheet, EmptyState, Skeleton, PanelHeader) and refactor surfaces onto them. The overview board renders **need-based** cards (Needs-attention / Briefing / Due today / Inbox / Goals-momentum), each a **working summary** (≤5 interactive rows, hard cap — design doc §8.4) with inline actions and assistant-curated ordering.
- **Requirements:** Design doc §4.1a, §5, §8.4; UX Foundations Pass 3 (affordances), Pass 4 (cognitive load), Pass 5 (state design); WCAG 2.1 AA contrast.
- **Dependencies:** Feature 9.1 (the shell + panel exist). Enables every later feature to build on consistent primitives.
- **Wave Planning:**
  - **Wave 9.2.1 — Design tokens + Tailwind theme:** token definitions; color/type/spacing/radius/motion scales; contrast audit + fixes on the muted grays; `motion-safe` conventions codified.
  - **Wave 9.2.2 — Component library extraction:** `components/ui/` primitives; refactor existing surfaces onto them; designed empty/loading/error states across all surfaces (empty states teach the chat-first model).
  - **Wave 9.2.3 — Overview board:** card components + ≤5-row constraint; inline actions (check off, snooze, archive, approve); attention card; assistant-curated ordering; Today rebuilt as the board.

### Feature 9.3: Command Palette & Keyboard Layer
- **Scope:** A Linear-grade `⌘K` palette and a global shortcut map that make navigation depth irrelevant and unlock power-user speed.
- **Key Technical Approach:** Staged palette (design doc §4.5): **v1 navigate** (jump to any surface / conversation / task / goal by name), **v2 act** (thin wrappers over existing server actions — new task, remind, snooze), **v3 ask** (unrecognized input falls through to a chat message). Global map: `⌘K` palette · `⌘/` focus composer · `Esc` close panel · `[` toggle panel · `g t / g g / g e` go-to chords. Central keyboard-shortcut + focus-management layer so the rail, panel, palette, and composer are fully reachable and don't trap focus.
- **Requirements:** Design doc §4.5; UX Foundations Pass 3 (affordances), Pass 4 (decision minimization); WCAG 2.1 AA keyboard.
- **Dependencies:** Feature 9.1 (shell + routes) and Feature 9.2 (Modal/Sheet primitive, tokens). v2 reuses existing server actions; no new backend.
- **Wave Planning:**
  - **Wave 9.3.1 — Palette v1–v2:** command palette UI; surface/conversation/entity search index; act-commands wrapping server actions.
  - **Wave 9.3.2 — Shortcut map + focus + palette v3:** global shortcut registry; focus management for rail/panel/composer; chat fall-through for unrecognized palette input.

### Feature 9.4: Assistant–Workspace Integration
- **Scope:** Make the panel the place the assistant *shows its work* — the differentiator that separates Coriven from an AI chat with plugins.
- **Key Technical Approach:** (design doc §4.4) Tool cards in chat get deep links (`create_task` → "View in Tasks", `generate_weekly_review` → "Open review") via a lightweight client-side `open_surface` UI action emitted from tool results — no new backend. "Show me my tasks" opens the Tasks panel alongside the answer. Panel rows get an "Ask Coriven" affordance that drops a reference chip into the composer. Proactive output (daily briefing, stale-goal nudges, weekly review) is delivered **as chat messages** (compact card form) in addition to the board — briefing posts every morning on schedule, deduped on `(user_id, briefing_date)` so a cron re-run or multi-device open never double-posts (design doc §8.3).
- **Requirements:** Design doc §4.4, §8.3; Epic 7 proactive jobs (briefing, nudges, weekly review — already built); UX Foundations Pass 1, Pass 5.
- **Dependencies:** Feature 9.1 (conversation model + panel), Feature 9.2 (card primitives), Epic 7 (the jobs whose output is delivered). Epic 4 (goals), Epic 5 (email) for the relevant surfaces.
- **Wave Planning:**
  - **Wave 9.4.1 — Tool→panel deep links + assistant-opened panels:** `open_surface` UI action; tool-card affordances; focus/scroll the panel to the right spot.
  - **Wave 9.4.2 — Panel→chat chips + proactive-in-chat delivery:** "Ask Coriven" context chips; briefing/nudge/weekly-review posted as system-authored assistant messages; idempotent dedupe.

### Feature 9.5: Responsive & Accessibility
- **Scope:** Make the app work from phone to wide desktop and clear a formal WCAG 2.1 AA bar — launch-readiness for productization.
- **Key Technical Approach:** (design doc §4.6, §5.3) Breakpoints: **<768px** chat is the app full-screen, rail collapses to a menu button, surfaces open as full-screen slide-overs, bottom-anchored composer; **768–1100px** rail + chat, panel opens as an overlay sheet over chat; **>1100px** full three-zone layout. Accessibility: full keyboard reachability (rail/panel/palette), focus traps in flyouts, visible focus rings on the token system, 4.5:1 contrast verification, `prefers-reduced-motion` coverage on panel transitions. Motion polish pass (120/200/300ms standard durations/easing).
- **Requirements:** Design doc §4.6, §5.3; UX Foundations Pass 5 (feedback), Pass 6 (flow integrity); WCAG 2.1 AA (contrast, keyboard, motion).
- **Dependencies:** Features 9.1–9.4 (there must be a full UI to make responsive and audit). Sequenced last.
- **Wave Planning:**
  - **Wave 9.5.1 — Responsive breakpoints:** mobile chat-first, tablet overlay sheet, desktop three-zone; panel↔sheet behavior; rail collapse.
  - **Wave 9.5.2 — WCAG 2.1 AA audit + motion pass:** keyboard reachability, focus traps, contrast verification, `prefers-reduced-motion` coverage, motion timing tokens; axe-core (or equivalent) sweep.

## Dependencies

**Prerequisites:** Epic 1 (app shell, auth, tasks), Epic 2 (memory), Epic 4 (goals), Epic 5 (email surfaces), Epic 7 (proactive jobs whose output Feature 9.4 delivers into chat). All complete.
**Internal ordering:** 9.1 → 9.2 → (9.3 and 9.4 can proceed largely in parallel once 9.2 lands) → 9.5 last.
**Enables:** A daily-use experience that matches the product's value; a design-token base that makes light mode and Tauri-tray parity follow-ups rather than rewrites; a launch-ready UI for Epic 8 productization.
**External Dependencies:** None (no new services, SDKs, or credentials).

## Risks and Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Conversation-store migration loses in-flight local chats | Med | Low | `conversation_id` already on messages; migrate by deriving initial rows from existing messages; keep localStorage read as a one-time fallback during 9.1.2 |
| Layout inversion regresses existing surfaces | Med | Med | 9.1 keeps the existing pages as panel content unchanged; visual/interaction changes are additive; ship behind the normal PR + QC gate |
| Overview board grows into a cramped dashboard | Med | Med | Hard ≤5-interactive-row cap per card in the component spec (design doc §8.4); full surface always one rail click away |
| Design-token refactor churns every component at once | Med | Med | Tokens land first (9.2.1) as additive CSS vars; component refactor (9.2.2) is incremental, surface by surface; no big-bang rewrite |
| Keyboard/focus layer conflicts with browser/AT shortcuts | Low-Med | Med | Scope chords to app focus; respect native `Tab`/`Esc`; verify with screen readers in 9.5.2 |
| Proactive-in-chat double-posts across devices/cron retries | Med | Low | Idempotent dedupe on `(user_id, briefing_date)`; system-authored message insert is upsert-guarded (Feature 9.4) |
| Scope creep from "while we're in here" redesigns | Med | Med | Epic is presentation/interaction only; new capabilities/tools explicitly out of scope |

## Technical Considerations

This is a presentation-and-interaction epic: it reuses every existing server action, job, tool, and table, adding only one new table (`conversations`) and a token layer. The load-bearing architectural move is the **layout inversion** (conversation as the primary object, panel-based navigation replacing tabbed routing) — nearly a two-file skeleton change (`layout.tsx`, `resizable-panels.tsx`) because the panel content pages already exist. The design-token system is the second highest-leverage item: it is the single source of visual truth and the thing that makes light mode and desktop-tray visual parity cheap later. Approvals move from a route to an interrupt; the only genuine page need (audit/history) keeps a URL. Timezone-correct display (BL-004) is already in place and is reused by the history flyout and board cards.

## Compliance and Security

No new data classes, external calls, or auth surfaces. The `conversations` table follows the project convention (`user_id` + RLS). The inline approval card preserves ADR-013's raw-payload-primary rendering (the user approves what will actually be sent, not a model summary). Accessibility (WCAG 2.1 AA) is treated as a release gate in Feature 9.5, not an afterthought.

## Related Documentation
- **Design direction (source of truth):** `docs/planning/bl-002-ui-ux-overhaul-design.md`
- Product Vision: `docs/architecture/_main/01-Product-Vision.md`
- Business Requirements: `docs/architecture/_main/03-Business-Requirements.md`
- User Experience: `docs/architecture/_main/05-User-Experience.md`
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` (Passes 1–6)
- Backlog item: `docs/planning/backlog.md` — BL-002

## Architecture Decision Records (ADRs)

To be authored during `/design-waves` (next number: **ADR-016**):
- **ADR-016 — Chat-anchored layout inversion.** Conversation as the primary object; persistent left chat + contextual right panel; panel-based navigation replaces tabbed routing; approvals as interrupt, not destination. (Related: Epic 9, Feature 9.1.)
- **ADR-017 — Design-token system.** CSS custom properties + Tailwind theme as the single source of visual truth; no raw palette values in components; the base that makes light mode and tray parity follow-ups. (Related: Epic 9, Feature 9.2.)
- **(Candidate) ADR-018 — Server-persisted unified conversations.** Replace dual-localStorage conversation state with a `conversations` table and one active-conversation model shared by every entry point. (Related: Epic 9, Feature 9.1; may be folded into ADR-016.)

---
**Template Version:** 2.0 (3-layer, embedded features)
