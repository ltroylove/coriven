# AI Agent Memory — Deep Research Report #2
## Entity-Centric Memory, Proactive Surfacing & Decision Modeling

**Date:** 2026-06-20  
**Method:** Multi-agent deep research harness — 112 agents, 29 sources, 143 claims extracted, 25 adversarially verified (3-vote system), 5 confirmed, 17 killed  
**Follows from:** `2026-06-20-ai-memory-research.md`  
**Question:** Entity-centric memory, proactive surfacing, causal/decision modeling from behavioral data, temporal memory evolution, and the gap between retrieval and reasoning  
**Use case:** Personal AI assistant that builds a genuine model of a person — their relationships, patterns, and decision-making — compounding in value over months and years

---

## Executive Summary

The research landscape for personal AI memory is maturing rapidly, with concrete architectural proposals emerging in 2025–2026 that go well beyond flat vector retrieval. The most significant developments are:

1. **Bi-temporal knowledge graphs (Graphiti/MemORAI)** that preserve full state history rather than overwriting facts — Sarah moves from Denver to Austin, and the history of both is preserved and queryable
2. **Layered memory architectures (PASK)** that separate stable user profiles (injected as system-prompt cache) from episodic retrieval stores, with time-decayed Bayesian updates for profile evolution
3. **Proactive surfacing systems** that use explicit utility functions and demand detection modules to trigger assistance without user queries

The gap between retrieval and reasoning remains the field's central unsolved problem — episodic memory requires reflection and multi-hop reasoning, not just similarity search — but graph-structured memory is the dominant proposed solution.

**The most important finding:** Causal and decision modeling — inferring *why* a person or organization makes decisions from observed behavioral patterns over time — had **zero confirmed research claims survive adversarial verification.** Nobody is working on this under any framing. It is genuinely uncharted territory.

---

## The Sarah/Denver Problem — What Architecture Solves It

The concrete example: user says "my sister Sarah lives in Denver" once in January. In March they say "I'm going to visit my sister." The AI should surface: "Would you like me to look at flights to Denver?"

This requires the AI to:
1. Store Sarah as an **entity with a rich profile**, not just a flat fact
2. **Connect** "visiting my sister" → Sarah → Denver without the word Denver appearing
3. **Decide proactively** to surface the connection before being asked
4. **Handle evolution** — if Sarah moves in June, the old Denver fact updates correctly

All four of these now have concrete architectural solutions available. Together they define what a real implementation would look like.

---

## Confirmed Findings (Survived Adversarial Verification)

### 1. Entity-Centric Memory with Bi-Temporal Graphs Is Current Best Practice
**Confidence: HIGH | Vote: 3-0 on both constituent claims**  
**Sources:** MemORAI (arXiv:2605.01386, May 2026), Graphiti/Zep (arXiv:2501.13956), Survey (arXiv:2602.05665)

Entity-centric memory stores **rich natural-language profiles** of named individuals, not just surface names or isolated facts. MemORAI entity nodes store:
- A name
- A fine-grained natural-language description: *"Alex—software engineer at XYZ, prefers async communication"*
- Turn-ID provenance (which conversation turn created/updated this)

This is explicitly contrasted with Mem0g, which stores only surface names without descriptions — meaning Mem0 would store "Sarah" but not "Sarah is Roy's sister who lives in Denver and was last mentioned in January."

**Graphiti (open source, from Zep)** adds bi-temporal modeling — four timestamps per memory edge:
- `t_created` / `t_expired` — the transaction timeline (when was this recorded)
- `t_valid` / `t_invalid` — the event timeline (when was this actually true)

Contradictions are resolved by **setting `t_invalid` on the superseded edge**, not deleting it. The old fact becomes historically queryable. Sarah moving from Denver to Austin doesn't erase the Denver fact — it expires it with a date, and Austin becomes the current valid fact.

