---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-07-02"
lastupdated: "2026-07-02T00:00:00"
version: "1.0"
type: wave
status: Planning
domain: implementation
product:
  - "coriven"
epic: "5"
feature: "5.2"
wave: "5.2.2"
agents: []
tags: [coriven, email, inbox, ui, triage, zero-trust]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
  - "docs/architecture/decisions/ADR-013-integration-token-authority.md"
  - "docs/architecture/_main/03-Business-Requirements.md"
---

# Wave 5.2.2: /email Inbox UI

## Wave Overview
- **Wave ID:** Wave-5.2.2
- **Feature:** Feature 5.2 - Email Triage (Gmail + Outlook)
- **Epic:** Epic 5 - Communications Intelligence
- **Status:** Planning
- **Scope**: A triaged inbox page presenting classified email metadata grouped by category with urgency indicators, an individual email view that fetches the body on demand, read-state tracking, and navigation access.
- **Wave Goal:** Users see a unified, triaged view of their Gmail and Outlook mail — what's urgent, what needs action, what's noise — and can open any message's full content on demand without Coriven ever storing it.

**Wave Philosophy**: This is a scope-based deliverable unit, NOT a time-boxed iteration. Duration is determined by completion of the defined scope, not a fixed calendar period.

## Wave Goals

1. A unified inbox shows all triaged messages across both providers, grouped by category with clear urgency indicators and one-line summaries.
2. Opening a message fetches its full body live from the provider, rendered safely as untrusted content — nothing body-related is persisted.
3. Read state is tracked so users can distinguish new from seen messages.
4. The inbox is reachable from the app's primary navigation.

## User Stories

### User Story 1: See a triaged, unified inbox

**As a** Coriven user
**I want** one inbox view of my Gmail and Outlook mail grouped by category with urgency indicators and summaries
**So that** I can decide in seconds what needs my attention.

**Acceptance Criteria:**
- [ ] The inbox shows messages from both providers, grouped by category (important, action required, informational, promotional, spam), newest first within each group.
- [ ] Each row shows sender, subject, one-line summary, received time, provider, and a visual urgency indicator (critical, high, normal, low).
- [ ] Only the signed-in user's messages appear; an unauthenticated visitor is redirected to sign in.
- [ ] A user with no connected email provider sees an empty state pointing them to the integrations settings.

**Priority:** High

---

### User Story 2: Read a full email on demand

**As a** Coriven user
**I want** to open any triaged message and read its full content
**So that** I get the detail behind the summary when I need it.

**Acceptance Criteria:**
- [ ] Opening a message fetches the thread body live from the provider at view time; nothing beyond the existing metadata is stored.
- [ ] Body content renders safely — sanitized so email HTML cannot execute scripts or exfiltrate data, and treated as untrusted throughout.
- [ ] If the live fetch fails (provider error, disconnected account), the user sees the metadata and summary plus a clear error, not a broken page.
- [ ] A user can only open messages from their own accounts.

**Priority:** High

---

### User Story 3: Track what I've already seen

**As a** Coriven user
**I want** unread messages visually distinct and marked read when I open them
**So that** I can tell at a glance what's new since I last checked.

**Acceptance Criteria:**
- [ ] Unread messages are visually distinct in the inbox list.
- [ ] Opening a message marks it read; the list reflects this without a full manual refresh.
- [ ] Read state changes affect only the current user's own records.

**Priority:** Medium

---

### User Story 4: Reach the inbox from anywhere in the app

**As a** Coriven user
**I want** an Email entry in the app navigation
**So that** the triaged inbox is one click away from any page.

**Acceptance Criteria:**
- [ ] The primary navigation includes an Email link visible to signed-in users.
- [ ] The link highlights as active when the inbox or an email detail view is open.

**Priority:** Medium

## Logical Unit Test Cases

### Test Case 1: Inbox requires authentication and scopes data per user
- **Endpoint:** `/email`
- **Method:** GET (page request)
- **Test Data:** Unauthenticated request; authenticated request for user A with seeded rows for users A and B
- **Expected Result:** Unauthenticated → redirect to sign-in; user A sees only their own rows
- **Verification:** Redirect behavior; rendered rows contain no user B data

### Test Case 2: Inbox groups by category with urgency indicators
- **Endpoint:** `/email`
- **Method:** GET (authenticated)
- **Test Data:** Seeded `email_metadata` rows spanning all five categories and all four urgency levels
- **Expected Result:** Five category groups rendered, newest first within each, with the correct urgency indicator per row
- **Verification:** Group membership, ordering, and indicator mapping match seeded data

### Test Case 3: Detail view fetches body on demand and marks read
- **Endpoint:** Email detail view for a seeded message (Server Action / route invocation)
- **Method:** GET + read-state mutation
- **Test Data:** Seeded unread metadata row; mocked provider thread response containing hostile HTML (`<script>`, prompt-injection text)
- **Expected Result:** Body renders sanitized (no script execution); `is_read` flips to true
- **Verification:** Sanitized output; `is_read = true` in DB; no body content written to any table

### Test Case 4: Detail view degrades gracefully on fetch failure
- **Endpoint:** Email detail view
- **Method:** GET
- **Test Data:** Seeded metadata row; mocked provider returning an error
- **Expected Result:** Metadata + summary shown with an inline fetch-error message
- **Verification:** No unhandled error; page renders with the stored metadata

## Technical Tasks

