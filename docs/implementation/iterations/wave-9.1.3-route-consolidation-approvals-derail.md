---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-11"
lastupdated: "2026-07-11T00:00:00"
version: "1.0"
type: wave
status: Completed
domain: implementation
product:
  - coriven
epic: "9"
feature: "9.1"
wave: "9.1.3"
agents: [backend-specialist, frontend-specialist]
tags: [coriven, routes, redirects, approvals, inline-approval, activity, settings, adr-013, epic-9]
relateddocuments:
  - "docs/planning/bl-002-ui-ux-overhaul-design.md"
  - "docs/planning/epic-9-shared-contracts.md"
  - "docs/implementation/_main/epic-9-experience-redesign.md"
  - "docs/architecture/_main/05a-UX-Foundations.md"
---

# Wave 9.1.3: Route Consolidation + Approvals De-rail

## Wave Overview

| Field | Value |
|---|---|
| Wave ID | 9.1.3 |
| Feature | 9.1 — Layout Inversion & Conversation Unification |
| Epic | 9 — Experience Redesign |
| Status | Planning |
| Scope | Establish the canonical route map (contract **C5**): `/` = chat + panel home for signed-in users, `/chat` and `/today` permanently redirect; approvals become an interrupt — inline approval card in chat (contract **C7**, ADR-013 preserved) with a `/activity` audit route replacing `/approvals`; Memory and Constraints fold into Settings sections; legacy route code deleted |

**Wave Philosophy:** Scope-based — complete when the URL space matches contract C5 exactly, a gated action is approvable inline in the conversation without leaving chat, audit history lives at `/activity`, Memory/Constraints are reachable only under Settings, and no legacy route/interim mapping survives.

**Wave Goal:** One canonical home and an interrupt-model for approvals (design doc §4.1b, §8.1): you approve where you asked, and navigation reflects frequency, not system architecture.

## Wave Goals

1. **Contract C5 built.** `/` is the canonical home (chat + panel home) for authenticated users; `/chat` → `/` and `/today` → `/` permanent redirects; `/tasks`, `/goals`, `/goals/[id]`, `/email`, `/settings`, `/activity` deep-link into the panel; Memory/Constraints have no top-level routes; approvals have no route except `/activity`.
2. **Contract C7 (inline approval card) built.** When `submit_for_approval` gates an action mid-conversation, an approval card renders inline in chat — raw payload primary per ADR-013, reusing the existing approval logic (approve / modify / cancel via existing server actions), not a re-summary.
3. **Audit keeps a URL.** `/activity` presents the approval audit/history (and any still-pending items as a fallback surface); `/approvals` redirects to it; the C2 registry's `activity` surface becomes real.
4. **Settings absorbs the trust surfaces.** Memory and Constraints render as sections of a restructured Settings area (design doc §6) with old URLs redirecting — findability without prominence.
5. **Interim scaffolding removed.** The 9.1.1 interim mappings (`/chat` → panel-closed, `/approvals`/`/memory`/`/constraints` → surface aliases) and the dead `/chat` route code are deleted; the registry and route map now agree with C5 verbatim.

## User Stories

### Story 9.1.3.1 — `/` is the single canonical home: chat + my day, zero navigation

**As a** returning Coriven user,
**I want** opening the app at `/` to show my conversation and my day side by side,
**So that** there is exactly one home, nothing teleports, and old bookmarks (`/chat`, `/today`) still land me there (design doc §8.1; epic success metric "zero interactions to see the day's state").

*Implements contract **C5** (route map) — owner: this wave; consumers: 9.1.1 (registry), 9.3.1 (palette navigation).*
*UX Foundations Pass 1 (mental model: one place to talk) and Pass 2 (IA: primary surfaces always reachable).*

