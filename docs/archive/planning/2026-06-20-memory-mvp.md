# Memory Layer — What To Build Now

**Date:** 2026-06-20  
**Status:** Active — Phase 2 implementation guide  
**Informed by:** Research docs in `docs/research/`  
**Scope:** MVP memory that is genuinely useful on day one, without over-engineering

---

## The One Thing Memory Has To Do

When you mention your sister Sarah lives in Denver in January, and in March you say you're visiting your sister, the assistant should say: *"Would you like me to look at flights to Denver?"*

That's the bar. Everything in this document is in service of that.

---

## What The Research Tells Us To Do Differently From The Original Plan

The original Phase 2 design (flat `memories` table + pgvector similarity search) is a good start but has two gaps the research exposed:

**Gap 1: Facts, not entities.**  
Storing "Sarah lives in Denver" as a text fact works for direct recall ("where does Sarah live?") but fails for implicit connections ("I'm visiting my sister"). The AI needs to know Sarah is *an entity* — Roy's sister — not just a text fragment about Denver.

**Gap 2: Retrieval, not reasoning.**  
Semantic search returns memories that look like your current message. "I'm visiting my sister" doesn't look like "Sarah lives in Denver." The model needs the Sarah profile already in context so it can reason across it — not hope that similarity search makes the right connection.

**The fix is simpler than the research makes it sound:** add a lightweight entity profile layer that stays in the system prompt always, alongside the existing similarity retrieval. No graph database needed. No bi-temporal complexity. Just structured profiles for the people and things the user mentions, always in context.

---

## MVP Architecture — Three Layers

### Layer 1: Entity Profiles (new — always in system prompt)

A small structured store of the people, places, and recurring things in the user's life. Loaded on every request. Not retrieved — always present.

```
People:
  Sarah — sister, lives in Denver, mentioned Jan 2026
  Mom — lives in Phoenix, health issues (hip surgery Mar 2026)
  
Places:
  Office — downtown, 3 days/week
  Gym — Planet Fitness on Oak St

Recurring things:
  MealPrepForge — user's website project, do not modify
  Personal Assistant — this project
```

This is what the model reasons over for the Sarah/Denver connection. It's always there. No retrieval needed.

**How it stays current:** Claude updates entity profiles the same way it saves memories — via tool call when it learns something new or when something changes. When Sarah moves, the old location is noted as previous: "was Denver, now Austin as of Jun 2026." No deletion.

**What goes here:** Relationships, locations, recurring projects, key preferences. Things that are stable and important. Keep it small — aim for under 500 tokens total. It's always in the prompt, so it has to earn its spot.

### Layer 2: Semantic Memory (existing plan, unchanged)

The `memories` table with pgvector. Facts that don't belong in the entity profile — specific events, one-off details, things that were said once. Retrieved by similarity search on every message.

This stays exactly as designed in the original Phase 2 plan. The research validated the approach (Mem0-style LLM-driven ADD/UPDATE/DELETE/NOOP is the right mechanism — the model decides what to do with a new fact rather than a separate classifier).

One addition: when saving a memory that contradicts an existing one, **mark the old one superseded** rather than deleting it. Add a `superseded_by` nullable FK column. Old facts don't disappear — they just stop being retrieved by default.

### Layer 3: Conversation Summaries (existing plan, unchanged)

The `conversation_summaries` table. After ~20 turns or session end, generate a summary. Inject the last 3 summaries as context. Provides continuity without re-reading full history.

No changes needed here.

---

## What This Looks Like In The System Prompt

Every Claude request gets this injected before the user's message:

```
## What I know about you

### People & places in your life:
- Sarah: your sister, lives in Denver
- Mom: lives in Phoenix, recovering from hip surgery (March 2026)
- MealPrepForge: your website — you've asked me not to modify it

### Facts I've learned:
- [top 5 semantically similar memories to this message]

### Recent context (last 2 session summaries):
- [summary 1]
- [summary 2]
```

