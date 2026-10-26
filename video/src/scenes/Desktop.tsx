import React from 'react'
import { Easing, interpolate, useCurrentFrame } from 'remotion'

import { DESKTOP as Q, FRAMES } from '../cues.mjs'
import { Accent, Caption, Cursor, Scene, Typed, ease, useSpring } from '../kit'
import { C, MONO } from '../theme'

export const DESKTOP_FRAMES = FRAMES.desktop

/**
 * Claude Code's desktop app, drawn in its own layout (sessions on the left,
 * the conversation, the Live Notebook pane on the right) with made-up
 * sessions and messages.
 */
const WIN = { left: 110, top: 150, width: 1700, height: 870 }
const TITLE = 46
const SIDEBAR = 290
const PANE = 600
const COMPOSER = 64
const VIEW_TOP = TITLE + 22
const VIEW_HEIGHT = WIN.height - VIEW_TOP - COMPOSER - 46
const BUTTON_ROW = 46

type Message = { role: 'user' | 'agent'; height: number; body: React.ReactNode; keep?: true }

const code = (text: string) => (
  <div style={{ marginTop: 12, padding: '12px 16px', borderRadius: 10, background: '#1a1a18', border: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 19, color: '#d7d5cc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
    {text}
  </div>
)

const KEPT_TEXT = 'Retry timeouts with exponential backoff and jitter, and send an idempotency key so a retried charge is never charged twice.'

const BODIES: Array<Omit<Message, 'height'> & { height: number }> = [
  { role: 'user', height: 60, body: 'Why does checkout fail on payment timeouts?' },
  {
    role: 'agent',
    height: 226,
    keep: true,
    body: (
      <>
        <div style={{ fontSize: 27, fontWeight: 700, marginBottom: 6 }}>Retry with backoff</div>
        <div>{KEPT_TEXT}</div>
        {code('await retry(charge, { retries: 5, factor: 2, jitter: true })')}
        <div style={{ marginTop: 12 }}>
          Never retry a <span style={{ fontFamily: MONO, color: C.accent }}>402</span>: it is a real decline, not a blip.
        </div>
      </>
    ),
  },
  { role: 'user', height: 60, body: 'Great. Now fix the flaky date test.' },
  { role: 'agent', height: 70, body: 'It failed after 7 pm because the test crossed midnight in UTC. I froze the clock with fake timers.' },
  { role: 'user', height: 60, body: 'Bump the dependencies too.' },
  { role: 'agent', height: 40, body: 'Done: 14 packages updated, the build is green.' },
  ...[
    'Updated the lockfile.',
    'Renamed the hook to useCart.',
    'Tests pass: 212 of 212.',
    'Added the migration for orders.',
    'Here is the diff for the API client.',
    'The card grid now wraps at 480px.',
    'Removed the unused feature flag.',
    'Rebased onto main; no conflicts.',
    'Opened the pull request.',
    'Lint is clean.',
  ].map((body, i) => ({ role: (i % 3 === 0 ? 'user' : 'agent') as Message['role'], height: i % 3 === 0 ? 60 : 40, body })),
]

/** Every agent reply that ends a turn has the Mod's Save to notebook button under it. */
const MESSAGES: Message[] = BODIES.map(message => ({ ...message, height: message.height + (message.role === 'agent' ? BUTTON_ROW : 0) }))
const GAP = 24
const TOPS = MESSAGES.reduce<number[]>((tops, _, i) => [...tops, i === 0 ? 0 : tops[i - 1] + MESSAGES[i - 1].height + GAP], [])
const KEEP = MESSAGES.findIndex(message => message.keep)
const KEEP_CENTER = TOPS[KEEP] - (VIEW_HEIGHT - MESSAGES[KEEP].height) / 2
const BOTTOM = TOPS[TOPS.length - 1] + MESSAGES[MESSAGES.length - 1].height
const follow = (i: number) => Math.max(0, TOPS[i] + MESSAGES[i].height - VIEW_HEIGHT)

function scrollAt(frame: number): number {
  return interpolate(
    frame,
    [0, 98, 104, 120, 130, 140, Q.race[1], Q.rewind[0], Q.rewind[1]],
    [0, 0, follow(3), follow(4), follow(5), follow(5), BOTTOM - VIEW_HEIGHT, BOTTOM - VIEW_HEIGHT, KEEP_CENTER],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) },
  )
}

