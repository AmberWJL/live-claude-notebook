import React from 'react'
import { useCurrentFrame } from 'remotion'

import { FRAMES, SOURCES as Q, sourceShots } from '../cues.mjs'
import { Accent, Caption, Scene, ease, useSpring } from '../kit'
import { C, MONO } from '../theme'

export const SOURCES_FRAMES = FRAMES.sources

/** A student's Claude Code sessions, and how each saved what it taught. */
const SOURCES = [
  { name: 'Explain recursion', how: 'Save to notebook' },
  { name: 'Binary search, step by step', how: '/save a selection' },
  { name: 'What is Big-O?', how: 'Save to notebook' },
  { name: 'Hash maps vs. arrays', how: '/save any text' },
]
const CHIP = { left: 140, width: 440, height: 104, top: 340, step: 128 }
const FOLDER = { left: 1160, top: 330, width: 620, height: 520 }
const INTO = { x: FOLDER.left, y: FOLDER.top + 250 }
const NOTEBOOKS = [
  { name: 'Algorithms', from: 3 },
  { name: 'Data structures', from: 2 },
  { name: 'Exam prep', from: 1 },
]

/** A point on the cubic from a chip's right edge into the folder. */
function along(i: number, t: number): { x: number; y: number } {
  const x0 = CHIP.left + CHIP.width
  const y0 = CHIP.top + i * CHIP.step + CHIP.height / 2
  const [x1, y1, x2, y2, x3, y3] = [x0 + 260, y0, INTO.x - 260, INTO.y, INTO.x, INTO.y]
  const u = 1 - t
  return {
    x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
    y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
  }
}

/** Notes in flight: each source sends one every 22 frames from its start, 26 frames on the way. */
const FLIGHT = Q.flight
const shots = sourceShots()

export const Sources: React.FC = () => {
  const frame = useCurrentFrame()
  const folderIn = useSpring(26, 16)
  const landed = (notebook: number) => shots.filter(shot => shot.notebook === notebook && frame >= shot.start + FLIGHT).length

  return (
    <Scene duration={SOURCES_FRAMES}>
      <Caption delay={2} size={60}>
        Learning with Claude?
        <br />
        <Accent>Every explanation, kept.</Accent>
      </Caption>

      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {SOURCES.map((_, i) => {
          const p = (t: number) => along(i, t)
          const d = `M ${p(0).x} ${p(0).y} C ${CHIP.left + CHIP.width + 260} ${p(0).y}, ${INTO.x - 260} ${INTO.y}, ${INTO.x} ${INTO.y}`
          const drawn = ease(frame, 18 + i * 6, 44 + i * 6)
          return <path key={i} d={d} fill="none" stroke={C.line} strokeWidth={3} strokeDasharray="10 12" pathLength={1} strokeDashoffset={0} opacity={drawn} />
        })}
        {shots.map((shot, k) => {
          const t = (frame - shot.start) / FLIGHT
          if (t < 0 || t > 1) return null
          const { x, y } = along(shot.source, t * t * (3 - 2 * t))
          return <rect key={k} x={x - 14} y={y - 18} width={28} height={36} rx={5} fill={C.paper} stroke={C.accent} strokeWidth={2} opacity={Math.min(1, t * 6, (1 - t) * 6 + 0.2)} />
        })}
      </svg>

      {SOURCES.map((source, i) => {
        const shown = useSpring(6 + i * 6, 15)
        return (
          <div
            key={source.name}
            style={{
              position: 'absolute',
              left: CHIP.left,
              top: CHIP.top + i * CHIP.step,
              width: CHIP.width,
              height: CHIP.height,
              borderRadius: 18,
              background: C.panel,
              border: `1px solid ${C.line}`,
              padding: '18px 26px',
              boxSizing: 'border-box',
              opacity: shown,
              transform: `translateX(${(1 - shown) * -40}px)`,
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, whiteSpace: 'nowrap' }}>{source.name}</div>
            <div style={{ marginTop: 4, fontSize: 21, color: C.muted, fontFamily: source.how.startsWith('/') ? MONO : undefined }}>{source.how}</div>
          </div>
        )
      })}

      <div
        style={{
          position: 'absolute',
          ...FOLDER,
          borderRadius: 22,
          background: C.paper,
          color: C.ink,
          boxShadow: '0 40px 120px rgba(0,0,0,.45)',
          opacity: folderIn,
          transform: `scale(${0.9 + folderIn * 0.1})`,
          overflow: 'hidden',
        }}
      >
        <div style={{ height: 70, display: 'flex', alignItems: 'center', padding: '0 30px', borderBottom: '1px solid #e6e6e2', fontFamily: MONO, fontSize: 23, color: C.inkMuted }}>
          ~/.claude/live-notebook/notes
        </div>
        {NOTEBOOKS.map((notebook, n) => {
          const count = notebook.from + landed(n)
          const pulse = shots.some(shot => shot.notebook === n && frame >= shot.start + FLIGHT && frame < shot.start + FLIGHT + 8)
          return (
            <div key={notebook.name} style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '30px 34px', borderBottom: n < 2 ? '1px solid #efefeb' : 'none', background: pulse ? '#fbefe9' : 'transparent' }}>
              <svg width={44} height={36} viewBox="0 0 44 36">
                <path d="M2 6 a4 4 0 0 1 4-4 h11 l5 5 h16 a4 4 0 0 1 4 4 v19 a4 4 0 0 1 -4 4 h-32 a4 4 0 0 1 -4-4 z" fill={C.accent} opacity={0.9} />
              </svg>
              <div style={{ fontSize: 32, fontWeight: 650, flex: 1 }}>{notebook.name}</div>
              <div style={{ fontSize: 26, color: C.inkMuted, fontVariantNumeric: 'tabular-nums' }}>
                {count} <span style={{ fontSize: 20 }}>.md</span>
              </div>
            </div>
          )
        })}
        <div style={{ padding: '22px 34px', fontSize: 21, color: C.inkMuted }}>
          <span style={{ color: C.accentDeep }}>↗ Learning</span> notes, sorted by course. Plain Markdown files.
        </div>
      </div>
    </Scene>
  )
}