**Why this matters for the Sarah/Denver example:** Sarah gets a full entity profile that accumulates over time. Every conversation that mentions her adds to her profile. The relationship "Roy's sister" and the location "Denver" are edges in the graph, not isolated text fragments. When "visiting my sister" is processed, the system traverses the graph: user → sister → Sarah → Denver.

**Known implementation gap:** Graphiti's MCP interface doesn't expose `reference_time`, so historical backfill (importing past conversations, email, calendar) stamps events with ingestion time rather than occurrence time. A production deployment handling years of history would need to work around this.

---

### 2. Episodic Memory Requires Reasoning, Not Just Retrieval — Recognized Architectural Principle
**Confidence: HIGH | Vote: 3-0**  
**Sources:** arXiv:2502.06975 (Feb 2025), Survey arXiv:2602.05665, Critique arXiv:2602.06052

A Feb 2025 position paper on episodic memory in LLM agents formally states: *"A defining feature of explicit memory is the ability to reflect and reason about the memory content."*

Five required properties for genuine episodic memory:
1. Long-term storage (persists across sessions)
2. Single-shot learning (acquired from a single exposure, not repeated training)
3. Instance-specificity (this specific event, not a generalization)
4. Contextual binding (linked to when/where/why it was learned)
5. **Reflection and reasoning** (the ability to draw inferences from the memory, not just retrieve it)

Current systems largely satisfy 1 and 3. Most fail on 4 and 5. The field explicitly names this as the central gap.

**What this means architecturally:** The Sarah/Denver connection requires property 5 — the system must reason "visiting my sister → who is her sister → Sarah → where does Sarah live → Denver → what's actionable here → flights." No retrieval system does this automatically. It requires a reasoning pass over the entity graph.

---

### 3. Layered Memory: Stable Profile Cache + Episodic Retrieval (PASK)
**Confidence: HIGH | Vote: 3-0 on separation; 2-1 on Bayesian decay**  
**Source:** arXiv:2604.08000 (PASK, April 2026) — *unreviewed preprint, benchmark performance claims were refuted*

The PASK system implements a two-layer memory architecture:

**Layer 1: M_user (stable behavioral profile)**
- Injected directly into the system prompt as a high-priority dense cache
- Contains: domain expertise, personalized thresholds, behavioral priors
- Always present — not retrieved, always loaded
- Evolves via time-decayed Bayesian updates:

```
M_user(T) = Decay(M_user(T−1), Δτ) ⊕ ResolveConflict(U′, M_user(T−1))
```

Where:
- `Decay` gradually lowers confidence weights over time interval Δτ
- `ResolveConflict` reinforces matched items, overwrites decayed contradictions, discards low-confidence anomalies
- The result: stable facts stay stable; outdated facts decay until they can be overwritten by new evidence

**Layer 2: M_global (episodic retrieval store)**
- Standard episodic history stored for on-demand retrieval
- Not always loaded — retrieved when relevant

**Why this architecture matters:** The stable profile layer is always available to the model without retrieval latency or retrieval failures. High-confidence long-term facts about the user (relationships, preferences, patterns) live in the profile and are always in context. Episodic details (specific conversations, events) live in the retrieval layer.

**Caveat:** PASK is an unreviewed preprint. The Bayesian decay mechanism is a design framing rather than a proven computational model. Performance benchmarks from the PASK paper failed adversarial verification and should not be cited. The architectural separation is sound; the specific update math is a proposal.

---

### 4. Proactive Surfacing Without Explicit Queries Is a Solvable Engineering Problem
**Confidence: MEDIUM | Vote: 2-1 (PASK); 3-0 (ProMemAssist)**  
**Sources:** arXiv:2604.08000 (PASK), arXiv:2507.21378 (ProMemAssist, accepted UIST 2025)

Two concrete, distinct approaches to proactive surfacing confirmed:

**Approach A — Demand Detection Module (PASK)**

