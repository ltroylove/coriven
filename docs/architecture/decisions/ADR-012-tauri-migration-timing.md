---
preparedfor: "Onshore Outsourcing Inc. -- Internal Use Only"
preparedby: "Roy Love"
datecreated: "2026-06-29"
lastupdated: "2026-06-29T00:00:00"
version: "1.0"
type: adr
status: Accepted
domain: architecture
adrid: "ADR-012"
deciders: "Roy Love"
product:
  - "coriven"
tags: [tray, tauri, timing, distribution]
relateddocuments:
  - "docs/implementation/_main/epic-1-foundation-closeout.md"
  - "docs/implementation/iterations/wave-1.3.1-tray-reliability-tauri-decision.md"
  - "docs/architecture/decisions/ADR-003 (in 04-Architecture.md)"
---

# ADR-012: Tauri Migration Timing — Defer to Productization

**Status**: Accepted **Date**: 2026-06-29 **Deciders**: Roy Love **Related**: Wave 1.3.1 (Tray Reliability & Tauri Decision); ADR-003 (Tauri tray replaces the Node.js daemon); blueprint §13.4

---

## Context

ADR-003 already accepted **Tauri** as the eventual tray shell (Windows + Mac from one codebase). Wave 1.3.1 asks the remaining question: **when** does the full Node.js → Tauri migration happen — now (Epic 1) or later (Productization)? The blueprint (§13.4) pre-approves either outcome and flags the one-time costs of going now.

Relevant facts at decision time:
- The **Node.js tray daemon works** and is a thin shell — verified in Wave 1.3.1: no local `getNextOccurrence`, no recurrence math, no hardcoded user data in `apps/tray/src/` (recurrence lives in `@personal-assistant/types`).
- The reusable logic is in the **API + shared types**, not the tray shell — so the shell is cheap and disposable, and deferring its rewrite costs little.
- Going to Tauri now carries one-time cost: a **Rust toolchain in CI**, **Apple Developer Program ($99/yr) + notarization** for the Mac `.app`, and a **Windows code-signing certificate** to avoid SmartScreen.
- The owner is on **Windows**; there is **no Mac-user need yet**.
- The product is **pre-revenue / solo**; signing + CI spend is not yet justified.
- The Tauri spike (Rust prototype + native-notification PoC) was **not executed in Epic 1** — it requires a Rust toolchain and manual Windows-GUI verification, and running it now would be throwaway work if the full migration lands later anyway.

## Considered Options

- **Option 1: Go now** — migrate to Tauri during Epic 1 (run the spike, build the thin shell, set up signing/CI).
- **Option 2: Defer to Productization (Epic 7)** — keep the working Node.js daemon through Epics 1–6; do the full Tauri migration + Mac build + signing when productizing.

## Decision

**We will DEFER the full Tauri migration to Productization (Epic 7).** The Node.js tray daemon remains the tray through Epics 1–6, retaining its verified thin-shell status. The Tauri spike and migration move into Epic 7 alongside the other distribution/signing work (Apple Developer, Windows cert, CI artifacts).

### Why This Choice

1. **The Node tray already works and is thin** — no functional gap to close now; web/tray/mobile already share backend logic.
2. **Costs land when they pay off** — signing fees + CI complexity + Mac support are Productization concerns, not Phase-1 ones; deferring avoids paying for capabilities no one uses yet.
3. **Low switching cost later** — because logic lives in the API/types (not the shell), the eventual Tauri port stays cheap; nothing about deferring increases its cost.
4. **Avoids throwaway spike work** — running the Rust/notification PoC now, then again at migration time, is wasted effort.

## Consequences

### Positive
- No new spend or CI complexity during Epics 1–6.
- Tray reminders keep working via the existing daemon.
- Tauri work is consolidated with related distribution work in Epic 7.

### Negative
- **Mac is not supported until Epic 7** (acceptable — owner is on Windows).
- The Node.js daemon must keep honoring the thin-shell rule until replaced (enforced by Wave 1.3.1 verification; re-check in future tray changes).

### Mitigation
- Epic 7 (Productization) explicitly carries the Tauri migration (it already notes this in its out-of-scope/Tauri line). The spike becomes the first step of that work.
- Keep `getNextOccurrence` (and any future shared logic) in `@personal-assistant/types` so the eventual port stays a shell swap.

---

## References
- ADR-003 (Tauri tray replaces the Node.js daemon) — in `docs/architecture/_main/04-Architecture.md`
- Wave 1.3.1 — `docs/implementation/iterations/wave-1.3.1-tray-reliability-tauri-decision.md`
- Master blueprint §13 (Tray App), §13.4 (Signing & Distribution)
- Epic 7 (Productization) — `docs/implementation/_main/epic-7-productization.md`

---

**Last Updated**: 2026-06-29