When the user says "I'm visiting my sister," Sarah and Denver are already in the system prompt. The model doesn't need to retrieve them — it reasons over what it already sees.

---

## What To Build — Task By Task

### Database

```sql
-- Entity profiles table (new)
entity_profiles (
  id           uuid  PK DEFAULT gen_random_uuid(),
  user_id      uuid  NOT NULL → auth.users.id,
  name         text  NOT NULL,           -- "Sarah"
  type         text  NOT NULL,           -- "person" | "place" | "project" | "thing"
  description  text  NOT NULL,           -- "Roy's sister, lives in Denver"
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
)

-- Add superseded_by to memories table
ALTER TABLE memories ADD COLUMN superseded_by uuid REFERENCES memories(id);
-- Retrieval query excludes superseded: WHERE superseded_by IS NULL
```

### Tools (additions to existing registry)

| Tool | What it does |
|------|-------------|
| `upsert_entity` | Create or update an entity profile. Input: `{name, type, description}`. Merges with existing if name matches. |
| `list_entities` | Return all entity profiles for the user. Used internally for system prompt injection. |

The existing `save_memory` tool handles the semantic memory layer. Add one behavior: before saving, check if any existing memory contradicts the new one. If yes, save the new one and set `superseded_by` on the old one.

### Context Injection (modification to chat engine)

In `apps/web/src/lib/chat/engine.ts`, the system prompt builder gets a new step:

```typescript
// Before every Claude call:
const entities = await listEntities(userId)          // always loaded
const memories = await retrieveMemories(userId, message)  // similarity search
const summaries = await getRecentSummaries(userId, 2)     // last 2 sessions

const systemContext = buildMemoryContext(entities, memories, summaries)
// prepend to system prompt
```

### Memory Settings Page (`/memory`)

Keep exactly as planned in original Phase 2 — list stored memories, edit, delete. Add a second tab for entity profiles: list entities, edit descriptions, delete. Simple CRUD. The user should be able to see and correct what the assistant knows about them.

---

## What We Are NOT Building Yet

| Thing | Why not now |
|-------|-------------|
| Graph database (Neo4j/Graphiti) | Entity profiles in a Postgres table give 80% of the value at 5% of the complexity |
| Bi-temporal tracking | Simple `superseded_by` FK handles "Sarah moved" without full dual-timeline machinery |
| Demand detection module | Claude reasoning over the always-loaded entity profile handles the Sarah/Denver case without a separate detection system |
| Causal decision modeling | Far future — needs months of data first anyway |
| Memory decay / Bayesian updates | Start simple: manual edits + supersession. Add decay later when we know what's actually going stale. |

The research confirmed these are the right long-term directions. They are not the right now-direction.

---

## Acceptance Criteria (same session, different conversation)

- [ ] Say "my sister Sarah lives in Denver" in Conversation A
- [ ] In Conversation B, say "I'm going to visit my sister" — assistant responds mentioning Denver without being told
- [ ] Say "Sarah moved to Austin" in Conversation C — assistant updates the entity profile, no longer mentions Denver for Sarah
- [ ] `/memory` page shows the Sarah entity and the current description
- [ ] Editing the description in `/memory` is reflected in the next conversation immediately

---

## Implementation Order

1. DB migration: `entity_profiles` table + `superseded_by` on `memories`
2. `upsert_entity` and `list_entities` tools
3. Context injection in chat engine (entity profiles + existing memory retrieval)
4. Update `save_memory` handler to check for contradictions and set `superseded_by`
5. `/memory` page — memories tab (existing plan) + entities tab (new)

This is roughly 1 week of focused work on top of the Phase 1 completion.

---

## The Bigger Picture (Noted, Not Acted On)

The research confirmed that the entity graph + temporal memory we're building here is the exact foundation that more sophisticated capabilities (proactive surfacing, eventually decision modeling) would sit on top of. We are building the right thing. We're just building the right-sized version of it for now.

When we have real data from real daily use, we'll know what to add next.
