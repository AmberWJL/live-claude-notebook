import React from 'react'
import { useCurrentFrame } from 'remotion'

import { END as Q, FRAMES } from '../cues.mjs'
import { Mark, Scene, ease, useSpring } from '../kit'
import { C, MONO } from '../theme'

export const END_FRAMES = FRAMES.end

const INSTALLS = [
  { where: 'In Claude Code', how: '/plugin install live-notebook --marketplace AmberWJL/live-claude-notebook' },
  { where: 'Then', how: 'press Save to notebook under any reply' },
]

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame()
  const brand = useSpring(Q.brand, 15)
  return (
    <Scene duration={END_FRAMES} fadeOut={1}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: brand, transform: `scale(${0.92 + brand * 0.08})` }}>
          <Mark height={92} />
          <div style={{ fontSize: 108, fontWeight: 800, letterSpacing: '-0.04em' }}>Live Notebook</div>
        </div>
        <div style={{ marginTop: 18, fontSize: 44, color: C.muted, opacity: ease(frame, Q.tagline, Q.tagline + 16) }}>Keep the answers worth keeping.</div>
        <div style={{ marginTop: 70, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {INSTALLS.map((install, i) => {
            const t = ease(frame, Q.installs[i], Q.installs[i] + 16)
            return (
              <div
                key={install.where}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 28,
                  padding: '20px 30px',
                  borderRadius: 16,
                  background: C.panel,
                  border: `1px solid ${C.line}`,
                  opacity: t,
                  transform: `translateY(${(1 - t) * 16}px)`,
                }}
              >
                <div style={{ width: 190, fontSize: 24, color: C.muted }}>{install.where}</div>
                <div style={{ fontFamily: install.how.startsWith('/') ? MONO : undefined, fontSize: 25, color: install.how.startsWith('/') ? C.text : C.accent }}>{install.how}</div>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 54, fontSize: 30, color: C.accent, opacity: ease(frame, Q.url, Q.url + 16) }}>amberwjl.github.io/live-claude-notebook</div>
        <div style={{ marginTop: 14, fontSize: 22, color: C.faint, opacity: ease(frame, 70, 86) }}>Free and open source · MIT</div>
      </div>
    </Scene>
  )
}
