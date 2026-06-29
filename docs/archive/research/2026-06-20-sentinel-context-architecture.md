# The Sentinel Context Architecture

**Date:** 2026-06-20  
**Status:** Concept — needs research validation (novel vs. prior art)  
**Origin:** Designed through conversation, not derived from literature  
**Next step:** Research run to determine if this has been formalized elsewhere

---

## The Problem It Solves

Every current AI memory approach has a fundamental flaw: they all operate on some version of "last N messages as context." If you said something important at message N+1, it falls off. The context window is a sliding cliff edge.

The Coke/Pepsi problem: you say "I prefer Coke over Pepsi" in January. In March you say "I need to order a drink." A last-N-messages system has no idea what you want. A retrieval system might find it — but only if the retrieval query happens to match. Neither is reliable.

The naive fix — a sentinel agent that injects entities and memories — just moves the problem. Now the sentinel has a context window problem instead of the main model. Same cliff, different cliff edge.

The real fix requires a different mental model entirely.

---

## Core Insight

**The sentinel doesn't have a context window problem because it doesn't use a context window. It reads from a database.**

The full message log, entity profiles, vector memories, relationship graphs — all of it lives in persistent storage. The sentinel queries that storage. It doesn't need to load 1000 messages into its context. It searches them. "What do I know about this person's drink preferences?" is a SQL + vector query, not a scroll-back through conversation history.

The sentinel's output is bounded. Its input is the entire history of the user, accessed as data.

---

## Architecture

### The Main Model Never Sees Raw Conversation History

This is the defining characteristic of this architecture. The main model (Claude Sonnet or equivalent) does not receive a conversation transcript. It receives a curated context package — a structured synthesis of everything the sentinel judged relevant to the current moment.

The sentinel IS the memory system. It decides what the main model needs to know.

### Flow

```
User sends message
        ↓
Sentinel receives message immediately — starts working async
  ↓
  Queries full message log (search, not load — SQL + vector)
  Queries entity profiles
  Queries vector memory store
  Queries relationship graph
  Reads recent conversation summaries
  ↓
  Judges: what is relevant to the current state of this conversation?
  Compresses what was relevant but no longer is
  Expands what is newly relevant
  ↓
Context package built — sits waiting
        ↓
User sends next message
        ↓
Main model gets pre-built package — responds immediately
        ↓
Sentinel receives that message — starts building the next package
```

### Latency Reality

Normal human conversation has gaps of 15 seconds to several minutes between messages. The sentinel on a small fast model (Haiku or equivalent) takes 2–5 seconds to build a context package. In practice the package is almost always pre-built and waiting before the user finishes their next message.

The fallback for rapid-fire replies: use the previous package if the new one isn't ready. No latency penalty — just slightly stale context for that one turn.

Long gaps (user walks away, comes back an hour later) are an opportunity. The sentinel can do deeper work — compress older conversation threads, surface patterns across the session, pre-warm context based on what's likely to come up.

---

## What the Sentinel Does

### On Every Message (Sent or Received)

1. **Extract** — identify any new entities, facts, preferences, or behavioral signals in the message. Save them to the appropriate stores (entity profiles, vector memory, graph).

2. **Query** — search all stores for what's relevant to the current conversation state. This is a database operation, not a context load.

3. **Judge** — decide what to include in the next context package. Apply compression to what's no longer active. Apply expansion to what's newly relevant.

4. **Build** — assemble the context package for the next turn.

### What Goes in a Context Package

```
## Current conversation thread
[Last 3-5 turns verbatim — immediate recency for coherence]

## What's relevant right now
[Entities the sentinel judged active in this conversation]
[Memories the sentinel retrieved as relevant]
[Behavioral preferences that bear on the current topic]

## Persistent user context
[Small stable block: name, timezone, key behavioral rules]
```

The "current conversation thread" is SHORT — just enough for conversational coherence, not a full history. Everything important from older turns is captured in memory stores, not in the raw transcript.

### Compression and Expansion

The context package is not a growing list. It's a living synthesis that changes shape every turn.

**Expansion:** When a new topic emerges or a new entity becomes relevant, the sentinel retrieves what it knows and adds it to the package.