/** The conversation's column at pane progress `p`: centered in what the pane leaves of the window. */
function columnAt(p: number): { left: number; width: number } {
  const mainLeft = WIN.left + SIDEBAR
  const mainWidth = WIN.width - SIDEBAR - PANE * p
  const width = Math.min(940, mainWidth - 80)
  return { left: mainLeft + (mainWidth - width) / 2, width }
}

/** The button sits at the foot of its reply's row, `BUTTON_BOTTOM` above the row's end. */
const BUTTON_BOTTOM = 6
const BUTTON_HEIGHT = 34

/** Where the kept reply's Save to notebook button is on screen (its top left). */
function keptButton(scroll: number, p: number): { x: number; y: number } {
  const column = columnAt(p)
  return { x: column.left + 4, y: WIN.top + VIEW_TOP + TOPS[KEEP] + MESSAGES[KEEP].height - BUTTON_BOTTOM - BUTTON_HEIGHT - scroll }
}

const PANE_LEFT = WIN.left + WIN.width - PANE
const SAVE_BUTTON = { x: PANE_LEFT + PANE - 96, y: WIN.top + 58 }
const NOTE_ROW = { x: PANE_LEFT + 22, y: WIN.top + 230 }
const CARD = { left: 140, top: 250, width: 860, height: 590 }

const FRONT_MATTER = [
  '---',
  'title: "Retry with backoff"',
  'folder: "Payments"',
  'type: reference',
  'tags: ["payments", "resilience"]',
  'captured: whole_message',
  'role: assistant',
  '---',
]

const SESSIONS = ['Checkout timeouts', 'Flaky date test', 'Dependency bumps', 'API client docs', 'Release notes', 'Card grid layout']

const Sidebar: React.FC = () => (
  <div style={{ position: 'absolute', left: 0, top: TITLE, width: SIDEBAR, bottom: 0, background: '#1f1f1d', borderRight: `1px solid ${C.line}`, padding: '18px 14px', boxSizing: 'border-box' }}>
    <div style={{ fontSize: 17, color: C.text, padding: '8px 12px' }}>＋ New session</div>
    <div style={{ fontSize: 17, color: C.muted, padding: '8px 12px' }}>⌕ Search</div>
    <div style={{ fontSize: 14, color: C.faint, padding: '20px 12px 8px', letterSpacing: '0.04em' }}>Recent</div>
    {SESSIONS.map((name, i) => (
      <div key={name} style={{ fontSize: 17, padding: '9px 12px', borderRadius: 8, color: i === 0 ? C.text : C.muted, background: i === 0 ? '#2c2c29' : 'transparent' }}>
        {name}
      </div>
    ))}
    <div style={{ position: 'absolute', left: 26, bottom: 22, display: 'flex', alignItems: 'center', gap: 10, color: C.muted, fontSize: 16 }}>
      <div style={{ width: 26, height: 26, borderRadius: 13, background: '#3a3a35', display: 'grid', placeItems: 'center', fontSize: 13, color: C.text }}>Y</div>
      You
    </div>
  </div>
)

const SaveButton: React.FC<{ lit: number; pressed?: boolean }> = ({ lit, pressed = false }) => (
  <div
    style={{
      position: 'absolute',
      left: 4,
      bottom: BUTTON_BOTTOM,
      height: BUTTON_HEIGHT,
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 14px',
      borderRadius: 8,
      border: `1px solid rgba(224,138,106,${0.15 + lit * 0.85})`,
      background: pressed ? 'rgba(224,138,106,.28)' : `rgba(224,138,106,${lit * 0.12})`,
      color: lit > 0.5 ? C.accent : C.faint,
      fontSize: 16,
      fontWeight: 600,
      transform: `scale(${pressed ? 0.95 : 1})`,
    }}
  >
    Save to notebook
  </div>
)