**Acceptance Criteria:**
- [ ] A signed-in user at `/` gets the full app shell — persistent chat left, panel open to the overview home (interim content = the existing Today page's composition until Wave 9.2.3 delivers the board); the signed-out landing page at `/` is unchanged.
- [ ] `/chat` and `/today` issue permanent redirects to `/` (per C5); no in-app link, rail item, or code path references them afterward.
- [ ] The signed-in redirect target changes from `/tasks` to nothing — `/` renders home directly; post-signin lands on `/`.
- [ ] The rail's Overview item and the registry's `overview` surface point at `/` (panel home) and show active state there.
- [ ] Browser back/forward across `/` ↔ `/tasks` ↔ `/goals` etc. switches panel content with chat untouched (regression guard on 9.1.1 behavior under the new home).

**Priority:** Critical
**Estimated hours:** 6h

#### Task 9.1.3.1.1 — Authenticated home at `/` via AppShell
- **Parent Story:** 9.1.3.1
- **Agent:** frontend-specialist
- **Estimation:** 4h
- **Dependencies:** None (9.1.1's `AppShell` + `PanelProvider` are reusable by design)
- **Deliverables:**
  - `apps/web/src/app/page.tsx` reworked: signed-out → existing landing (unchanged); signed-in → render the app shell with the overview panel home (reusing `AppShell`/providers — Next.js allows only one page at `/`, so the root page branches on auth instead of redirecting to `/tasks`).
  - Overview home content module (interim: today's page composition moved to a shared component consumable by `/`) under `apps/web/src/components/overview/`.
- **Acceptance Criteria:**
  - [ ] No duplicated shell logic — the root page composes the same `AppShell` the `(app)` layout uses; timezone/auth fetch consistent.
  - [ ] Signed-out `/` snapshot unchanged (landing regression test).

#### Task 9.1.3.1.2 — Permanent redirects `/chat` → `/`, `/today` → `/` and route deletion
- **Parent Story:** 9.1.3.1
- **Agent:** frontend-specialist
- **Estimation:** 2h
- **Dependencies:** Task 9.1.3.1.1
- **Deliverables:**
  - Permanent redirects (Next.js `redirects()` in `next.config.ts` or equivalent) for `/chat` and `/today`; deletion of `apps/web/src/app/(app)/chat/` (page, layout, `chat-client.tsx`) and `apps/web/src/app/(app)/today/`; deletion of `apps/web/src/components/chat/conversation-list.tsx` (superseded by the 9.1.2 history flyout).
- **Acceptance Criteria:**
  - [ ] `curl -I` on `/chat` and `/today` shows a permanent redirect to `/`; typecheck/build clean after deletions.

---

### Story 9.1.3.2 — Gated actions are approvable inline in the conversation

**As a** Coriven user whose request just got gated (e.g. "send that email"),
**I want** the approval card to appear right there in the conversation, showing exactly what will be sent,
**So that** I approve where I asked — no context switch to a queue page — while still deciding on the raw payload, never a model summary (design doc §4.1b #1; ADR-013).

*Implements contract **C7** (inline approval card) — owner: this wave (inline card half; proactive half is 9.4.2). Consumes C1 (renders in the conversation) and, later, C4 tokens.*
*UX Foundations Pass 3 (Approve primary / Modify inline / Cancel destructive — three distinct buttons; AI-touched content labeled).*

**Acceptance Criteria:**
- [ ] When a `submit_for_approval` tool result arrives in the chat stream, an inline approval card renders in the conversation at that point — raw action payload as the primary decision surface (preformatted literal text, no markdown/link rendering), AI summary visibly secondary and labeled, amber "needs your judgment" identity.
- [ ] Approve / Modify (inline JSON payload editing with parse validation) / Cancel work from the card via the **existing** server actions (`approveAction`, `approveWithModifiedPayload`, `cancelAction`) — no new approval logic, no re-summary (C7: reuse existing approval-card logic).
- [ ] After acting, the card reflects the resolved state (approved/executing/canceled) in place; errors from the action surface on the card with retry affordance.
- [ ] When a conversation containing a gated action is **reloaded** (history), the inline card shows the approval's *current* status fetched fresh — an already-approved item renders as a compact resolved state, not a live approve button.
- [ ] The tool-result text no longer tells the user to "Visit /approvals" — messaging matches the interrupt model.

**Priority:** Critical
**Estimated hours:** 8h

#### Task 9.1.3.2.1 — `getApproval(id)` server action + tool-result message update
- **Parent Story:** 9.1.3.2
- **Agent:** backend-specialist
- **Estimation:** 3h
- **Dependencies:** None
- **Deliverables:**
  - `getApproval(id)` in `apps/web/src/app/actions/approvals.ts` (auth-scoped read of one `approval_queue` row: `id`, `action_type`, `provider`, `payload`, `ai_summary`, `status`, `created_at`) for the inline card's fresh-status render.
  - Bounded copy change in the `submit_for_approval` handler result message (`apps/web/src/lib/chat/tools/handlers.ts`) — remove the `/approvals` reference; keep `approval_id` + `status` in the result content (the card's data key). No schema or behavioral change to the tool.
- **Acceptance Criteria:**
  - [ ] `getApproval` returns null/error for another user's row (RLS verified in test); handler tests updated for the new message copy.

#### Task 9.1.3.2.2 — InlineApprovalCard component + chat message rendering
- **Parent Story:** 9.1.3.2
- **Agent:** frontend-specialist
- **Estimation:** 5h
- **Dependencies:** Task 9.1.3.2.1, Task 9.1.3.3.1 (shared approval components extracted first)
- **Deliverables:**
  - `apps/web/src/components/approvals/inline-approval-card.tsx` — composes the extracted approval-card logic (raw-payload-primary rendering, approve/modify/cancel, ADR-013 comment block carried over) in a chat-width compact form; fetches current status via `getApproval` on mount for history renders.
  - `apps/web/src/components/chat/message.tsx` — render `tool_result` blocks whose tool is `submit_for_approval` as `InlineApprovalCard` (parsing `approval_id` from the result content); all other tool rendering unchanged.
- **Acceptance Criteria:**
  - [ ] Component tests: pending → actions visible; resolved → compact status; malformed result content → safe fallback to plain tool-result rendering; payload edit parse-error blocks approve-with-changes.

---

### Story 9.1.3.3 — Approval audit history lives at `/activity`; the approvals page retires

**As a** Coriven user,
**I want** past actions (approved, executed, failed, canceled — with retry) on one audit page that isn't in my daily navigation,
**So that** the usually-empty queue stops owning a rail slot while the genuine page need — history/audit — keeps a deep-linkable URL (design doc §4.1b).

*Implements the C5 `/activity` route and realizes the C2 registry's `activity` surface (no rail icon; URL/command reachable).*
*UX Foundations Pass 2 (Hidden tier: audit history is deep/admin, not primary).*

**Acceptance Criteria:**
- [ ] `/activity` renders in the workspace panel: audit history (the existing history rows: status, action type, provider, timestamps, failure reasons, retry affordance) plus any still-pending items (fallback visibility — primary pending surfaces are the inline card and, from 9.2.3, the attention card).
- [ ] `/approvals` permanently redirects to `/activity`; the approvals page directory is deleted.
- [ ] `/activity` has no rail icon (per C3/C5) but is reachable by URL and registered as the `activity` surface (active state, panel header, `focusId` delivery all work like any surface).
- [ ] `retryAction` works from `/activity` exactly as it did on the old page.

**Priority:** High
**Estimated hours:** 5h

#### Task 9.1.3.3.1 — Extract shared approval components
- **Parent Story:** 9.1.3.3
- **Agent:** frontend-specialist
- **Estimation:** 2h
- **Dependencies:** None
- **Deliverables:**
  - Move `approval-card.tsx` and `history-row.tsx` from `apps/web/src/app/(app)/approvals/` to `apps/web/src/components/approvals/` (shared by `/activity` and the inline card; later consumed by 9.2.3's attention card), preserving the ADR-013 rendering rules verbatim.
- **Acceptance Criteria:**
  - [ ] Pure move + import updates; no behavioral diff (existing tests still pass).

#### Task 9.1.3.3.2 — Build `/activity` route and retire `/approvals`
- **Parent Story:** 9.1.3.3
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Task 9.1.3.3.1
- **Deliverables:**
  - `apps/web/src/app/(app)/activity/page.tsx` (server component; same `approval_queue` query, audit-first presentation); permanent redirect `/approvals` → `/activity`; deletion of `apps/web/src/app/(app)/approvals/`.
- **Acceptance Criteria:**
  - [ ] Deep link `/activity` opens the surface in the panel; redirect verified; no remaining `/approvals` references in code or registry.

---

### Story 9.1.3.4 — Memory and Constraints become Settings sections

**As a** Coriven user,
**I want** the assistant's trust surfaces (what it remembers, what rules bind it) grouped under Settings,
**So that** rare-but-important surfaces stay findable without occupying primary navigation — frequency earns navigation (design doc §6).

*Conforms to C5 ("Memory & Constraints: no top-level routes; become sections under `/settings`").*
*UX Foundations Pass 2 ("What it knows" group: Memory + Constraints; Secondary tier) and Pass 1 (memory is visible and correctable).*

**Acceptance Criteria:**
- [ ] Settings presents grouped sections per design §6 — *Assistant* (sentinel mode, briefing settings — existing), *Mind* (Memory, Constraints), *Connections* (integrations — existing), *Account* — via a settings-local sub-navigation; existing settings functionality (tool permissions, briefing, integrations) is preserved.
- [ ] Memory and Constraints pages render, fully functional (entity/memory edit + delete; constraint add/remove/lock), as Settings sub-routes (`/settings/memory`, `/settings/constraints`) reusing the existing client components unchanged.
- [ ] `/memory` → `/settings/memory` and `/constraints` → `/settings/constraints` permanent redirects; old top-level directories deleted.
- [ ] All Settings sub-routes highlight the rail's Settings gear (registry `matchPrefixes` covers `/settings/*`); deep links open the panel at the right section.
- [ ] Visual tone of the trust surfaces stays transparent and calm (no redesign in this wave — that's 9.2.x; this is relocation only).

**Priority:** High
**Estimated hours:** 5h

#### Task 9.1.3.4.1 — Restructure Settings with sub-navigation and sub-routes
- **Parent Story:** 9.1.3.4
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** None
- **Deliverables:**
  - `apps/web/src/app/(app)/settings/layout.tsx` (settings sub-nav: Assistant / Mind / Connections / Account grouping) and sub-routes `settings/memory/page.tsx`, `settings/constraints/page.tsx` hosting the existing `memory-page-client.tsx` / `constraints-page-client.tsx` (moved, not modified).
- **Acceptance Criteria:**
  - [ ] Every pre-existing memory/constraints interaction works identically at the new URLs.

#### Task 9.1.3.4.2 — Redirect and delete old top-level trust routes
- **Parent Story:** 9.1.3.4
- **Agent:** frontend-specialist
- **Estimation:** 2h
- **Dependencies:** Task 9.1.3.4.1
- **Deliverables:**
  - Permanent redirects `/memory` and `/constraints` → their Settings sub-routes; deletion of `apps/web/src/app/(app)/memory/` and `apps/web/src/app/(app)/constraints/` route directories.
- **Acceptance Criteria:**
  - [ ] Redirects verified; build/typecheck clean; no dangling imports.

---

### Story 9.1.3.5 — The route map and registry conform to C5 with no interim scaffolding

**As an** Epic 9 wave builder (9.3.1 palette, 9.4.1 bridge, 9.5.1 responsive),
**I want** the shipped URL space and surface registry to match contract C5 exactly, with all 9.1.1 interim mappings removed,
**So that** downstream waves can generate navigation (⌘K, go-to chords, deep links) from the registry without special cases.

**Acceptance Criteria:**
- [ ] The live route map is exactly C5: `/` home; `/chat`+`/today` redirect; `/tasks`, `/goals`, `/goals/[id]`, `/email`, `/settings` (+ sub-routes), `/activity` open their surfaces; `/approvals`, `/memory`, `/constraints` redirect; nothing else at top level (existing `/projects/[id]` remains mapped to the `goals` surface as a deep-link alias).
- [ ] The 9.1.1 interim registry mappings (`/chat` → panel-closed special case, `/approvals` → `activity` alias, `/memory`/`/constraints` → `settings` alias) are deleted; `surfaceForPathname` tests updated to the final map.
- [ ] Redirect integration tests cover all five redirects (permanent status + destination).
- [ ] `npm run typecheck`, lint, and the full test suite pass; a grep for `/approvals`, `/chat'`, `/today'`, `/memory'`, `/constraints'` route literals finds only redirect config and historical docs.

**Priority:** Medium (gates handoff)
**Estimated hours:** 3h

#### Task 9.1.3.5.1 — Registry cleanup + route-map conformance tests
- **Parent Story:** 9.1.3.5
- **Agent:** frontend-specialist
- **Estimation:** 3h
- **Dependencies:** Tasks 9.1.3.1.2, 9.1.3.3.2, 9.1.3.4.2
- **Deliverables:**
  - Final `apps/web/src/lib/surfaces/registry.ts` mapping (single bounded edit to the 9.1.1-owned file: remove interim aliases); redirect + route-map integration tests; C5 conformance checklist in the PR.
- **Acceptance Criteria:**
  - [ ] Registry route table matches the C2/C5 tables in `epic-9-shared-contracts.md` line for line.

## Task Dependencies

```
9.1.3.1.1 (authed home at /) ─► 9.1.3.1.2 (redirects + delete /chat,/today)
9.1.3.2.1 (getApproval + handler copy) ─┐
9.1.3.3.1 (extract approval components) ─┴─► 9.1.3.2.2 (inline card + message render)
9.1.3.3.1 ─► 9.1.3.3.2 (/activity + retire /approvals)
9.1.3.4.1 (settings restructure) ─► 9.1.3.4.2 (trust-route redirects + deletion)
{9.1.3.1.2, 9.1.3.3.2, 9.1.3.4.2} ─► 9.1.3.5.1 (registry cleanup + conformance)
```

**Critical path:** extract components → inline card (the C7 deliverable). Home consolidation, activity, and settings restructure are three parallel streams converging on the conformance task.

## Agent Assignment & File Scope

| Agent | Tasks | Hours |
|---|---|---|
| backend-specialist | 9.1.3.2.1 | 3h |
| frontend-specialist | 9.1.3.1.1, 9.1.3.1.2, 9.1.3.2.2, 9.1.3.3.1, 9.1.3.3.2, 9.1.3.4.1, 9.1.3.4.2, 9.1.3.5.1 | 24h |

**Files/directories this wave may touch (exclusive scope):**
- `apps/web/src/app/page.tsx` (auth branch → AppShell home)
- `next.config.ts` (permanent redirects)
- `apps/web/src/app/(app)/chat/`, `apps/web/src/app/(app)/today/`, `apps/web/src/app/(app)/approvals/`, `apps/web/src/app/(app)/memory/`, `apps/web/src/app/(app)/constraints/` (delete/relocate)
- `apps/web/src/app/(app)/activity/` (new), `apps/web/src/app/(app)/settings/` (layout + sub-routes; existing clients moved in unchanged)
- `apps/web/src/components/approvals/` (new — extracted card/history-row + `inline-approval-card.tsx`)
- `apps/web/src/components/overview/` (new — interim home content extracted from Today)
- `apps/web/src/components/chat/message.tsx` (tool-result → inline card rendering only)
- `apps/web/src/components/chat/conversation-list.tsx` (delete)
- `apps/web/src/app/actions/approvals.ts` (add `getApproval`)
- `apps/web/src/lib/chat/tools/handlers.ts` (message-copy change in `handleSubmitForApproval` only) + its tests
- `apps/web/src/lib/surfaces/registry.ts` (bounded edit: remove interim aliases)
- Tests colocated with the above

**Not touched:** `supabase/` (no schema changes), `apps/web/src/components/chat/chat-pane.tsx` / `history-flyout.tsx` / providers (9.1.2's), `apps/web/src/components/layout/` internals (9.1.1's — consumed via `AppShell` props/composition only).

## Dependencies

- **Depends on:** Wave 9.1.1 (AppShell, panel controller, registry — C2/C3), Wave 9.1.2 (unified conversation store — the inline card renders in the C1 conversation; `/chat` route must already be defused/legacy-key-free before deletion).
- **Blocks:** Wave 9.2.3 (overview board replaces the interim home; attention card reuses `components/approvals/`), Wave 9.3.1 (palette generates navigation from the final C5 route map + registry), Wave 9.4.2 (proactive-in-chat is C7's other half).

## Definition of Done

- Contract C5 route map live and verified (all five permanent redirects; all surface deep links; no orphan routes); contract C7 inline approval card live with ADR-013 raw-payload-primary rendering preserved verbatim.
- A gated action can be approved, modified, or canceled entirely within the conversation; reloaded history shows current approval status.
- `/activity` audit page functional including retry; `/approvals` gone.
- Memory/Constraints fully functional under Settings; old routes redirect; Settings sub-nav groups per design §6.
- Registry conforms to the contracts doc tables; interim mappings removed; downstream consumers (9.3.1, 9.4.1) need no special cases.
- All unit/component/integration tests passing; `npm run typecheck` and lint clean; signed-out landing page unregressed.
- PR from `development`; wave demo (inline approval end-to-end + redirect sweep) in the PR description.

## Infrastructure Specifications

### API

**Server action — `getApproval(id)`** (`apps/web/src/app/actions/approvals.ts`):

| Attribute | Value |
|---|---|
| Auth | Supabase SSR session; RLS-scoped (row must belong to `auth.uid()`) |
| Input | `id: string` (approval_queue PK, from the `submit_for_approval` tool-result content) |
| Returns | `{ id, action_type, provider, payload, ai_summary, status, created_at }` or `{ error }` for missing/foreign rows |
| Purpose | Fresh status for inline cards on history reload; no caching |

**Tool handler copy change:** `handleSubmitForApproval` result message drops "Visit /approvals…" in favor of interrupt-model copy ("Action queued — review it in the card above / on your board"); result content keeps `approval_id` and `status` unchanged (the inline card's parse contract). **No tool schema change** (C6 guarantee preserved).

**Redirects (permanent):** `/chat` → `/`, `/today` → `/`, `/approvals` → `/activity`, `/memory` → `/settings/memory`, `/constraints` → `/settings/constraints`.

### UI

| Element | Spec |
|---|---|
| Inline approval card | Chat-width compact card; amber identity; raw payload preformatted-primary, AI summary secondary + labeled; Approve (primary) / Modify (inline JSON edit + validation) / Cancel (destructive); resolved states compact; error + retry states designed |
| `/activity` | Panel surface, no rail icon; audit list (history rows + failure/retry) with pending fallback section; timezone-correct timestamps (BL-004 utilities) |
| Settings | Sub-nav groups Assistant / Mind / Connections / Account; Memory + Constraints clients relocated unchanged |
| Home `/` | Signed-out: existing landing untouched. Signed-in: AppShell with chat + interim overview panel home (Today composition) — replaced by the board in 9.2.3 |

### Testing

- **Unit:** `getApproval` RLS scoping; tool-result content parsing (well-formed, malformed, missing `approval_id`); registry final-map `surfaceForPathname`.
- **Component:** InlineApprovalCard states (pending/approving/approved/executing/failed/canceled/parse-error); Settings sub-nav; `/activity` list + retry.
- **Integration:** end-to-end gated action → inline card → approve → status reflected; history reload shows fresh status; all five redirects (status + destination); signed-out `/` landing snapshot; signed-in `/` shell render.
- **Regression:** existing `submit-for-approval-handler` tests updated for new copy; existing approval-action tests untouched and passing.
- **Coverage target:** ≥80% on `inline-approval-card.tsx` and `getApproval`.

### Deployment

- No migrations or environment variables. Permanent redirects note for the PR: browsers cache them — verify destinations in the Vercel preview **before** merge (a wrong permanent redirect is sticky for users).
- Ships as one PR to `development`; independently revertable (no schema coupling).

### Monitoring

- Post-deploy: watch Vercel logs for 404s on the five retired paths (would indicate a missed redirect variant, e.g. trailing-slash or sub-path deep links like `/email/[id]` unaffectedness).
- Approval flow: existing `approval_proposed` structured log unchanged; spot-check that inline approvals produce the same audit entries as the old page did.

## Handoff Requirements

**For Wave 9.2.x:**
- `components/overview/` is the slot 9.2.3's board replaces; `components/approvals/` cards are what the attention card composes; the interim Today composition is explicitly disposable.

**For Wave 9.3.1:**
- The registry + C5 map are final — navigate-commands and `g`-chords generate from them with no exceptions list.

**For Wave 9.4.2 (C7's other half):**
- Proactive system-authored messages render through the same `message.tsx` pathway; the inline-card pattern (tool-result → rich card) is the precedent for compact briefing/nudge cards.

## Risks and Blockers

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Root-page auth branch duplicates shell/layout subtleties (timezone, providers) | Med | Med | AppShell extracted in 9.1.1 exactly for this; a shared render path is an AC, not an option |
| Permanent redirects cached wrong during iteration | Med | Low | Verify on Vercel preview before merge; keep redirect config in one file |
| Inline card drifts from ADR-013 (summary-primary creep) | High | Low | Extraction (9.1.3.3.1) is a pure move; ADR-013 rendering rules carried as code comments + component tests assert raw-payload prominence |
| Historical conversations show stale approval affordances | Med | Med | `getApproval` fresh-status fetch on mount is an explicit AC; resolved states compact |
| Settings relocation breaks memory/constraints flows | Med | Low | Client components moved, not modified; full interaction checklist in Task 9.1.3.4.1 AC |
| Users' muscle memory / bookmarks to old routes | Low | High | All five redirects permanent; ⌘K (9.3.1) restores fast access by name |

## Notes and Assumptions

- **Next.js constraint:** only one page can resolve to `/`, so the root page **branches on auth** (landing vs. AppShell home) rather than the `(app)` group owning `/`. This is the load-bearing implementation decision for C5's "canonical home."
- "Permanent redirect" via `next.config` `permanent: true` issues 308 (equivalent semantics to the design doc's "301" — method-preserving permanent redirect).
- `/projects/[id]` is retained as a goals-surface deep-link alias (existing route, maps to `goals` in the registry) — C5 doesn't list it, but removing it is out of scope and it introduces no rail/nav presence. Flagged for the contracts doc owner if it should be formally added to C5.
- Pending approvals remain *visible* on `/activity` as a fallback, but the primary pending surfaces are the inline card (this wave) and the attention card (9.2.3) — until 9.2.3 lands, `/activity` is the only aggregate pending view, which is acceptable interim per the interrupt model (tray notifications from Epic 6 still fire).
- The overview board itself is **not** built here (9.2.3); `/` panel home uses the existing Today composition as interim content.

## Related Documentation

- Shared contracts (C5, C7-inline owned here): `docs/planning/epic-9-shared-contracts.md`
- Design source of truth: `docs/planning/bl-002-ui-ux-overhaul-design.md` §4.1b, §4.2, §6, §8.1
- Epic plan: `docs/implementation/_main/epic-9-experience-redesign.md` — Feature 9.1
- UX Foundations: `docs/architecture/_main/05a-UX-Foundations.md` — Pass 1, Pass 2, Pass 3
- ADR-013 (approval-context integrity — raw payload primary)