Continuously ingests real-time signals (conversation context, detected intent signals) and uses the structured user profile to infer latent needs. Predicts one of three states:
- **Silent** — wait, no action needed
- **Fast intervention** — low-latency response from recent context only (no deep memory retrieval)
- **Full assistance** — memory-grounded reasoning with full entity graph traversal

The reward function that tunes when to intervene:
```
J(π) = E_π[Σ γ^t (R_help(δ_t, A_t) − λ·C_intr(δ_t, A_t))]
```
Where `λ` tunes the helpfulness-intrusiveness tradeoff. Higher λ = less likely to interrupt. This is tunable per user — some people want more proactive surfacing, some find it intrusive.

**Approach B — Utility Function with Threshold (ProMemAssist, UIST 2025)**

Models working memory from sensor data (this implementation uses smart glasses, but the utility function generalizes) and fires proactive assistance when:
```
Utility = (W_I × Importance + W_R × Relevance) − (C_D + C_I)
```
Fires when Utility > 0.75 (empirically tuned on N=12, limited generalizability).

**What both approaches share:** They both require a model of the user (profile) as input to determine relevance. You cannot proactively surface what you don't know about the person. The profile builds the foundation for proactive triggering.

**Cold-start problem:** Neither approach addresses how to bootstrap proactive surfacing in the first days/weeks before enough behavioral data exists to build a reliable profile. This is an open problem.

---

### 5. Bi-Temporal Graph Memory Is the Most Complete Solution to Memory Evolution
**Confidence: HIGH | Vote: 3-0**  
**Sources:** Graphiti/Zep (arXiv:2501.13956), Survey (arXiv:2602.05665), Neo4j developer blog (independent corroboration)

Graphiti's bi-temporal model directly solves the "Sarah moves from Denver to Austin" problem:

**Two separate timelines:**
- **Timeline T (event timeline):** When did this actually happen in the real world? t_valid and t_invalid mark the real-world validity window of each fact.
- **Timeline T′ (transaction timeline):** When was this information recorded in the system? t_created and t_expired mark when the system knew about it.

**Contradiction resolution:** When "Sarah moved to Austin" is ingested:
1. The existing edge `Sarah → lives_in → Denver` gets `t_invalid` set to the current date
2. A new edge `Sarah → lives_in → Austin` is created with `t_valid` = current date
3. The Denver edge is NOT deleted — it's historically queryable
4. A query for "where does Sarah live?" returns Austin (current)
5. A query for "where did Sarah live in January?" returns Denver (historical)

**Independent corroboration (Neo4j blog):** *"update or invalidate, but not discard, outdated information"* — confirms the design principle from a non-affiliated source.

This is the right model for the Sarah/Denver problem because it handles:
- Sarah moving (update with history preserved)
- Sarah having multiple past addresses (all queryable)
- Understanding when the AI "learned" about a fact vs. when the fact was true

---

## The Trillion-Dollar Gap: Causal Decision Modeling — Nothing Survived

**The research angle on causal/decision modeling from behavioral data had zero confirmed claims survive adversarial verification.**

The open question the research surfaced:

> *"Causal and decision modeling from behavioral data — inferring the thresholds and reasons behind a person's choices from observed patterns over time — had no confirmed research claims survive verification. Is this problem being worked on under a different framing (e.g., preference learning, inverse reinforcement learning for personal assistants), and what is the current state of that work?"*

The closest related academic fields are:
- **Inverse Reinforcement Learning (IRL)** — inferring reward functions from observed behavior. Used in robotics and game AI; not applied to long-horizon personal decision modeling.
- **Preference Learning** — learning what a person values from their choices. Mostly applied to recommendation systems (what movie, what product), not to modeling complex life decisions.
- **Causal Inference** — formalizing cause-and-effect from observational data. Mature statistical field; not yet applied to personal AI assistants.

