import React from 'react'
import { Img, interpolate, staticFile, useCurrentFrame } from 'remotion'

import { FIND as Q, FRAMES } from '../cues.mjs'
import { Accent, Caption, Scene, Typed, ease, useSpring } from '../kit'
import { INSIGHT, LEARNING, LINKS, NOTEBOOK } from '../story'
import { C, MONO } from '../theme'

export const FIND_FRAMES = FRAMES.find

/** What the search for the cues' word finds; each snippet holds the word. */
const RESULTS = [
  { notebook: NOTEBOOK, title: INSIGHT.title, snippet: '…they ask "who can see this?". One grants table answers the sharing question…' },
  { notebook: NOTEBOOK, title: LEARNING.title, snippet: '…sharing settings rarely conflict, so optimistic with a version check…' },
  { notebook: 'Ops', title: LINKS.title, snippet: '…sharing links get a 7-day TTL and a one-time token…' },
]
const BAR = { left: 140, top: 300, width: 900 }

export const Find: React.FC = () => {
  const frame = useCurrentFrame()
  const shot = useSpring(Q.shot, 20, 1)
  const listOut = ease(frame, Q.shot + 14, Q.shot + 34)
  const drift = interpolate(frame, [Q.shot + 14, FIND_FRAMES], [0, 0.035], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <Scene duration={FIND_FRAMES}>
      <Caption delay={2} size={60}>
        Find it again <Accent>in a second.</Accent>
      </Caption>

      <div style={{ opacity: 1 - listOut, transform: `translateY(${listOut * -30}px)` }}>
        <div
          style={{
            position: 'absolute',
            ...BAR,
            height: 92,
            borderRadius: 46,
            background: C.panel,
            border: `1.5px solid ${frame > 16 ? C.accent : C.line}`,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '0 36px',
            boxSizing: 'border-box',
            fontSize: 36,
            opacity: ease(frame, 6, 18),
          }}
        >
          <svg width={34} height={34} viewBox="0 0 24 24">
            <circle cx="10.5" cy="10.5" r="7" fill="none" stroke={C.muted} strokeWidth="2.4" />
            <path d="M16 16 L22 22" stroke={C.muted} strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span>
            <Typed text={Q.word} delay={Q.typeAt} cps={Q.cps} caret />
          </span>
        </div>
        {RESULTS.map((result, i) => {
          const shown = ease(frame, Q.results[i], Q.results[i] + 14)
          return (
            <div
              key={result.title}
              style={{
                position: 'absolute',
                left: BAR.left,
                top: BAR.top + 126 + i * 150,
                width: BAR.width,
                height: 128,
                borderRadius: 18,
                padding: '20px 30px',
                boxSizing: 'border-box',
                background: i === 0 ? C.panelHi : C.panel,
                border: `1px solid ${i === 0 ? C.accent : C.line}`,
                opacity: shown,
                transform: `translateY(${(1 - shown) * 16}px)`,
              }}
            >
              <div style={{ fontSize: 20, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{result.notebook}</div>
              <div style={{ fontSize: 31, fontWeight: 700, marginTop: 2 }}>{result.title}</div>
              <div style={{ fontSize: 21, color: C.muted, marginTop: 4, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {result.snippet.split(Q.word).map((part, k, parts) => (
                  <React.Fragment key={k}>
                    {part}
                    {k < parts.length - 1 ? <span style={{ color: C.accent }}>{Q.word}</span> : null}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* The note, opened in the web notebook */}
      <div
        style={{
          position: 'absolute',
          left: 1160 - shot * 940,
          top: 300 - shot * 70,
          width: 1640,
          height: 974,
          borderRadius: 22,
          overflow: 'hidden',
          boxShadow: '0 50px 140px rgba(0,0,0,.55)',
          border: `1px solid ${C.line}`,
          opacity: Math.min(1, ease(frame, Q.results[1], Q.results[1] + 20) * 0.35 + shot),
          transform: `scale(${0.42 + shot * 0.58 + drift})`,
          transformOrigin: 'top left',
        }}
      >
        <Img src={staticFile('web-notebook.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top left' }} />
      </div>
    </Scene>
  )
}
