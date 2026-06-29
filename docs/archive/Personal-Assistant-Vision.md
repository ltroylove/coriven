# Coriven — Vision & Architecture

**Product Name:** Coriven  
**Date:** 2026-06-22  
**Status:** Active reference document

---

## What This Is

A personal Life OS — an AI assistant that genuinely knows you, manages your life, and gets more valuable the longer you use it. Not a task manager, not a chatbot, not a notes app.

The organizing principle is that everything in your life connects upward to a reason it exists. Tasks serve projects. Projects serve goals. Goals serve life areas. The system understands *why*, not just *what*.

---

## How It Actually Works — The Full System

There are five interconnected pieces. None of them is "the product" on its own. The product is what happens when they work together.

### 1. The Chat Interface (with Tool Use)

This is the primary way you interact with the system. You talk to it like a conversation. Behind the scenes, the assistant has access to a set of tools — functions it can call to actually do things in your life.

When you say **"remind me to call mom tomorrow at 3pm"** — the assistant calls `create_task` and `add_reminder`. A task is created. A reminder is scheduled. You don't open a task manager and fill out a form. You just said it.

When you say **"I want to lose 100 lbs this year, it's my biggest priority"** — the assistant calls `create_goal` under your Health life area, sets a target date, and asks what your first concrete step is. A goal now exists in the system with a link to why it matters.

When you say **"draft a reply to Sarah declining tomorrow's meeting"** — the assistant writes the email and calls `submit_for_approval`. It goes into the approval queue. You review and approve it. The system sends it. Nothing leaves without your sign-off.

The assistant doesn't just answer questions. It creates, updates, organizes, and acts — all through the conversation, all with your awareness.

### 2. Task and Goal Management

Everything the assistant creates through conversation lives in a structured database:

```
Life Area  →  Goal  →  Project  →  Task  →  Reminder
  Health        Lose       Gym           Go to       Tuesday
                100 lbs    Routine       gym           6am
```

Tasks have priorities, due dates, and statuses. Goals have momentum indicators — improving, stable, or declining — that the assistant updates based on what you're actually doing. Projects group related tasks under a goal.

This structure means the system always knows not just *what* you need to do but *why* it matters. When the gym task is stalling, the system knows it's connected to a goal you said was your biggest priority. That context changes how it nudges you.

You can interact with all of this through chat ("what tasks do I have this week?", "mark that done", "I'm not going to pursue that goal anymore") or through the web UI directly. Both are always in sync.

### 3. The Tray Daemon (Local, Always On)

A small background process runs on your machine. It is how the system reaches you without requiring you to have a browser open.

**Reminders:** Every 5 minutes it checks for due reminders and fires a Windows notification with Snooze and Dismiss options. You set a reminder through chat. The tray delivers it.

**Daily briefing:** Every morning at 7am, the system generates a briefing — your active goals and their momentum, tasks due today, anything urgent from email (Phase 4), today's calendar (Phase 4). The tray delivers it as a notification. You start your day with a picture of what matters without having to ask for it. The briefing fires on day one with whatever exists in the system — sparse at first, richer every day after.

**Approval alerts:** When an action is waiting for your approval — a drafted email, a calendar event — the tray tells you. You open the approvals page, review, and decide.

The tray is how the system is proactive. It comes to you. You don't have to remember to check it.

**On mobile:** The tray daemon is Windows-specific for the personal build. When the product is opened to other users (Phase 6), the same notification delivery layer runs via Web Push Notifications through a PWA — no app store required. The architecture is identical; the delivery surface changes per platform.

### 4. The Approval Queue

Every action the assistant wants to take in the external world stops here first. The assistant proposes. You decide. Only after you approve does anything happen.

Not everything requires approval — the assistant owns its own domain freely:

| Action | Approval needed? |
|--------|-----------------|
| Create / update tasks and reminders | No |
| Create goals and projects | No |
| Save memories and entity profiles | No |
| Draft an email or document | No — drafting isn't acting |
| Send an email | Yes |
| Create a calendar event | Yes |
| Delete any record | Yes |
| Make a purchase or API call | Yes |

The rule: if it stays inside the assistant's own domain, no approval needed. If it reaches into the external world and changes something, approval required. No exceptions.

The approval queue is a page in the app where pending actions wait. Each one shows what the assistant wants to do and why. You approve or reject. An immutable audit log records every decision and execution. Nothing external ever happens silently.

This is not just a safety feature. It is the architecture of trust. The assistant becomes more useful over time precisely because you can trust it completely.

### 5. Workflows (External Execution)

Once an action is approved, something has to actually execute it. Sending an email means calling the Gmail API. Creating a calendar event means calling Google Calendar. This execution layer is handled by a workflow engine (n8n, or equivalent) that receives approved actions and carries them out.

The separation is intentional: the assistant proposes, the user approves, the workflow executes. The assistant never has direct write access to your external accounts. The workflow layer only receives a validated, approved action descriptor — never raw AI output, never untrusted content.

---