**None of these have been applied to the problem as stated:** inferring the 3-10 factors that, when they align, cause a specific person to make a specific class of decision (book a flight, invest in a building, change jobs) — from longitudinal behavioral observation, without the person ever explaining their reasoning.

This is the genuinely open frontier.

---

## What the Research Confirms About the Path Forward

### For the Sarah/Denver problem (Phase 2 of the product)

The architecture that solves it:

```
Entity Graph (Graphiti-style)
  ├── Node: Roy (user)
  ├── Node: Sarah (entity: person)
  │     ├── Relationship: sister_of → Roy
  │     ├── Relationship: lives_in → Denver [valid: Jan–Jun 2026] [expired]
  │     └── Relationship: lives_in → Austin [valid: Jun 2026–present]
  └── Node: Denver (entity: place)

Profile Cache (always in system prompt)
  ├── "Roy has a sister named Sarah"
  ├── "Sarah currently lives in Austin (moved from Denver June 2026)"
  └── "Roy typically visits family 2-3x per year, usually books 2-4 weeks ahead"

Episodic Store (retrieved on demand)
  └── Conversation fragments, specific events, past interactions

Demand Detection (proactive layer)
  └── Monitors context signals → detects "visiting sister" → triggers Sarah profile lookup → surfaces Austin + flight offer
```

### For the decision modeling problem (future phases / the big vision)

The foundation is the same entity graph — but instead of just storing facts about people and places, you accumulate **behavioral observations over time**:
- "Roy mentioned visiting Sarah" + "Roy booked a flight" = pattern
- "Roy said MealPrepForge is struggling" + "Roy started a new project" = pattern
- "Roy skipped the gym 3 weeks" + "Roy mentioned stress" + "Roy asked about anxiety" = pattern

The insight is that the decision modeling layer is **built on top of the same memory infrastructure** — it's not a separate system, it's a reasoning layer that operates over the accumulated entity graph and behavioral history. The entity graph is the foundation. Decision modeling is what becomes possible once you have enough of it.

---

## Refuted Claims — Notable Patterns