### Task 1: `/email` inbox page (server component)
- **Agent:** frontend-specialist
- **Estimation:** 8 hours
- **Dependencies:** Wave 5.2.1 complete (`email_metadata` populated)
- **Priority:** High

**Deliverables:**
- `apps/web/src/app/email/page.tsx` — auth-guarded server component querying `email_metadata` for the current user, grouped by category, urgency badges, unread styling, provider indicator, empty state linking to `/settings/integrations`

**Acceptance Criteria:**
- [ ] Category grouping and urgency indicators match Test Case 2; RLS-scoped query only
- [ ] Empty and no-connection states handled

---

### Task 2: Email detail view with on-demand body fetch
- **Agent:** frontend-specialist
- **Estimation:** 8 hours
- **Dependencies:** Task 1
- **Priority:** High

**Deliverables:**
- `apps/web/src/app/email/[id]/page.tsx` (or equivalent detail surface) — server-side body fetch reusing the Wave 5.2.1 thread-fetch logic via `nango.getToken()`, HTML sanitization before render, graceful error fallback to stored metadata

**Acceptance Criteria:**
- [ ] Body fetched live, sanitized, never persisted; fetch failure shows metadata + error inline

---

### Task 3: Read-state Server Action
- **Agent:** backend-specialist
- **Estimation:** 3 hours
- **Dependencies:** Task 1 (can start in parallel with Task 2)
- **Priority:** Medium

**Deliverables:**
- Server Action in `apps/web/src/app/actions/` updating `is_read` for the current user's row, invoked on detail-view open; list revalidation so the inbox reflects the change

**Acceptance Criteria:**
- [ ] Marks only the owner's row; inbox unread styling updates after open

---

### Task 4: AppNav link
- **Agent:** frontend-specialist
- **Estimation:** 1 hour
- **Dependencies:** Task 1
- **Priority:** Medium

**Deliverables:**
- Email entry added to the existing AppNav component with active-state highlighting for `/email` routes

**Acceptance Criteria:**
- [ ] Link visible when signed in; active state correct on inbox and detail views

---

### Task 5: Wave test suite
- **Agent:** quality-control
- **Estimation:** 5 hours
- **Dependencies:** Tasks 2, 3, 4
- **Priority:** High

**Deliverables:**
- Tests covering the four Logical Unit Test Cases, including the hostile-HTML sanitization case

**Acceptance Criteria:**
- [ ] All test cases pass; sanitization proven against script and prompt-injection payloads

## Task Dependencies

```
Wave 5.2.1 (prerequisite)
  ↓
Task 1 (inbox page)
  ├─> Task 2 (detail view + body fetch)
  ├─> Task 3 (read-state action, parallel)
  └─> Task 4 (nav link, parallel)
        ↓
      Task 5 (test suite — after Tasks 2, 3, 4)
```

**Critical path:** Task 1 → Task 2 → Task 5. Tasks 3 and 4 are parallel streams off Task 1.

## Agent Assignments

| Agent | Tasks | Total Hours |
|-------|-------|-------------|
| frontend-specialist | Task 1, Task 2, Task 4 | 17 |
| backend-specialist | Task 3 | 3 |
| quality-control | Task 5 | 5 |

## Definition of Done

- [ ] All user stories completed
- [ ] All acceptance criteria met
- [ ] All tasks completed
- [ ] Unit and integration tests passing (auth scoping, grouping, sanitization, read state, graceful failure)
- [ ] Code reviewed and approved
- [ ] No TypeScript/linter errors (strict mode)
- [ ] Security check: email HTML sanitized; no body content persisted; no cross-user access
- [ ] Documentation updated (epic doc wave status)
- [ ] Deployed to production; inbox verified against a real connected account

## Handoff Requirements

**For other Features/Epics:**
- Feature 5.3 (approvals): "draft a reply" flows can link back to the email detail view for context
- Feature 5.4 (meeting prep): prep briefs can deep-link to related messages in `/email`
- Epic 6: daily briefing email items link to their inbox entries

## Risks and Blockers

| Risk/Blocker | Impact | Mitigation |
|--------------|--------|------------|
| Email HTML rendering is a large attack surface | High | Strict server-side sanitization; tested against hostile payloads; plain-text fallback if sanitization fails |
| On-demand body fetch latency hurts detail-view UX | Med | Show stored metadata + summary immediately; stream/skeleton the body |
| Provider disconnected after triage (stale metadata, dead fetch) | Low | Detail view degrades to metadata + reconnect prompt |

## Notes and Assumptions

- Wave 5.2.1 is fully complete: metadata populated, thread-fetch logic and shared types available.
- Reply/compose actions are explicitly out of scope — outbound email goes through Feature 5.3's approval queue.
- User-initiated re-classification of a message is a possible follow-up, not in this wave (epic risk table notes it as a triage-inaccuracy mitigation).

## Related Documentation

- Epic Plan: docs/implementation/_main/epic-5-communications-intelligence.md (Feature 5.2)
- ADR-013: docs/architecture/decisions/ADR-013-integration-token-authority.md
- Blueprint: docs/planning/2026-06-24-coriven-master-blueprint.md (§9.3, §11.1)

## Wave Retrospective

{This section will be filled in after wave completion}

### What Went Well
- {Item 1}

### What Could Be Improved
- {Item 1}

### Action Items
- [ ] {Action item 1}

---

**Template Version:** 2.0 (Scope-based Wave)
**Note:** Waves are organized by logical scope, not time periods. Complete when scope is delivered.