## The Memory Layer — The Sentinel

Underneath all five pieces above is the memory system. This is what makes the whole thing compound in value over time.

Every AI assistant resets when the conversation ends. You re-explain yourself every session. This system does not.

**The Sentinel** is a background process that runs alongside every conversation. When you send a message, the Sentinel fires in parallel — it doesn't block the response. While you're reading the assistant's reply, the Sentinel is processing what you just said:

- You mentioned your sister Sarah — entity profile updated
- You said you prefer morning workouts — preference saved
- You mentioned MealPrepForge — project entity noted

It builds a context package from everything it knows about you and has it ready before your next message arrives. The main assistant model never reads raw conversation history. It only sees the Sentinel's curated picture of who you are and what's relevant right now, plus the last few messages for immediate context.

The first conversation has no context — identical to any AI assistant today. After a week of daily use, the Sentinel knows your people, your projects, your preferences. After a month, it knows how you think. The value compounds.

**Entity profiles** are how the Sentinel remembers the people and things in your life — not as isolated text fragments but as structured profiles:

*Sarah: your sister, lives in Denver (moved from Austin June 2026), currently job hunting, last mentioned three days ago*

When you say "I'm visiting my sister," the assistant already knows who that is and where she lives. It doesn't search for a matching text fragment. It has a model.

**The Sentinel is not the product.** It is the memory infrastructure that makes the product smarter over time. The tasks, goals, reminders, briefings, and approval flows are the product. The Sentinel is what makes those things feel like they know you.

---

## What a Day Actually Looks Like

**7:00am** — A tray notification arrives: *Good morning. Your gym goal has been improving — you've hit 4 of 5 sessions this week. Two tasks due today: expense report (urgent), dentist appointment confirmation. One email needs action.*

**8:30am** — You open the app and chat: *"What did I say my gym goal was about?"* The assistant answers from memory without you re-explaining anything.

**12:00pm** — You chat: *"I need to reschedule tomorrow's meeting with Marcus, draft an email."* The assistant writes it and puts it in the approval queue. You review and approve. It sends.

**3:00pm** — A tray notification: *Reminder: call mom.* You dismiss it or snooze 1 hour.

**Friday 5pm** — A tray notification: *Your weekly review is ready.* Wins from the week, things that stalled, what next week should focus on — generated automatically from your task and goal history.

---

## The Problem This Solves Better Than Anything Else

**The sister problem.** You mention your sister Sarah lives in Denver once in January. In March you say "I'm visiting my sister." The assistant says "Do you want me to look at flights to Denver?" — without being told again. Because the Sentinel built a profile of Sarah.

**The window problem.** You said "I prefer Coke over Pepsi" in January. In March you say "I need to order a drink." The assistant knows what you want — because that preference was saved to the memory store and retrieved by the Sentinel, not lost when the conversation window closed.

**The re-explaining problem.** Every time you open ChatGPT you start from zero. Every time you open this, the Sentinel has everything it has ever learned about you ready and waiting. You never re-explain yourself.

**The stale goal problem.** You set a goal, feel motivated for two weeks, then life happens. Most systems let goals die silently. This system notices when a goal has had no activity for a week and tells you. It can't force you to act — but it won't let you forget that you said it mattered.

---

## The Bigger Vision

The memory layer accumulates something unusual over time: a structured, timestamped record of how a person thinks, decides, and behaves — across tasks, goals, conversations, and actions.

From that foundation a different question eventually becomes possible: not "what does this person know?" but "why do they make the decisions they make?"

Patterns emerge from behavior over time. If you can identify the signals that precede a decision — the factors that, when they converge, cause a person to act — you can begin to anticipate decisions before they're made. You can help people understand their own patterns in ways they cannot see from inside them.

The same applies to organizations. The factors that cause a business to invest in a new building may be 3 things or 10 things. They may not seem related. But when they align, a decision happens. Understanding those edges — from observed behavior rather than stated rules — is a capability that does not yet exist.

This is not a near-term feature. It requires months of data first. But the architecture being built now is exactly the foundation it requires. Every design choice either enables or forecloses this future.

---

## What Makes This Different

| Capability | This | Everything else |
|---|---|---|
| Remembers you permanently across sessions | Yes | No or fragmented |
| Entity profiles — people, places, projects | Yes | No |
| Async sentinel building context continuously | Yes — novel | No |
| Goal hierarchy connecting tasks to why they exist | Yes | No |
| Proactive daily briefing from goals + tasks + memory | Yes | No |
| Approval gates on every external action | Yes | Rare |
| Tray notifications without requiring browser open | Yes | No |
| Value that compounds over months of use | Yes | No |

The early experience is good. The six-month experience doesn't exist anywhere else.

---

## What This Is Not

- A business intelligence tool — entities are personal (people in your life, your projects)
- A system that monitors the web or polls external data sources
- An autonomous agent that acts without user approval
- Something optimized to impress on day one at the cost of long-term value
- A general-purpose research assistant (web search can be added as a tool but is not the core)
