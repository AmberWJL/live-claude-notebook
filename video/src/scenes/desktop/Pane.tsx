import React from 'react'

import { DESKTOP as Q } from '../../cues.mjs'
import { ease } from '../../kit'
import { NOTEBOOK, NOTES, Note } from '../../story'
import { C, MONO } from '../../theme'
import { TITLE } from './layout'

/** The draft the pane opens with: the reply, ready to save into a notebook with a type. */
const Draft: React.FC<{ note: Note; pressed: boolean }> = ({ note, pressed }) => (
  <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, fontSize: 18 }}>
      <span style={{ color: C.muted }}>← {NOTEBOOK} /</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note.title}</span>
      <span style={{ color: C.muted }}>Discard</span>
      <span style={{ padding: '6px 14px', borderRadius: 8, background: pressed ? C.accentDeep : C.text, color: pressed ? '#fff' : C.ground, fontWeight: 650 }}>Save</span>
    </div>
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', height: 44, fontSize: 16, color: C.muted }}>
      Notebook <span style={{ color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, padding: '4px 10px' }}>{NOTEBOOK} ▾</span>
      Type{' '}
      <span style={{ color: C.accent, border: `1px solid ${C.line}`, borderRadius: 7, padding: '4px 10px' }}>
        {note.glyph} {note.type} ▾
      </span>
    </div>
    <div style={{ display: 'flex', gap: 18, height: 40, alignItems: 'center', fontSize: 16, color: C.muted, borderBottom: `1px solid ${C.line}` }}>
      {['H1', 'H2', 'B', 'I', '</>', 'Link', '• List', 'Quote'].map(tool => (
        <span key={tool}>{tool}</span>
      ))}
    </div>
    <div style={{ paddingTop: 16, fontSize: 18, lineHeight: 1.55, color: C.text }}>
      <div style={{ fontWeight: 700 }}>## {note.title}</div>
      <div style={{ marginTop: 6 }}>{note.text}</div>
      {note.code && (
        <>
          <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 16, color: '#d7d5cc' }}>```sql</div>
          <div style={{ fontFamily: MONO, fontSize: 16, color: '#d7d5cc' }}>{note.code}</div>
          <div style={{ fontFamily: MONO, fontSize: 16, color: '#d7d5cc' }}>```</div>
        </>
      )}
    </div>
  </>
)

/** The notebook after a save: the Design notes so far, then the other notebooks. Its rows lift out into files at the morph. */
const List: React.FC<{ count: number; frame: number }> = ({ count, frame }) => (
  <>
    <div style={{ display: 'flex', gap: 22, height: 44, alignItems: 'center', fontSize: 16, color: C.muted }}>
      <span style={{ color: C.text }}>All notes</span>
      <span>◉ Insights</span>
      <span>↗ Learnings</span>
      <span>▤ References</span>
    </div>
    <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', fontSize: 14, letterSpacing: '0.1em', color: C.faint }}>
      <span>{NOTEBOOK.toUpperCase()}</span>
      <span>{count}</span>
    </div>
    {NOTES.slice(0, count).map((note, k) => {
      const lift = k === 1 ? Q.morph : Q.morph + 4
      return (
        <div key={note.title} style={{ marginTop: 10, padding: '12px 14px', borderRadius: 10, background: '#2c2c29', opacity: 1 - ease(frame, lift, lift + 8) }}>
          <div style={{ fontSize: 19, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{ color: C.accent }}>{note.glyph}</span> {note.title}
          </div>
          <div style={{ marginTop: 4, fontSize: 15, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note.text}</div>
        </div>
      )
    })}
    <div style={{ marginTop: 28, fontSize: 14, letterSpacing: '0.1em', color: C.faint }}>PAYMENTS · OPS</div>
    {['Retry with backoff', 'Blue/green deploys'].map(title => (
      <div key={title} style={{ marginTop: 12, padding: '0 14px', fontSize: 18, color: C.muted }}>
        {title}
      </div>
    ))}
  </>
)

/**
 * The Live Notebook pane: the first draft until it is saved, the notebook with
 * one note, the second draft while it is being saved, then the notebook with
 * both.
 */
export const Pane: React.FC<{ frame: number }> = ({ frame }) => {
  const draft = frame < Q.saved[0] ? 0 : frame >= Q.clickButton[1] && frame < Q.saved[1] ? 1 : null
  const count = frame < Q.saved[1] ? 1 : 2
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '0 22px', boxSizing: 'border-box' }}>
      <div style={{ height: TITLE, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: C.muted, fontSize: 16 }}>
        <span>Live Notebook</span>
        <span style={{ letterSpacing: 10 }}>⤢ ✕</span>
      </div>
      {draft !== null ? <Draft note={NOTES[draft]} pressed={frame >= Q.clickSave[draft] && frame < Q.clickSave[draft] + 6} /> : <List count={count} frame={frame} />}
    </div>
  )
}