/** The Live Notebook pane: the draft to save, then the notebook with it in. */
const NotebookPane: React.FC<{ frame: number }> = ({ frame }) => {
  const isSaved = frame >= Q.saved
  const pressed = frame >= Q.clickSave && frame < Q.clickSave + 6
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '0 22px', boxSizing: 'border-box' }}>
      <div style={{ height: TITLE, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: C.muted, fontSize: 16 }}>
        <span>Live Notebook</span>
        <span style={{ letterSpacing: 10 }}>⤢ ✕</span>
      </div>
      {!isSaved ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, fontSize: 18 }}>
            <span style={{ color: C.muted }}>← Payments /</span>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Retry with backoff</span>
            <span style={{ color: C.muted }}>Discard</span>
            <span style={{ padding: '6px 14px', borderRadius: 8, background: pressed ? C.accentDeep : C.text, color: pressed ? '#fff' : C.ground, fontWeight: 650 }}>Save</span>
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', height: 44, fontSize: 16, color: C.muted }}>
            Notebook <span style={{ color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, padding: '4px 10px' }}>Payments ▾</span>
            Type <span style={{ color: C.accent, border: `1px solid ${C.line}`, borderRadius: 7, padding: '4px 10px' }}>▤ Reference ▾</span>
          </div>
          <div style={{ display: 'flex', gap: 18, height: 40, alignItems: 'center', fontSize: 16, color: C.muted, borderBottom: `1px solid ${C.line}` }}>
            {['H1', 'H2', 'B', 'I', '</>', 'Link', '• List', 'Quote'].map(tool => (
              <span key={tool}>{tool}</span>
            ))}
          </div>
          <div style={{ paddingTop: 16, fontSize: 18, lineHeight: 1.55, color: C.text }}>
            <div style={{ fontWeight: 700 }}>## Retry with backoff</div>
            <div style={{ marginTop: 6 }}>{KEPT_TEXT}</div>
            <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 16, color: '#d7d5cc' }}>```ts</div>
            <div style={{ fontFamily: MONO, fontSize: 16, color: '#d7d5cc' }}>await retry(charge, {'{'} retries: 5 {'}'})</div>
            <div style={{ fontFamily: MONO, fontSize: 16, color: '#d7d5cc' }}>```</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 22, height: 44, alignItems: 'center', fontSize: 16, color: C.muted }}>
            <span style={{ color: C.text }}>All notes</span>
            <span>◉ Insights</span>
            <span>↗ Learnings</span>
            <span>▤ References</span>
          </div>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', fontSize: 14, letterSpacing: '0.1em', color: C.faint }}>
            <span>PAYMENTS</span>
            <span>1</span>
          </div>
          <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 10, background: '#2c2c29', opacity: 1 - ease(frame, Q.morph, Q.morph + 8) }}>
            <div style={{ fontSize: 19, fontWeight: 650 }}>
              <span style={{ color: C.accent }}>▤</span> Retry with backoff
            </div>
            <div style={{ marginTop: 4, fontSize: 15, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{KEPT_TEXT}</div>
          </div>
          <div style={{ marginTop: 28, fontSize: 14, letterSpacing: '0.1em', color: C.faint }}>OPS · FRONTEND</div>
          {['Blue/green deploys', 'Why the list re-rendered'].map(title => (
            <div key={title} style={{ marginTop: 12, padding: '0 14px', fontSize: 18, color: C.muted }}>
              {title}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export const Desktop: React.FC = () => {
  const frame = useCurrentFrame()
  const scroll = scrollAt(frame)
  const blur = Math.min(8, Math.abs(scrollAt(frame + 1) - scroll) / 14)
  const p = ease(frame, Q.paneOpen[0], Q.paneOpen[1], Easing.bezier(0.2, 0.9, 0.3, 1))
  const column = columnAt(p)
  const glow = ease(frame, Q.glow, Q.glow + 18)
  const away = ease(frame, Q.morph, Q.morph + 34)
  const card = useSpring(Q.morph + 2, 16, 0.9)

  // The cursor: in from the corner, to the button under the reply, then to the pane's Save.
  const toButton = ease(frame, Q.cursorIn + 4, Q.clickButton - 2, Easing.inOut(Easing.cubic))
  const toSave = ease(frame, Q.paneOpen[1] + 6, Q.clickSave - 2, Easing.inOut(Easing.cubic))
  const buttonAt = keptButton(KEEP_CENTER, 0)
  const cursorX = interpolate(toSave, [0, 1], [interpolate(toButton, [0, 1], [1560, buttonAt.x + 90]), SAVE_BUTTON.x + 18])
  const cursorY = interpolate(toSave, [0, 1], [interpolate(toButton, [0, 1], [980, buttonAt.y + 12]), SAVE_BUTTON.y + 12])
  const cursorShown = ease(frame, Q.cursorIn, Q.cursorIn + 10) * (1 - ease(frame, Q.clickSave + 10, Q.clickSave + 20))
  const pressed = (frame >= Q.clickButton && frame < Q.clickButton + 6) || (frame >= Q.clickSave && frame < Q.clickSave + 6)
  const toast = ease(frame, Q.saved + 2, Q.saved + 12) * (1 - ease(frame, Q.morph - 6, Q.morph + 4))

  const cardLeft = interpolate(card, [0, 1], [NOTE_ROW.x, CARD.left])
  const cardTop = interpolate(card, [0, 1], [NOTE_ROW.y, CARD.top])
  const cardScale = interpolate(card, [0, 1], [0.6, 1])

  return (
    <Scene duration={DESKTOP_FRAMES} fadeIn={8}>
      {frame < 140 && (
        <Caption delay={4} size={50} top={62}>
          Claude just explained something <Accent>worth keeping.</Accent>
        </Caption>
      )}
      {frame >= 140 && frame < 216 && <Caption delay={146} size={50} top={62}>…and then it scrolled away.</Caption>}
      {frame >= 216 && frame < Q.clickButton + 4 && <Caption delay={220} size={50} top={62}>Not anymore. There's a button under every reply.</Caption>}
      {frame >= Q.clickButton + 4 && frame < Q.morph && (
        <Caption delay={Q.clickButton + 8} size={50} top={62}>
          Right inside <Accent>Claude Code desktop.</Accent>
        </Caption>
      )}
      {frame >= Q.morph && (
        <Caption delay={Q.morph + 10} size={50} top={62}>
          Saved as <Accent>a plain Markdown file.</Accent>
        </Caption>
      )}

      {/* The desktop window */}
      <div
        style={{
          position: 'absolute',
          ...WIN,
          borderRadius: 18,
          background: '#262624',
          border: `1px solid ${C.line}`,
          boxShadow: '0 40px 120px rgba(0,0,0,.5)',
          overflow: 'hidden',
          opacity: 1 - away * 0.78,
          transform: `translateX(${away * 240}px) scale(${1 - away * 0.06})`,
          filter: `blur(${away * 5}px)`,
        }}
      >
        <div style={{ height: TITLE, display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px', borderBottom: `1px solid ${C.line}`, background: '#232321' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map(color => (
            <div key={color} style={{ width: 12, height: 12, borderRadius: 6, background: color, opacity: 0.85 }} />
          ))}
          <div style={{ position: 'absolute', left: SIDEBAR + 24, fontSize: 17, color: C.muted }}>Checkout timeouts</div>
          <div style={{ position: 'absolute', right: 22, fontSize: 15, color: C.faint }}>Claude Code</div>
        </div>
        <Sidebar />

        {/* The conversation */}
        <div style={{ position: 'absolute', left: column.left - WIN.left, width: column.width, top: VIEW_TOP, height: VIEW_HEIGHT, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll, filter: `blur(${blur}px)` }}>
            {MESSAGES.map((message, i) => {
              const shown = ease(frame, Q.messages[i], Q.messages[i] + 8)
              const isKeep = message.keep === true
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: TOPS[i],
                    height: message.role === 'agent' ? message.height : 'auto',
                    left: message.role === 'user' ? 'auto' : 0,
                    right: message.role === 'user' ? 0 : 'auto',
                    maxWidth: message.role === 'user' ? '70%' : '100%',
                    fontSize: 21,
                    lineHeight: 1.45,
                    color: C.text,
                    opacity: shown,
                    transform: `translateY(${(1 - shown) * 16}px)`,
                  }}
                >
                  <div style={message.role === 'user' ? { padding: '14px 20px', borderRadius: 16, background: '#33332f' } : { padding: '2px 4px' }}>{message.body}</div>
                  {message.role === 'agent' && <SaveButton lit={isKeep ? glow : 0} pressed={isKeep && frame >= Q.clickButton && frame < Q.clickButton + 6} />}
                </div>
              )
            })}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: column.left - WIN.left,
            width: column.width,
            bottom: 24,
            height: COMPOSER,
            borderRadius: 16,
            border: `1px solid ${C.line}`,
            background: '#2c2c29',
            display: 'flex',
            alignItems: 'center',
            padding: '0 22px',
            boxSizing: 'border-box',
            color: C.faint,
            fontSize: 19,
          }}
        >
          Reply to Claude…
        </div>

        {/* The Live Notebook pane */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: WIN.width - PANE,
            width: PANE,
            background: '#1f1f1d',
            borderLeft: `1px solid ${C.line}`,
            transform: `translateX(${(1 - p) * PANE}px)`,
          }}
        >
          {frame >= Q.paneOpen[0] && <NotebookPane frame={frame} />}
        </div>

        {/* Saved */}
        <div
          style={{
            position: 'absolute',
            left: columnAt(1).left - WIN.left + columnAt(1).width / 2 - 170,
            bottom: 110,
            width: 340,
            padding: '12px 18px',
            borderRadius: 12,
            background: '#33332f',
            border: `1px solid ${C.line}`,
            fontSize: 17,
            textAlign: 'center',
            opacity: toast,
            transform: `translateY(${(1 - toast) * 12}px)`,
          }}
        >
          Saved to Payments: Retry with backoff
        </div>
      </div>

      {frame >= Q.cursorIn && frame < Q.clickSave + 20 && (
        <div style={{ opacity: cursorShown }}>
          <Cursor x={cursorX} y={cursorY} pressed={pressed} />
        </div>
      )}

      {/* The note's file */}
      {frame >= Q.morph + 2 && (
        <div
          style={{
            position: 'absolute',
            left: cardLeft,
            top: cardTop,
            width: CARD.width,
            height: CARD.height,
            transformOrigin: 'top left',
            transform: `scale(${cardScale})`,
            opacity: ease(frame, Q.morph + 2, Q.morph + 10),
            borderRadius: 20,
            background: C.paper,
            color: C.ink,
            boxShadow: '0 40px 120px rgba(0,0,0,.5)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 64, padding: '0 28px', borderBottom: '1px solid #e6e6e2', fontFamily: MONO, fontSize: 21, color: C.inkMuted }}>
            <span style={{ color: C.accentDeep }}>Payments/</span>retry-with-backoff--3f2a91c0.md
          </div>
          <div style={{ padding: '22px 30px', fontFamily: MONO, fontSize: 22, lineHeight: 1.6 }}>
            {FRONT_MATTER.map((line, i) => {
              const at = Q.typing + i * Q.step
              const [key, ...rest] = line.split(': ')
              return (
                <div key={i} style={{ minHeight: 35, color: line === '---' ? '#b3b2ab' : C.ink }}>
                  {frame >= at &&
                    (rest.length === 0 ? (
                      <Typed text={line} delay={at} cps={60} />
                    ) : (
                      <>
                        <span style={{ color: C.accentDeep }}>{key}:</span> <Typed text={rest.join(': ')} delay={at + 2} cps={70} />
                      </>
                    ))}
                </div>
              )
            })}
            <div style={{ marginTop: 16, opacity: ease(frame, Q.body, Q.body + 14) }}>
              <div style={{ fontWeight: 700, fontSize: 24 }}>## Retry with backoff</div>
              <div style={{ color: '#55554f', fontSize: 21, marginTop: 4 }}>Retry timeouts with exponential backoff and jitter…</div>
            </div>
          </div>
        </div>
      )}
    </Scene>
  )
}
