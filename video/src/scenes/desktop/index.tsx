import React from 'react'
import { Easing, interpolate, useCurrentFrame } from 'remotion'

import { DESKTOP as Q, FRAMES } from '../../cues.mjs'
import { Accent, Caption, Cursor, Scene, ease, useSpring } from '../../kit'
import { INSIGHT, LEARNING, NOTEBOOK, NOTES } from '../../story'
import { C } from '../../theme'
import { Composer, SaveButton, Sidebar, TitleBar, Toast } from './Chrome'
import { FileCard } from './FileCard'
import { BUTTON_BOTTOM, BUTTON_HEIGHT, BUTTON_WIDTH, CARD, NOTE_ROWS, PANE, SAVE_BUTTON, VIEW_HEIGHT, VIEW_TOP, WIN, columnAt } from './layout'
import { Pane } from './Pane'
import { BOTTOM, MESSAGES, TOPS, centreOn, follow } from './script'

export const DESKTOP_FRAMES = FRAMES.desktop

/**
 * Claude Code's desktop app, drawn in its own layout (sessions on the left,
 * the conversation, the Live Notebook pane on the right), through one session
 * designing a feature: an insight saved as it is said, a side question's
 * answer buried by the rush and rescued, both notes becoming files.
 */

/** What the narration says, and from when; each line holds until the next. */
const CAPTIONS: Array<{ at: number; text: React.ReactNode }> = [
  { at: 4, text: 'You’re designing a feature with Claude.' },
  {
    at: 56,
    text: (
      <>
        It says something <Accent>worth keeping.</Accent>
      </>
    ),
  },
  { at: 156, text: 'One click. Keep going.' },
  { at: 192, text: 'A side question lands in the same chat.' },
  { at: 296, text: '…and the chat buries it.' },
  { at: 380, text: 'Which one was it again?' },
  { at: 432, text: 'There’s a button under every reply.' },
  {
    at: 528,
    text: (
      <>
        Saved as <Accent>plain Markdown files.</Accent>
      </>
    ),
  },
]

/** The chat follows each new message, races away with the rush, then rewinds to the learning. */
const SCROLL: Array<[number, number]> = [
  [0, 0],
  [236, 0],
  [246, follow(4)],
  [254, follow(4)],
  [264, follow(5)],
  [278, follow(5)],
  [290, follow(6)],
  [Q.race[0], follow(6)],
  [Q.race[1], BOTTOM - VIEW_HEIGHT],
  [Q.rewind[0], BOTTOM - VIEW_HEIGHT],
  [Q.rewind[1], centreOn(1)],
]

function scrollAt(frame: number): number {
  return interpolate(
    frame,
    SCROLL.map(([at]) => at),
    SCROLL.map(([, scroll]) => scroll),
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) },
  )
}

/** Where kept reply `k`'s Save to notebook button is on screen (its top left), at a scroll and pane progress. */
function keptButton(k: number, scroll: number, p: number): { x: number; y: number } {
  const i = Q.kept[k]
  const column = columnAt(p)
  return { x: column.left + column.width - 4 - BUTTON_WIDTH, y: WIN.top + VIEW_TOP + TOPS[i] + MESSAGES[i].height - BUTTON_BOTTOM - BUTTON_HEIGHT - scroll }
}

type Point = { x: number; y: number }

/** The cursor's route: in from the corner to the insight's button, to the pane's Save; later from Save to the learning's button and back to Save. */
const PATH: Array<[number, Point]> = (() => {
  const corner = { x: 1560, y: 980 }
  const first = keptButton(0, 0, 0)
  const second = keptButton(1, centreOn(1), 1)
  const onButton = (button: Point): Point => ({ x: button.x + BUTTON_WIDTH / 2, y: button.y + 12 })
  const onSave = { x: SAVE_BUTTON.x + 18, y: SAVE_BUTTON.y + 12 }
  return [
    [Q.cursorIn[0], corner],
    [Q.cursorIn[0] + 4, corner],
    [Q.clickButton[0] - 2, onButton(first)],
    [Q.paneOpen[1] + 6, onButton(first)],
    [Q.clickSave[0] - 2, onSave],
    [Q.cursorIn[1] + 2, onSave],
    [Q.clickButton[1] - 2, onButton(second)],
    [Q.clickButton[1] + 8, onButton(second)],
    [Q.clickSave[1] - 2, onSave],
  ]
})()

function cursorAt(frame: number): Point {
  if (frame <= PATH[0][0]) return PATH[0][1]
  for (let i = 1; i < PATH.length; i += 1) {
    const [from, start] = PATH[i - 1]
    const [to, end] = PATH[i]
    if (frame <= to) {
      const t = ease(frame, from, to, Easing.inOut(Easing.cubic))
      return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
    }
  }
  return PATH[PATH.length - 1][1]
}