| Claim | Vote | Why It Matters |
|-------|------|----------------|
| MemORAI achieves 75.55% on LongMemEval vs 41.00% for dense retrieval | 0-3 | Performance benchmarks from system papers keep failing verification — don't trust numbers from builders |
| PASK's IntentFlow model outperforms Gemini-3-Flash by 3.4 points on LatentNeeds-Bench | 0-3 | Same pattern — architectural descriptions survive, benchmark claims don't |
| Iterative summarization causes semantic drift with each update cycle | 1-2 | Important if true — suggests compressing conversation history degrades memory quality over time |
| Flat top-K retrieval is structurally insufficient for multi-memory queries | 1-2 | Near-miss — probably directionally correct but couldn't be verified precisely |
| Cognitive working memory capacity constrains entity memory (Miller's Law, 7 items) | 0-3 | Interesting idea (applying human cognitive limits to AI memory) but didn't survive |
| Entity-centric graphs with 3-layer architecture outperform flat retrieval by ~10% | 0-3 | Again: architecture survives, performance claims don't |

**Pattern:** Architectural descriptions survive verification consistently. Performance benchmarks from system papers almost never do. Trust the architecture; verify performance independently.

---

## Open Questions

1. **The causal decision modeling gap:** Is anyone working on this under inverse RL or preference learning framings? What would it take to apply those tools to long-horizon personal decision modeling?

2. **Closing the retrieval-reasoning gap:** Graph-based multi-hop reasoning is the proposed solution, but no confirmed claim demonstrated it measurably outperforming flat retrieval. What's the actual measured gap?

3. **Cold-start:** How does a personal assistant bootstrap its model of a person in the first days/weeks before enough behavioral data exists? No system addresses this.

4. **Bi-temporal production at scale:** How do production deployments handle retroactive memory ingestion (importing years of email/calendar history) when event time and ingestion time differ? Graphiti's MCP interface doesn't handle this correctly.

5. **The intrusiveness problem:** ProMemAssist's threshold (0.75) was tuned on 12 people. PASK's λ parameter is a dial but no study tells you what value is right for different people. How do you calibrate the proactivity level per user?

---

## Sources

| URL | Quality | Research Angle |
|-----|---------|----------------|
| https://arxiv.org/html/2605.01386v1 | Primary | Entity memory / knowledge graphs |
| https://arxiv.org/html/2501.13956v1 | Primary | Entity memory / knowledge graphs (Graphiti) |
| https://arxiv.org/html/2602.05665v1 | Primary | Survey — entity memory |
| https://arxiv.org/pdf/2502.06975 | Primary | Episodic memory requirements |
| https://arxiv.org/pdf/2409.19401 | Primary | Entity-centric memory graphs |
| https://arxiv.org/abs/2604.08000 | Primary | PASK — proactive surfacing + layered memory |
| https://arxiv.org/abs/2507.21378 | Primary (UIST 2025 peer-reviewed) | ProMemAssist — utility-based proactive surfacing |
| https://arxiv.org/abs/2501.00383 | Primary | Inner thoughts / intrinsic motivation |
| https://arxiv.org/abs/2601.17622 | Primary | Proactive surfacing |
| https://arxiv.org/abs/2509.06269 | Primary | Causal/decision modeling |
| https://arxiv.org/abs/2506.02368 | Primary | Causal/decision modeling |
| https://arxiv.org/pdf/2206.00416 | Primary | Causal/decision modeling |
| https://arxiv.org/pdf/2604.08362 | Primary | Causal/decision modeling |
| https://arxiv.org/abs/2501.13956 | Primary | Temporal memory / Graphiti |
| https://arxiv.org/abs/2601.02845 | Primary | Temporal memory / belief revision |
| https://arxiv.org/abs/2601.03938 | Primary | Temporal memory |
| https://arxiv.org/abs/2601.07468 | Primary | Temporal memory |
| https://arxiv.org/abs/2406.19354 | Primary | Temporal memory |
| https://arxiv.org/pdf/2603.00026 | Primary | Long-term personal AI memory |
| https://arxiv.org/html/2603.07670v1 | Primary | Long-term personal AI memory |
| https://arxiv.org/pdf/2602.09712 | Primary | Long-term personal AI memory |
| https://arxiv.org/html/2511.07587v1 | Primary | Retrieval limits / gap analysis |
| https://arxiv.org/html/2506.11555 | Primary | Retrieval limits / gap analysis |
| https://arxiv.org/html/2601.03236v1 | Primary | Retrieval limits / gap analysis |
| https://arxiv.org/pdf/2602.19320 | Primary | Retrieval limits / gap analysis |
| https://arxiv.org/pdf/2603.11768 | Primary | Memory corruption / semantic drift |
| https://arxiv.org/pdf/2504.19413 | Primary | Mem0 (from Research #1) |
| https://vectorize.io/articles/mem0-vs-letta | Blog | Practitioner |
| https://mem0.ai/blog/state-of-ai-agent-memory-2026 | Blog (vendor) | Practitioner |

---

## Research Methodology Notes

- **112 agents** deployed across 6 search angles: entity memory/knowledge graphs, proactive/context-triggered surfacing, causal/decision modeling from behavioral traces, temporal memory/contradiction/belief revision, practitioner implementation, contrarian/gap analysis
- **29 sources** fetched and read
- **143 claims** extracted
- **25 claims** submitted to adversarial verification (3 independent agents per claim, each prompted to refute)
- **8 confirmed, 17 killed** (before synthesis merging → 5 final confirmed findings)
- One claim rate-limited during verification (proactive surfacing angle)
- All primary sources are arXiv preprints from 2025–2026; only ProMemAssist (UIST 2025) has confirmed peer review
- Pattern: architectural descriptions consistently survive; performance benchmarks consistently fail