**Compression:** When a topic is resolved or shifts away, the sentinel drops it from the package. The information isn't lost — it's still in storage. It just isn't costing context tokens anymore.

**The Coke/Pepsi example:**
- January: user says "I prefer Coke over Pepsi" → sentinel saves as preference in memory store
- March: user says "I need to order a drink" → sentinel queries preferences for beverage context → finds Coke preference → injects it into context package
- Main model knows to say Coke
- Doesn't matter if the original statement was 3 messages ago or 3000. It's in the store, not in the window.

---

## What the Sentinel Has Access To

The sentinel is not a simple retriever. It has access to everything:

| Store | Contents | Query method |
|-------|----------|-------------|
| Full message log | Every sent and received message ever | SQL + vector search |
| Entity profiles | People, places, projects, things the user mentions | SQL lookup by name/type/relationship |
| Vector memory | Facts, preferences, one-off details | Semantic similarity search |
| Relationship graph | How entities connect to each other | Graph traversal |
| Conversation summaries | Compressed summaries of past sessions | SQL + recency |
| Behavioral context | Rules, constraints, patterns | SQL lookup by category |

The sentinel chooses which stores to query based on the current message. Not all stores need to be queried every turn.

---

## Why This Is Different From Existing Approaches

### vs. RAG (Retrieval-Augmented Generation)
RAG retrieves at query time — when the user asks something. The sentinel runs on every message, including the model's own responses, and builds context proactively. RAG is reactive. The sentinel is proactive.

### vs. MemGPT / Letta
MemGPT gives the main model tools to manage its own memory — the main model decides when to save and retrieve. The sentinel removes that burden from the main model entirely. The main model has no memory management responsibility. It just converses.

### vs. Mem0
Mem0 retrieves memories at query time using similarity search, then injects them into the prompt. It has no async pre-building, no compression logic, and no judgment about what to remove. It only adds, never subtracts.

### vs. PASK demand detection
PASK's demand detection module decides *when* to surface context. The sentinel decides *what* context to surface, replaces it every turn, and builds it asynchronously. PASK detects demand. The sentinel manages the entire context surface.

### The novel combination (to be verified by research)
- Async background operation (not triggered at query time)
- Controls 100% of context — main model never sees raw history
- Reads from database stores, not from its own context window
- Compresses AND expands — subtractive as well as additive
- Context pre-built and waiting before the next message arrives
- Operates on both sent and received messages

---

## What the Main Model Experiences

From the main model's perspective, every conversation turn simply has good context. It doesn't know the sentinel exists. It doesn't manage memory. It doesn't decide what to retrieve. It just has what it needs.

This is the goal: a model that converses as if it genuinely knows you, without doing any memory work itself. The memory work happens elsewhere, asynchronously, invisibly.

---

## Open Design Questions

These are unresolved — to be worked through as implementation approaches:

1. **Context package format** — structured sections vs. natural language synthesis vs. hybrid?

2. **Sentinel model choice** — Haiku for speed/cost, or does the judgment required need something more capable? Probably Haiku for extraction/retrieval, possibly a step up for synthesis/judgment.

3. **How to handle the sentinel being mid-build when a message arrives** — use previous package, wait briefly, or deliver partial package?

4. **What triggers deeper vs. shallower sentinel work?** — Short message = light pass. Long gap = deeper compression and pattern work. What are the rules?

5. **How does the sentinel handle the first few messages (cold start)?** — No prior context exists. Sentinel delivers minimal package and builds from there.

6. **Multi-device / multi-session** — If the user is on mobile and desktop simultaneously, or switches sessions, how does the sentinel maintain coherence?

7. **The sentinel's own context window** — Even though the sentinel reads from a database, it still has to reason within a context window to build the package. For a very long-tenured user with thousands of entities, does the synthesis step itself hit limits? Probably not for years, but worth noting.

---

## Relation to the Bigger Vision

This architecture is the foundation that makes everything else possible. The decision modeling vision — inferring why a person makes the choices they do — requires exactly this: a system that has been accumulating structured observations about a person across every interaction, organized into queryable stores, with a reasoning layer that can synthesize across them.

