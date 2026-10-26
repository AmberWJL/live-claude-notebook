import React from 'react'
import { Easing, interpolate, useCurrentFrame } from 'remotion'

import { Accent, Caption, Scene, Typed, ease, useSpring } from '../kit'
import { C, MONO } from '../theme'

export const CAPTURE_FRAMES = 420

const WINDOW = { left: 760, top: 290, width: 1000, height: 700 }
const HEADER = 58
const PAD = 26
const VIEW = WINDOW.height - HEADER - PAD * 2

type Message = { role: 'user' | 'agent'; at: number; height: number; body: React.ReactNode; keep?: true }

const code = (text: string) => (
  <div style={{ marginTop: 14, padding: '14px 18px', borderRadius: 10, background: '#1a1a18', border: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 21, color: '#d7d5cc' }}>
    {text}
  </div>
)

const filler = [
  'Updated the lockfile.',
  'Renamed the hook to useCart.',
  'Tests pass: 212 of 212.',
  'Added the migration for orders.',
  'Here is the diff for the API client.',
  'The CSS grid now wraps at 480px.',
  'Removed the unused feature flag.',
  'Rebased onto main; no conflicts.',
  'Opened the pull request.',
  'Lint is clean.',
]

const MESSAGES: Message[] = [
  { role: 'user', at: 12, height: 74, body: 'Why does checkout fail on payment timeouts?' },
  {
    role: 'agent',
    at: 30,
    height: 300,
    keep: true,
    body: (
      <>
        <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 8 }}>Retry with backoff</div>
        <div>Retry timeouts with exponential backoff and jitter, and send an idempotency key so a retried charge is never charged twice.</div>
        {code('await retry(charge, { retries: 5, factor: 2, jitter: true })')}
        <div style={{ marginTop: 14 }}>
          Never retry a <span style={{ fontFamily: MONO, color: C.accent }}>402</span>: it is a real decline, not a blip.
        </div>
      </>
    ),
  },
  { role: 'user', at: 84, height: 74, body: 'Great. Now fix the flaky date test.' },
  { role: 'agent', at: 98, height: 112, body: 'It fails after 7 pm because the test crosses midnight in UTC. I froze the clock with fake timers.' },
  { role: 'user', at: 116, height: 74, body: 'Bump the dependencies too.' },
  { role: 'agent', at: 126, height: 74, body: 'Done: 14 packages updated, the build is green.' },
  ...filler.map((body, i): Message => ({ role: i % 3 === 0 ? 'user' : 'agent', at: 142 + i * 6.5, height: 74, body })),
]

const GAP = 22
const TOPS = MESSAGES.reduce<number[]>((tops, message, i) => [...tops, i === 0 ? 0 : tops[i - 1] + MESSAGES[i - 1].height + GAP], [])
const KEEP = MESSAGES.findIndex(message => message.keep)
const KEEP_CENTER = TOPS[KEEP] - (VIEW - MESSAGES[KEEP].height) / 2
const BOTTOM = TOPS[TOPS.length - 1] + MESSAGES[MESSAGES.length - 1].height

/** How far the conversation has scrolled: following new replies, racing away, then rewinding to the one worth keeping. */
function scrollAt(frame: number): number {
  return interpolate(
    frame,
    [0, 98, 104, 120, 130, 140, 208, 218, 252],
    [0, 0, TOPS[3] + MESSAGES[3].height - VIEW, TOPS[4] + MESSAGES[4].height - VIEW, TOPS[5] + MESSAGES[5].height - VIEW, TOPS[5] + MESSAGES[5].height - VIEW, BOTTOM - VIEW, BOTTOM - VIEW, KEEP_CENTER],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) },
  )
}

const CLICK = 262
const PILL = { left: WINDOW.left + PAD + 2, top: WINDOW.top + HEADER + PAD + (TOPS[KEEP] + MESSAGES[KEEP].height - KEEP_CENTER) + 14, width: 236, height: 46 }
const CARD = { left: 140, top: 270, width: 860, height: 590 }

const FRONT_MATTER = [
  '---',
  'title: "Retry with backoff"',
  'folder: "Payments"',
  'tags: ["payments", "resilience"]',
  'captured: whole_message',
  'role: assistant',
  'agent: claude-code',
  '---',
]

const Cursor: React.FC<{ x: number; y: number; pressed: boolean }> = ({ x, y, pressed }) => (
  <svg width={38} height={46} viewBox="0 0 19 23" style={{ position: 'absolute', left: x, top: y, transform: `scale(${pressed ? 0.88 : 1})`, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.45))' }}>
    <path d="M1 1 L1 18 L5.5 13.8 L8.6 21 L11.6 19.7 L8.6 12.6 L14.6 12.6 Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
)

