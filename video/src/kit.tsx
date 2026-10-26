import React from 'react'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

import { C, SANS } from './theme'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** 0 → 1 over [from, to] frames, eased. */
export function ease(frame: number, from: number, to: number, easing = Easing.bezier(0.22, 1, 0.36, 1)): number {
  return interpolate(frame, [from, to], [0, 1], { ...clamp, easing })
}

/** A spring from 0 to 1 starting at `delay`. */
export function useSpring(delay: number, damping = 18, mass = 0.8): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delay, fps, config: { damping, mass } })
}

/** A scene that fades in over its first frames and out over its last. */
export const Scene: React.FC<{ duration: number; fadeIn?: number; fadeOut?: number; children: React.ReactNode }> = ({
  duration,
  fadeIn = 10,
  fadeOut = 12,
  children,
}) => {
  const frame = useCurrentFrame()
  const opacity = Math.min(fadeIn === 0 ? 1 : ease(frame, 0, fadeIn), 1 - ease(frame, duration - fadeOut, duration))
  return <AbsoluteFill style={{ backgroundColor: C.ground, opacity, fontFamily: SANS, color: C.text }}>{children}</AbsoluteFill>
}

/** A line of narration in the scene's top left, rising in at `delay`. */
export const Caption: React.FC<{ delay?: number; children: React.ReactNode; size?: number; top?: number }> = ({
  delay = 0,
  children,
  size = 64,
  top = 110,
}) => {
  const frame = useCurrentFrame()
  const t = ease(frame, delay, delay + 18)
  return (
    <div
      style={{
        position: 'absolute',
        left: 140,
        top,
        maxWidth: 1400,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: '-0.025em',
        lineHeight: 1.08,
        opacity: t,
        transform: `translateY(${(1 - t) * 24}px)`,
      }}
    >
      {children}
    </div>
  )
}

export const Accent: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={{ color: C.accent }}>{children}</span>

/** The brand mark: an upright bar in the accent. */
export const Mark: React.FC<{ height?: number }> = ({ height = 40 }) => (
  <div style={{ width: height * 0.42, height, borderRadius: height * 0.12, background: C.accent }} />
)

/** The pointer, in white with a dark edge; it shrinks a little while pressed. */
export const Cursor: React.FC<{ x: number; y: number; pressed?: boolean }> = ({ x, y, pressed = false }) => (
  <svg width={36} height={44} viewBox="0 0 19 23" style={{ position: 'absolute', left: x, top: y, transform: `scale(${pressed ? 0.86 : 1})`, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.45))' }}>
    <path d="M1 1 L1 18 L5.5 13.8 L8.6 21 L11.6 19.7 L8.6 12.6 L14.6 12.6 Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
)

/** How many characters of `text` show `frame - delay` frames after typing starts at `cps` a second. */
export function typedCount(text: string, frame: number, delay: number, cps: number, fps = 30): number {
  return Math.max(0, Math.min(text.length, Math.floor(((frame - delay) / fps) * cps)))
}

/** Text that types itself from `delay`, `cps` characters a second. */
export const Typed: React.FC<{ text: string; delay: number; cps?: number; caret?: boolean }> = ({ text, delay, cps = 28, caret = false }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const shown = Math.max(0, Math.min(text.length, Math.floor(((frame - delay) / fps) * cps)))
  const isTyping = shown > 0 && shown < text.length
  return (
    <>
      {text.slice(0, shown)}
      {caret && (isTyping || Math.floor(frame / 15) % 2 === 0) ? <span style={{ color: C.accent }}>▍</span> : null}
    </>
  )
}