The sentinel isn't just a context manager. It's the thing that, over months and years of use, builds the richest possible model of who you are and how you think. Every message it processes is a data point. Every inference it makes is refinable. The value compounds.

The personal assistant is the wedge product. The sentinel architecture is what makes it worth building.

---

## Research Findings — Prior Art Analysis

**Research run:** 2026-06-20 | 103 agents | 21 sources | 104 claims | 14 confirmed | 11 killed

### Verdict: The five-part combination does not exist under any named architecture as of mid-2026.

The research searched exhaustively across academic literature, named systems, and practitioner sources. No system satisfies all five criteria simultaneously. The specific combination appears to be novel prior art territory.

### Closest Prior Art

**AdaCoM (arXiv:2605.30785, May 2026) — satisfies criterion 2 only**

The nearest match on external context control. AdaCoM uses a separate external LLM that intercepts and rewrites conversation history before the main agent sees it. The main agent acts only on `c̃_{t-1}` (managed context), never on raw history. Its modification actions are delete, rewrite, and merge.

Where it diverges from the sentinel pattern:
- Synchronous and reactive — triggered after each observation, not async
- Reads from in-context accumulated history, not a persistent database
- No pre-building — context is assembled at query time, not before
- Explicitly scoped to single long-horizon tasks, not cross-session memory

**ProMem (arXiv:2601.04463, January 2026) — satisfies criterion 1 only**

The only confirmed system where memory operations run as a genuine async background process that does not block user interaction. Verbatim from Section 3.5: *"memory extraction is typically an asynchronous background process. Unlike real-time response generation, it does not block user interactions."*

Where it diverges:
- Does not control 100% of context to the main model — enriches retrieval stores only
- No pre-built context packages waiting for the next message
- No compression/expansion judgment layer

**MemGPT (arXiv:2310.08560, October 2023)**

Foundational prior art for the conceptual framing — introduced "virtual context management" and the OS-paging analogy (main context as RAM, external storage as disk). But it is a single-agent architecture: the main LLM itself issues function calls to manage its own memory. There is no separate background agent. Memory management is self-directed, not externally controlled.

**ARC (ICLR 2026) and Focus (January 2026)**

Both use in-loop synchronous context management. Neither uses a separate background agent, persistent database stores, or proactive pre-building. Focus operates entirely within the conversation window; ARC uses reflection-driven monitoring but executes synchronously at each turn.

**Sculptor (ICLR 2026)**

Gives the main LLM reversible context manipulation tools (fragment, summarize, fold/restore). Self-managed by the main model — no background agent. Interesting for the reversible compression/expansion capability, but architecturally opposite: the main model manages its own context rather than having it managed externally.

**Letta "sleep-time agents"** — initially appeared promising, refuted at 0-3 in adversarial verification. Does not implement async proactive context pre-building as described.

### The Gap, Precisely Stated

| Criterion | AdaCoM | ProMem | MemGPT | ARC/Focus | Sculptor | **Sentinel** |
|-----------|--------|--------|--------|-----------|----------|-------------|
| 1. Async background execution | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| 2. Controls 100% of context | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| 3. Reads from persistent DB | ✗ | ✗ | partial | ✗ | ✗ | ✓ |
| 4. Compresses AND expands | ✓ | ✗ | partial | partial | ✓ | ✓ |
| 5. Pre-builds before next message | ✗ | partial | ✗ | ✗ | ✗ | ✓ |

No system spans all five. The combination has not been named.

### Important Caveats

- The field moves fast — a system satisfying all five may have been published after mid-2026 or exist in unpublished industry infrastructure (OpenAI, Google DeepMind, Anthropic internal systems)
- "No named architecture exists" is a negative claim supported by search absence, not by a paper explicitly stating the gap
- The gap between AdaCoM (criterion 2) and ProMem (criterion 1) suggests the pieces exist — combining them is the novel step

### Suggested Next Step

The most direct path to validating the architecture is to build it, not research it further. The components (async job queue, Haiku for reasoning, existing DB stores) are all available. The combination is new. The way to find out if it works is to run it.
