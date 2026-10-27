import React from 'react'

import { DESKTOP as Q } from '../../cues.mjs'
import { Typed, ease } from '../../kit'
import { NOTEBOOK, Note, frontMatter } from '../../story'
import { C, MONO } from '../../theme'
import { CARD } from './layout'

type Props = {
  frame: number
  note: Note
  left: number
  top: number
  scale: number
  opacity: number
  /** When given, the front matter types in from this frame and the body follows at the cues' `body`; otherwise the file is shown whole. */
  typing?: number
}

/** The first sentence of a note, as the file's body shows it. */
const opening = (note: Note): string => `${note.text.split('. ')[0]}…`

/** A note's Markdown file: its path, its front matter and the start of its body, on paper. */
export const FileCard: React.FC<Props> = ({ frame, note, left, top, scale, opacity, typing }) => (
  <div
    style={{
      position: 'absolute',
      left,
      top,
      width: CARD.width,
      height: CARD.height,
      transformOrigin: 'top left',
      transform: `scale(${scale})`,
      opacity,
      borderRadius: 20,
      background: C.paper,
      color: C.ink,
      boxShadow: '0 40px 120px rgba(0,0,0,.5)',
      overflow: 'hidden',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 64, padding: '0 28px', borderBottom: '1px solid #e6e6e2', fontFamily: MONO, fontSize: 21, color: C.inkMuted, whiteSpace: 'nowrap' }}>
      <span style={{ color: C.accentDeep }}>{NOTEBOOK}/</span>
      {note.file}
    </div>
    <div style={{ padding: '22px 30px', fontFamily: MONO, fontSize: 22, lineHeight: 1.6 }}>
      {frontMatter(note).map((line, i) => {
        const at = typing === undefined ? -1 : typing + i * Q.step
        const [key, ...rest] = line.split(': ')
        const value = rest.join(': ')
        return (
          <div key={i} style={{ minHeight: 35, color: line === '---' ? '#b3b2ab' : C.ink }}>
            {frame >= at &&
              (rest.length === 0 ? (
                typing === undefined ? line : <Typed text={line} delay={at} cps={60} />
              ) : (
                <>
                  <span style={{ color: C.accentDeep }}>{key}:</span> {typing === undefined ? value : <Typed text={value} delay={at + 2} cps={70} />}
                </>
              ))}
          </div>
        )
      })}
      <div style={{ marginTop: 16, opacity: typing === undefined ? 1 : ease(frame, Q.body, Q.body + 14) }}>
        <div style={{ fontWeight: 700, fontSize: 24 }}>## {note.title}</div>
        <div style={{ color: '#55554f', fontSize: 21, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opening(note)}</div>
      </div>
    </div>
  </div>
)