export const Capture: React.FC = () => {
  const frame = useCurrentFrame()
  const scroll = scrollAt(frame)
  const speed = Math.abs(scrollAt(frame + 1) - scroll)
  const blur = Math.min(9, speed / 14)

  // After the click the chat steps back, and the kept reply becomes a file.
  const away = ease(frame, CLICK + 2, CLICK + 34)
  const card = useSpring(CLICK + 4, 16, 0.9)
  const glow = ease(frame, 226, 246)
  const pill = ease(frame, 228, 242)
  const cursorIn = ease(frame, 232, 244)
  const cursorMove = ease(frame, 236, CLICK - 2, Easing.inOut(Easing.cubic))
  const pressed = frame >= CLICK && frame < CLICK + 6
  const ripple = ease(frame, CLICK, CLICK + 18)

  const cardLeft = interpolate(card, [0, 1], [PILL.left, CARD.left])
  const cardTop = interpolate(card, [0, 1], [PILL.top, CARD.top])
  const cardScale = interpolate(card, [0, 1], [0.18, 1])

  return (
    <Scene duration={CAPTURE_FRAMES} fadeIn={8}>
      {frame < 140 && (
        <Caption delay={4} size={60}>
          Your AI agent just explained
          <br />
          something <Accent>worth keeping.</Accent>
        </Caption>
      )}
      {frame >= 140 && frame < 216 && <Caption delay={146} size={60}>…and then it scrolled away.</Caption>}
      {frame >= 216 && frame < CLICK + 30 && <Caption delay={220} size={60}>Not anymore.</Caption>}
      {frame >= CLICK + 30 && (
        <Caption delay={CLICK + 34} size={60} top={120}>
          One click. <Accent>A plain Markdown file.</Accent>
        </Caption>
      )}

      {/* The chat window */}
      <div
        style={{
          position: 'absolute',
          ...WINDOW,
          borderRadius: 22,
          background: C.panel,
          border: `1px solid ${C.line}`,
          boxShadow: '0 40px 120px rgba(0,0,0,.45)',
          overflow: 'hidden',
          opacity: 1 - away * 0.78,
          transform: `translateX(${away * 260}px) scale(${1 - away * 0.06})`,
          filter: `blur(${away * 5}px)`,
        }}
      >
        <div style={{ height: HEADER, display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px', borderBottom: `1px solid ${C.line}`, color: C.muted, fontSize: 20 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map(color => (
            <div key={color} style={{ width: 13, height: 13, borderRadius: 7, background: color, opacity: 0.8 }} />
          ))}
          <span style={{ marginLeft: 14 }}>Agent · checkout-service</span>
        </div>
        <div style={{ position: 'absolute', left: PAD, right: PAD, top: HEADER + PAD, height: VIEW, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll, filter: `blur(${blur}px)` }}>
            {MESSAGES.map((message, i) => {
              const shown = ease(frame, message.at, message.at + 8)
              const isKeep = message.keep === true
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: TOPS[i],
                    height: message.height,
                    left: message.role === 'user' ? 'auto' : 0,
                    right: message.role === 'user' ? 0 : 'auto',
                    maxWidth: message.role === 'user' ? 620 : 860,
                    padding: message.role === 'user' ? '18px 24px' : '20px 26px',
                    borderRadius: 18,
                    fontSize: 24,
                    lineHeight: 1.45,
                    background: message.role === 'user' ? C.panelHi : '#20201e',
                    border: `1.5px solid ${isKeep ? `rgba(224,138,106,${0.25 + glow * 0.75})` : C.line}`,
                    boxShadow: isKeep ? `0 0 ${glow * 60}px rgba(224,138,106,${glow * 0.35})` : 'none',
                    color: C.text,
                    opacity: shown * (isKeep && frame >= CLICK + 2 ? 1 - away : 1),
                    transform: `translateY(${(1 - shown) * 18}px)`,
                    boxSizing: 'border-box',
                  }}
                >
                  {message.body}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Save to notebook, under the kept reply */}
      {frame < CLICK + 20 && (
        <div
          style={{
            position: 'absolute',
            ...PILL,
            borderRadius: 23,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: pressed ? C.accentDeep : C.accent,
            color: '#fff',
            fontSize: 21,
            fontWeight: 650,
            opacity: pill * (1 - ease(frame, CLICK + 6, CLICK + 18)),
            transform: `translateY(${(1 - pill) * 10}px) scale(${pressed ? 0.94 : 1})`,
            boxShadow: `0 0 0 ${ripple * 30}px rgba(224,138,106,${0.35 * (1 - ripple)})`,
          }}
        >
          <span style={{ fontSize: 22 }}>↓</span> Save to notebook
        </div>
      )}
      {frame >= 232 && frame < CLICK + 16 && (
        <div style={{ opacity: cursorIn * (1 - ease(frame, CLICK + 6, CLICK + 16)) }}>
          <Cursor x={interpolate(cursorMove, [0, 1], [1520, PILL.left + 150])} y={interpolate(cursorMove, [0, 1], [980, PILL.top + 18])} pressed={pressed} />
        </div>
      )}

      {/* The note's file */}
      {frame >= CLICK + 4 && (
        <div
          style={{
            position: 'absolute',
            left: cardLeft,
            top: cardTop,
            width: CARD.width,
            height: CARD.height,
            transformOrigin: 'top left',
            transform: `scale(${cardScale})`,
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
              const at = CLICK + 26 + i * 7
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
            <div style={{ marginTop: 16, fontFamily: 'inherit', opacity: ease(frame, CLICK + 92, CLICK + 108) }}>
              <div style={{ fontWeight: 700, fontSize: 24 }}>## Retry with backoff</div>
              <div style={{ color: '#55554f', fontSize: 21, marginTop: 4 }}>Retry timeouts with exponential backoff and jitter…</div>
            </div>
          </div>
        </div>
      )}
    </Scene>
  )
}
