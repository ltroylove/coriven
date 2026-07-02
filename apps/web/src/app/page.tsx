import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import s from './landing.module.css'

export default async function Home() {
  const db = await createAuthServerClient()
  const { data: { user } } = await db.auth.getUser()
  if (user) redirect('/tasks')

  return (
    <div className={s.root}>

      {/* Nav */}
      <nav className={s.nav}>
        <Link href="/" className={s.navLogo}>Coriven<span>.</span></Link>
        <ul className={s.navLinks}>
          <li><a href="#features">Features</a></li>
          <li><a href="#how">How it works</a></li>
        </ul>
        <Link href="/signin" className={s.navSignin}>Sign in</Link>
      </nav>

      {/* Hero */}
      <section className={s.hero}>
        <div className={s.container}>
          <h1 className={s.heroH1}>
            Your goals, your people,<br />your life — <em>connected.</em>
          </h1>
          <p className={s.heroSub}>
            Knows your people. Remembers your context. Connects what you&apos;re doing to the goals behind it.
          </p>
          <div className={s.heroBadges}>
            <div className={s.badge}>
              <div className={`${s.badgeDot} ${s.badgeDotGreen}`} />
              Memory that compounds over time
            </div>
            <div className={s.badge}>
              <div className={`${s.badgeDot} ${s.badgeDotBlue}`} />
              Powered by Claude
            </div>
            <div className={s.badge}>
              <div className={`${s.badgeDot} ${s.badgeDotOrange}`} />
              You stay in control
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className={s.problem}>
        <div className={s.container}>
          <div className={s.problemHeader}>
            <div className={s.sectionLabel}>The problem</div>
            <h2>Your tools don&apos;t know<br />what you&apos;re trying to do.</h2>
            <p>You have tasks in one app, notes in another, conversations scattered across ten threads — and none of it connects to the actual goals that matter to you.</p>
          </div>
          <div className={s.problemGrid}>
            <div className={s.problemCard}>
              <div className={s.icon}>🗂️</div>
              <h4>Context disappears</h4>
              <p>Every new conversation starts from zero. Your assistant forgets who Sarah is and why the project matters.</p>
            </div>
            <div className={s.problemCard}>
              <div className={s.icon}>🔗</div>
              <h4>Nothing is connected</h4>
              <p>Your tasks don&apos;t know your goals. Your goals don&apos;t know your schedule. Nothing talks to anything else.</p>
            </div>
            <div className={s.problemCard}>
              <div className={s.icon}>🔄</div>
              <h4>You repeat yourself constantly</h4>
              <p>You re-explain your preferences, your situation, your people — every time, to every tool.</p>
            </div>
            <div className={s.problemCard}>
              <div className={s.icon}>📉</div>
              <h4>Tools don&apos;t compound</h4>
              <p>The longer you use most tools, the more cluttered they get. They should get smarter. They don&apos;t.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Solution / Features */}
      <section className={s.solution} id="features">
        <div className={s.container}>
          <div className={s.solutionIntro}>
            <div className={s.sectionLabel}>The solution</div>
            <h2>An assistant that <em>knows</em> you.<br />Not just what you asked.</h2>
            <p>Coriven builds a structured picture of your life — your people, your projects, your preferences — and uses it as the context for everything it does for you.</p>
          </div>

          <div className={s.featuresGrid}>

            {/* Memory — wide */}
            <div className={`${s.featureCard} ${s.featureCardWide}`}>
              <div className={s.featureTag}>Memory</div>
              <div className={s.featureIcon} style={{ background: 'rgba(124,106,247,0.15)' }}>🧠</div>
              <h3>Memory that compounds</h3>
              <p>Coriven&apos;s Sentinel engine listens to every conversation and quietly builds a structured record of what matters — people, places, projects, preferences, facts about your life. The longer you use it, the more it knows. Context is never lost between sessions.</p>
              <div className={s.chatPreview}>
                <div className={s.chatMsg}>
                  <div className={`${s.chatAvatar} ${s.chatAvatarUser}`}>Y</div>
                  <div className={s.chatBubble}>Remind me to call my sister before her flight</div>
                </div>
                <div className={s.chatMsg}>
                  <div className={`${s.chatAvatar} ${s.chatAvatarAi}`}>C</div>
                  <div className={s.chatBubble}><strong>Got it.</strong> Reminder set for tomorrow at 9am — before Sarah&apos;s 11am departure to Denver. Want me to add anything to talk about?</div>
                </div>
              </div>
            </div>

            {/* Tasks */}
            <div className={s.featureCard}>
              <div className={s.featureTag} style={{ color: '#3DD68C', background: 'rgba(61,214,140,0.1)' }}>Tasks</div>
              <div className={s.featureIcon} style={{ background: 'rgba(61,214,140,0.1)' }}>✓</div>
              <h3>Tasks and reminders, unified</h3>
              <p>Create, update, and manage tasks through conversation. Reminders are built in — not a separate concept. Set them once, adjust them naturally.</p>
            </div>

            {/* Chat */}
            <div className={s.featureCard}>
              <div className={s.featureTag} style={{ color: '#5BA3F5', background: 'rgba(91,163,245,0.1)' }}>Chat</div>
              <div className={s.featureIcon} style={{ background: 'rgba(91,163,245,0.1)' }}>💬</div>
              <h3>Claude-powered assistant</h3>
              <p>Every conversation runs on Claude with your full memory context loaded. It&apos;s not a generic chatbot — it&apos;s an assistant that already knows your situation.</p>
            </div>

            {/* Entities */}
            <div className={s.featureCard}>
              <div className={s.featureTag} style={{ color: '#F58D42', background: 'rgba(245,141,66,0.1)' }}>Entities</div>
              <div className={s.featureIcon} style={{ background: 'rgba(245,141,66,0.1)' }}>👥</div>
              <h3>People, places, and projects</h3>
              <p>Coriven builds profiles for the entities that matter in your life. Names, aliases, context, relationships — structured and always available.</p>
            </div>

            {/* Constraints */}
            <div className={s.featureCard}>
              <div className={s.featureTag} style={{ color: '#E06BAD', background: 'rgba(224,107,173,0.1)' }}>Constraints</div>
              <div className={s.featureIcon} style={{ background: 'rgba(224,107,173,0.1)' }}>🔒</div>
              <h3>You stay in control</h3>
              <p>Set behavioral constraints that the assistant must always respect — locked rules that can&apos;t be overridden, no matter what. Your boundaries, enforced at the engine level.</p>
            </div>

            {/* Goal hierarchy — full width */}
            <div className={`${s.featureCard} ${s.featureCardFull}`}>
              <div className={s.featureCardFullLeft}>
                <div className={s.featureTag} style={{ color: '#A89BFF', background: 'rgba(168,155,255,0.1)' }}>Goals</div>
                <div className={s.featureIcon} style={{ background: 'rgba(168,155,255,0.1)' }}>🎯</div>
              </div>
              <div>
                <h3>Goal hierarchy</h3>
                <p style={{ maxWidth: 560 }}>Connect every task and project upward to the goal it serves. Know whether your actions are actually serving your intentions — not just your to-do list. The feature that turns a productivity tool into a reasoning engine for your life.</p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* How it works */}
      <section className={s.how} id="how">
        <div className={s.container}>
          <div className={s.howHeader}>
            <div className={s.sectionLabel}>How it works</div>
            <h2>Simple to start.<br />Gets better over time.</h2>
            <p>No setup required. Just start talking. Coriven builds context automatically from every conversation.</p>
          </div>
          <div className={s.steps}>
            <div className={s.step}>
              <div className={s.stepNum}>Step 01</div>
              <div className={s.stepAccent} style={{ background: '#7C6AF7' }} />
              <h3>Just start talking</h3>
              <p>No configuration, no onboarding form, no tagging system. Open Coriven and tell it what you need. It handles the rest.</p>
            </div>
            <div className={s.step}>
              <div className={s.stepNum}>Step 02</div>
              <div className={s.stepAccent} style={{ background: '#3DD68C' }} />
              <h3>It learns as you go</h3>
              <p>Every message — yours and Coriven&apos;s — is analyzed for facts, people, and context. Your memory grows automatically in the background.</p>
            </div>
            <div className={s.step}>
              <div className={s.stepNum}>Step 03</div>
              <div className={s.stepAccent} style={{ background: '#5BA3F5' }} />
              <h3>It compounds over time</h3>
              <p>Week one, it knows your name. Month one, it knows how you think. Month six, it holds a structured record of your life that no other tool can match.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Vision */}
      <section className={s.vision}>
        <div className={s.container}>
          <div className={s.visionBox}>
            <div className={s.visionLabel}>The long game</div>
            <h2>Built to be the last assistant<br />you&apos;ll ever need to set up.</h2>
            <p>Most tools get harder to use as they accumulate data. Coriven gets easier — because everything it learns makes it more useful, more accurate, and more yours. This is what compounding memory looks like in practice.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={s.footer}>
        <div className={s.footerLogo}>Coriven<span>.</span></div>
        <div className={s.footerCopy}>© 2026 Coriven. All rights reserved.</div>
        <div className={s.footerLinks}>
          <Link href="/signin">Sign in</Link>
          <Link href="/privacy">Privacy</Link>
        </div>
      </footer>

    </div>
  )
}
