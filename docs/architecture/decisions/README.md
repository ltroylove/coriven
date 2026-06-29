# Architecture Decision Records (ADRs)

This directory holds Coriven's architecture decision records. ADRs capture significant, hard-to-reverse decisions with their context, options, and consequences.

## Index

| ADR | Title | Status | Source / File |
|-----|-------|--------|---------------|
| ADR-001 | Supabase + pgvector from day one | Accepted | `04-Architecture.md` §ADRs |
| ADR-002 | The Sentinel context architecture; MVP first | Accepted | `04-Architecture.md` §ADRs |
| ADR-003 | Tauri tray replaces the Node.js daemon | Accepted | `04-Architecture.md` §ADRs |
| ADR-004 | Reminders stay a separate `task_reminders` table | Accepted | `04-Architecture.md` §ADRs |
| ADR-005 | n8n as replaceable worker; start with direct API | Accepted | `04-Architecture.md` §ADRs |
| ADR-006 | OpenAI embeddings alongside Anthropic | Accepted | `04-Architecture.md` §ADRs |
| ADR-007 | Behavioral constraints as an engine-level pre-action gate (lightweight v1) | Accepted | `ADR-007-behavioral-constraint-pre-action-gate.md` |
| ADR-008 | Deterministic daily briefing (no LLM generation) | Accepted | `ADR-008-deterministic-daily-briefing.md` |
| ADR-009 | Approval queue + append-only audit as the external-action gate | Accepted | `ADR-009-approval-queue-audit-gate.md` |
| ADR-010 | Scheduled proactive jobs (cron) over real-time computation | Accepted | `ADR-010-scheduled-proactive-jobs.md` |
| ADR-011 | Entity cap as primary paywall; memory window enforced at retrieval | Accepted | `ADR-011-entity-cap-paywall-memory-window.md` |

> ADR-001–006 are the strategic stack decisions, documented in full inline in `docs/architecture/_main/04-Architecture.md`. ADR-007–011 are epic-level decisions surfaced during `/design-epics` and recorded as standalone files here.

## Next ADR number

**ADR-012**

## Conventions

- One decision per file: `ADR-{NNN}-{kebab-title}.md`.
- Status: Proposed → Accepted → Deprecated / Superseded by ADR-NNN.
- Link the originating Epic in the **Related** field.
