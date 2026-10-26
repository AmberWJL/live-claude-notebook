import React from 'react'
import { useCurrentFrame } from 'remotion'

import { Mark, Scene, ease, useSpring } from '../kit'
import { C, MONO } from '../theme'

export const END_FRAMES = 150

const INSTALLS = [
  { where: 'Claude Code', how: '/plugin install live-notebook --marketplace AmberWJL/live-claude-notebook' },
  { where: 'Cursor · VS Code · MCP', how: 'npm install -g github:AmberWJL/live-claude-notebook' },
]

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame()
  const brand = useSpring(4, 15)
  return (
    <Scene duration={END_FRAMES} fadeOut={1}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: brand, transform: `scale(${0.92 + brand * 0.08})` }}>
          <Mark height={92} />
          <div style={{ fontSize: 108, fontWeight: 800, letterSpacing: '-0.04em' }}>Live Notebook</div>
        </div>
        <div style={{ marginTop: 18, fontSize: 44, color: C.muted, opacity: ease(frame, 18, 34) }}>Keep the answers worth keeping.</div>
        <div style={{ marginTop: 70, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {INSTALLS.map((install, i) => {
            const t = ease(frame, 36 + i * 10, 52 + i * 10)
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
                <div style={{ width: 300, fontSize: 24, color: C.muted }}>{install.where}</div>
                <div style={{ fontFamily: MONO, fontSize: 25, color: C.text }}>{install.how}</div>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 54, fontSize: 30, color: C.accent, opacity: ease(frame, 62, 78) }}>amberwjl.github.io/live-claude-notebook</div>
        <div style={{ marginTop: 14, fontSize: 22, color: C.faint, opacity: ease(frame, 70, 86) }}>Free and open source · MIT</div>
      </div>
    </Scene>
  )
}