/** 0 → 1 over ten frames from `from`, back to 0 over ten frames from `to`. */
const during = (frame: number, from: number, to: number) => ease(frame, from, from + 10) * (1 - ease(frame, to, to + 10))

export const Desktop: React.FC = () => {
  const frame = useCurrentFrame()
  const scroll = scrollAt(frame)
  const blur = Math.min(8, Math.abs(scrollAt(frame + 1) - scroll) / 14)
  const p = ease(frame, Q.paneOpen[0], Q.paneOpen[1], Easing.bezier(0.2, 0.9, 0.3, 1))
  const column = columnAt(p)
  const away = ease(frame, Q.morph, Q.morph + 34)

  const cursor = cursorAt(frame)
  const cursorShown = Math.min(1, during(frame, Q.cursorIn[0], Q.clickSave[0] + 10) + during(frame, Q.cursorIn[1], Q.clickSave[1] + 10))
  const pressed = [...Q.clickButton, ...Q.clickSave].some(at => frame >= at && frame < at + 6)

  // The two notes lift out of the pane into their files: the learning in front, the insight behind it.
  const lift = useSpring(Q.morph + 2, 16, 0.9)
  const liftBehind = useSpring(Q.morph + 6, 16, 0.9)
  const behind = { left: CARD.left + 40, top: CARD.top - 44 }

  const caption = CAPTIONS.reduce<{ at: number; text: React.ReactNode } | null>((last, next) => (frame >= next.at - 2 ? next : last), null)

  return (
    <Scene duration={DESKTOP_FRAMES} fadeIn={8}>
      {caption && (
        <Caption key={caption.at} delay={caption.at} size={50} top={62}>
          {caption.text}
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
        <TitleBar />
        <Sidebar />

        {/* The conversation */}
        <div style={{ position: 'absolute', left: column.left - WIN.left, width: column.width, top: VIEW_TOP, height: VIEW_HEIGHT, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll, filter: `blur(${blur}px)` }}>
            {MESSAGES.map((message, i) => {
              const shown = ease(frame, Q.messages[i].at, Q.messages[i].at + 8)
              const k = message.kept
              const lit = k === undefined ? 0 : ease(frame, Q.glow[k], Q.glow[k] + 18)
              const isPressed = k !== undefined && frame >= Q.clickButton[k] && frame < Q.clickButton[k] + 6
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: TOPS[i],
                    height: message.role === 'agent' ? message.height : 'auto',
                    left: message.role === 'user' ? 'auto' : 0,
                    right: 0,
                    maxWidth: message.role === 'user' ? '70%' : '100%',
                    fontSize: 21,
                    lineHeight: 1.45,
                    color: C.text,
                    opacity: shown,
                    transform: `translateY(${(1 - shown) * 16}px)`,
                  }}
                >
                  <div style={message.role === 'user' ? { padding: '14px 20px', borderRadius: 16, background: '#33332f' } : { padding: '2px 4px' }}>{message.body}</div>
                  {message.role === 'agent' && <SaveButton lit={lit} pressed={isPressed} />}
                </div>
              )
            })}
          </div>
        </div>
        <Composer column={column} />

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
          {frame >= Q.paneOpen[0] && <Pane frame={frame} />}
        </div>

        {NOTES.map((note, k) => (
          <Toast key={note.title} shown={during(frame, Q.saved[k] + 2, Q.saved[k] + 30)}>
            Saved to {NOTEBOOK}: {note.title}
          </Toast>
        ))}
      </div>

      {cursorShown > 0 && (
        <div style={{ opacity: cursorShown }}>
          <Cursor x={cursor.x} y={cursor.y} pressed={pressed} />
        </div>
      )}

      {/* The notes' files */}
      {frame >= Q.morph + 6 && (
        <FileCard
          frame={frame}
          note={INSIGHT}
          left={interpolate(liftBehind, [0, 1], [NOTE_ROWS[0].x, behind.left])}
          top={interpolate(liftBehind, [0, 1], [NOTE_ROWS[0].y, behind.top])}
          scale={interpolate(liftBehind, [0, 1], [0.6, 1])}
          opacity={ease(frame, Q.morph + 6, Q.morph + 14) * 0.7}
        />
      )}
      {frame >= Q.morph + 2 && (
        <FileCard
          frame={frame}
          note={LEARNING}
          left={interpolate(lift, [0, 1], [NOTE_ROWS[1].x, CARD.left])}
          top={interpolate(lift, [0, 1], [NOTE_ROWS[1].y, CARD.top])}
          scale={interpolate(lift, [0, 1], [0.6, 1])}
          opacity={ease(frame, Q.morph + 2, Q.morph + 10)}
          typing={Q.typing}
        />
      )}
    </Scene>
  )
}
