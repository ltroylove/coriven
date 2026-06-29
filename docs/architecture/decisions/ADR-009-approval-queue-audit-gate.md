---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-009"
deciders: "Roy Love"
product:
  - "coriven"
tags: [security, approvals, audit, zero-trust]
relateddocuments:
  - "docs/implementation/_main/epic-5-communications-intelligence.md"
---

# ADR-009: Approval Queue + Append-Only Audit as the External-Action Gate

**Status**: Accepted **Date**: 2026-06-29 **Deciders**: Roy Love **Related**: Epic 5 (Communications Intelligence); blueprint §9

---

## Context

Once Coriven can send email, create calendar events, or otherwise change the external world, it crosses from advising to acting. The blueprint's hard principles are "AI does not own truth," "human approval required for meaningful actions," and "zero-trust inputs." We need a single architectural mechanism that enforces these for every external-world action.

## Considered Options

- **Option 1: Direct execution** — let the model/tools act and notify after.
- **Option 2: Approval queue + append-only audit** — every external action is queued `pending`, reviewed by an authenticated user, then executed and audited.
- **Option 3: Per-tool ad-hoc confirmations** — confirmation prompts scattered per tool.

## Decision

**We will route every external-world change through an `approval_queue` (pending → approved/rejected → executed) with an immutable, append-only `audit_log`.** Untrusted content can be summarized and proposed on, but can never directly invoke an action.

### Why This Choice

**Key factors:**
1. **One enforcement point** — uniform gate for sends, event creation, purchases, external deletes; internal CRUD stays auto-owned.
2. **Zero-trust spine** — `untrusted input → propose → approve → execute`; n8n (or direct API) fires only after `status = 'approved'`, with a pre-validated descriptor (never raw content/AI output).
3. **Auditability** — append-only `audit_log` (service-role writes only) gives full traceability; nothing external happens silently.

```text
Claude submit_for_approval({action_type, description, payload})
  → approval_queue(pending)  (payload validated)
  → user Approve/Modify/Cancel
  → on approve: audit_log + executor → executed
```

## Consequences

### Positive
- Trust by construction; safe against prompt-injection driving real actions.
- Decouples decision (approve) from execution (n8n/direct API — ADR-005).

### Negative
- Extra step for every external action (friction).
- Requires payload validation discipline before insert.

### Mitigation Strategies
- Inline Modify on the approval card; clear what + why; fast single 3-way decision.
- Validate payloads at submit time; security review before Epic 5 ships.

---

## References
- Master blueprint §9 (Approval Queue & Security), §9.3 (zero-trust)
- Epic 5: `docs/implementation/_main/epic-5-communications-intelligence.md`
- Related: ADR-005 (n8n as replaceable worker)

---
**Last Updated**: 2026-06-29
