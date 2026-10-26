import React from 'react'
import { useCurrentFrame } from 'remotion'

import { Scene, ease, useSpring } from '../kit'
import { C, MONO } from '../theme'

export const LOCAL_FRAMES = 150

const LINES = [
  { text: 'No account.', at: 6 },
  { text: 'No cloud.', at: 22 },
  { text: 'Just Markdown files', at: 40 },
  { text: 'on your computer.', at: 50, accent: true },
]

/** A laptop holding the notes folder; a cloud above it that never gets them. */
const Laptop: React.FC = () => {
  const frame = useCurrentFrame()
  const laptop = useSpring(10, 16)
  const cloud = ease(frame, 30, 46)
  const strike = ease(frame, 58, 74)
  const files = [0, 1, 2, 3, 4]
  return (
    <div style={{ position: 'absolute', left: 1080, top: 250, width: 700, height: 640, opacity: laptop, transform: `translateY(${(1 - laptop) * 30}px)` }}>
      {/* The cloud, crossed out */}
      <div style={{ position: 'absolute', left: 430, top: 0, opacity: cloud * (1 - strike * 0.55) }}>
        <svg width={220} height={140} viewBox="0 0 110 70">
          <path d="M28 60 h52 a18 18 0 0 0 2-35.9 a24 24 0 0 0-45.6-6.2 A20 20 0 0 0 28 60 z" fill="none" stroke={C.muted} strokeWidth="4" strokeLinejoin="round" />
          <line x1="16" y1="64" x2="96" y2="6" stroke={C.accent} strokeWidth="6" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - strike} />
        </svg>
      </div>
      {/* The screen */}
      <div style={{ position: 'absolute', left: 40, top: 170, width: 620, height: 380, borderRadius: 26, border: `10px solid #3a3a35`, background: C.paper, boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ padding: '22px 26px', fontFamily: MONO, fontSize: 20, color: C.inkMuted }}>~/.claude/live-notebook/notes/Payments</div>
        {files.map(i => {
          const shown = ease(frame, 24 + i * 6, 36 + i * 6)
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '0 26px 12px', opacity: shown, transform: `translateX(${(1 - shown) * 20}px)` }}>
              <div style={{ width: 22, height: 28, borderRadius: 4, border: `2px solid ${C.accent}`, background: '#fff' }} />
              <div style={{ fontFamily: MONO, fontSize: 21, color: C.ink }}>
                {['retry-with-backoff', 'idempotency-keys', 'webhook-signatures', 'refund-flow', 'currency-rounding'][i]}--{['3f2a91c0', 'a81c03de', '5b7e2f19', 'c90d4a77', '1e66b2f0'][i]}.md
              </div>
            </div>
          )
        })}
      </div>
      {/* The base */}
      <div style={{ position: 'absolute', left: 0, top: 548, width: 700, height: 26, borderRadius: '6px 6px 18px 18px', background: '#3a3a35' }} />
      <div style={{ position: 'absolute', left: 290, top: 548, width: 120, height: 10, borderRadius: '0 0 8px 8px', background: '#2c2c29' }} />
    </div>
  )
}

export const Local: React.FC = () => {
  const frame = useCurrentFrame()
  return (
    <Scene duration={LOCAL_FRAMES}>
      <div style={{ position: 'absolute', left: 140, top: 270 }}>
        {LINES.map(line => {
          const t = ease(frame, line.at, line.at + 16)
          return (
            <div
              key={line.text}
              style={{
                fontSize: 92,
                fontWeight: 800,
                letterSpacing: '-0.035em',
                lineHeight: 1.08,
                color: line.accent ? C.accent : C.text,
                opacity: t,
                transform: `translateY(${(1 - t) * 26}px)`,
              }}
            >
              {line.text}
            </div>
          )
        })}
        <div style={{ marginTop: 38, fontSize: 30, color: C.muted, maxWidth: 820, lineHeight: 1.4, opacity: ease(frame, 70, 88) }}>
          Open them in any editor. Back them up. Put them in git. They stay yours.
        </div>
      </div>
      <Laptop />
    </Scene>
  )
}
