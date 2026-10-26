import React from 'react'
import { Easing, interpolate, useCurrentFrame } from 'remotion'

import { EXPORT as X, FRAMES, YOURS as Y } from '../cues.mjs'
import { Accent, Caption, Cursor, Scene, ease, typedCount, useSpring } from '../kit'
import { C, MONO, SANS } from '../theme'

export const YOURS_FRAMES = FRAMES.yours
export const EXPORT_FRAMES = FRAMES.export

/** The web notebook, drawn in its own light layout: notebooks on the left, one note open in the editor. */
const WIN = { left: 110, top: 150, width: 1700, height: 870 }
const BAR = 46
const SIDE = 400
const W = { bg: '#fbfbfa', panel: '#f3f3f1', line: '#e6e6e2', text: '#1f1f1d', muted: '#7a7a74', accent: '#d97757', hover: '#ebebe8', picked: '#e4e4e0' }

type Row = { title: string; preview: string; glyph: string; isOpen?: boolean; isNew?: boolean }
type Notebook = { name: string; rows: Row[]; isHovered?: boolean; exportPressed?: boolean }

const LEARNING = '↗'

const BINARY =
  'Halve the range at each step: compare the target with the middle item and keep the half that can still hold it. That is O(log n): a million items take about 20 steps.'

function notebooksAt(frame: number, scene: 'yours' | 'export'): Notebook[] {
  const isNew = scene === 'export' || frame >= Y.clickNew
  const newTitle = scene === 'export' ? Y.title : Y.title.slice(0, typedCount(Y.title, frame, Y.titleAt, Y.cps.title)) || 'Untitled'
  const openNew = scene === 'yours' && frame >= Y.clickNew
  return [
    {
      name: 'Algorithms',
      rows: [
        ...(isNew ? [{ title: newTitle, preview: scene === 'export' || frame >= Y.bodyAt ? Y.body.split('\n')[0] : '—', glyph: '•', isOpen: openNew, isNew: true }] : []),
        { title: 'Binary search', preview: BINARY, glyph: LEARNING, isOpen: scene === 'yours' && !openNew },
        { title: 'Recursion needs a base case', preview: 'A recursive function must stop: the base case returns without calling itself…', glyph: LEARNING },
        { title: 'Big-O of common loops', preview: 'One loop over n items is O(n); a loop inside a loop is O(n²)…', glyph: LEARNING },
      ],
    },
    { name: 'Data structures', rows: [{ title: 'Hash maps vs. arrays', preview: 'Look-up by key in O(1) on average…', glyph: '◉' }] },
  ]
}

const Sidebar: React.FC<{ notebooks: Notebook[]; newPressed?: boolean; exportHover?: number; exportPressed?: boolean }> = ({ notebooks, newPressed = false, exportHover = 0, exportPressed = false }) => (
  <div style={{ position: 'absolute', left: 0, top: BAR, bottom: 0, width: SIDE, background: W.panel, borderRight: `1px solid ${W.line}`, padding: '22px 20px', boxSizing: 'border-box', fontFamily: SANS }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, fontWeight: 700, color: W.text }}>
      <div style={{ width: 8, height: 18, borderRadius: 2, background: W.accent }} /> Live Notebook
    </div>
    <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
      <div style={{ padding: '9px 16px', borderRadius: 9, background: newPressed ? '#c4643f' : W.accent, color: '#fff', fontSize: 17, fontWeight: 600, transform: `scale(${newPressed ? 0.95 : 1})` }}>+ New Note</div>
      <div style={{ padding: '9px 16px', borderRadius: 9, border: `1px solid ${W.line}`, background: '#fff', color: W.text, fontSize: 17 }}>+ New Notebook</div>
    </div>
    <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 9, border: `1px solid ${W.line}`, background: '#fff', color: '#a3a29b', fontSize: 17 }}>Search notes…</div>
    {notebooks.map((notebook, n) => (
      <div key={notebook.name} style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 7, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: W.muted, background: n === 0 && exportHover > 0 ? W.hover : 'transparent' }}>
          <span>⌄ {notebook.name}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {n === 0 && exportHover > 0 && (
              <span style={{ opacity: exportHover, padding: '2px 10px', borderRadius: 6, border: `1px solid ${exportPressed ? W.accent : W.line}`, color: exportPressed ? W.accent : W.text, background: '#fff', letterSpacing: 0, textTransform: 'none', fontSize: 14, transform: `scale(${exportPressed ? 0.94 : 1})` }}>
                Export
              </span>
            )}
            {notebook.rows.length}
          </span>
        </div>
        {notebook.rows.map(row => (
          <div key={row.title + row.glyph} style={{ marginTop: 4, padding: '9px 10px', borderRadius: 8, background: row.isOpen ? W.picked : 'transparent', opacity: row.isNew ? 1 : 1 }}>
            <div style={{ display: 'flex', gap: 10, fontSize: 18, fontWeight: 600, color: W.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ color: W.accent }}>{row.glyph}</span>
              {row.title}
            </div>
            <div style={{ marginTop: 2, fontSize: 15, color: W.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.preview}</div>
          </div>
        ))}
      </div>
    ))}
  </div>
)

const Toolbar: React.FC = () => (
  <div style={{ display: 'flex', gap: 20, padding: '12px 0', borderTop: `1px solid ${W.line}`, borderBottom: `1px solid ${W.line}`, color: '#55554f', fontSize: 19 }}>
    {['H', 'B', 'I', 'S', '|', '☰', '1.', '☑', '❝', '</>', '⌁', '▦', '|', '↶', '↷'].map((tool, i) => (
      <span key={i} style={{ color: tool === '|' ? W.line : undefined }}>
        {tool}
      </span>
    ))}
  </div>
)

/** `code` spans as the editor shows them; a span still being typed shows as code from its opening tick. */
const Inline: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split('`').map((part, i) =>
      i % 2 === 1 ? (
        <code key={i} style={{ padding: '2px 8px', borderRadius: 6, background: '#efeee9', fontFamily: MONO, fontSize: '0.86em', color: '#c4643f' }}>
          {part}
        </code>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    )}
  </>
)

/** Markdown as the editor shows it: a quote with its bar, a task list with boxes, inline code, the rest as text. */
const Rendered: React.FC<{ text: string; caretAt?: number }> = ({ text, caretAt }) => (
  <>
    {text.split('\n').map((line, i, lines) => {
      const isLast = i === lines.length - 1
      const caret = caretAt !== undefined && isLast ? <span style={{ color: W.accent }}>▍</span> : null
      if (line.startsWith('> ')) {
        return (
          <div key={i} style={{ marginTop: 14, padding: '6px 16px', borderLeft: `4px solid ${W.accent}`, background: '#f6ede8', color: W.text, borderRadius: '0 8px 8px 0' }}>
            {line.slice(2)}
            {caret}
          </div>
        )
      }
      if (/^- \[ \] ?/.test(line) || /^-( \[?( \]?)?)?$/.test(line)) {
        const rest = line.replace(/^- \[ \] ?/, '').replace(/^-( \[?( \]?)?)?$/, '')
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <span style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid #b3b2ab`, display: 'inline-block', flex: 'none' }} />
            <span>
              {rest}
              {caret}
            </span>
          </div>
        )
      }
      return (
        <div key={i} style={{ marginTop: i === 0 ? 0 : 10 }}>
          <Inline text={line} />
          {caret}
        </div>
      )
    })}
  </>
)

const Window: React.FC<{ children: React.ReactNode; dim?: number }> = ({ children, dim = 0 }) => (
  <div
    style={{
      position: 'absolute',
      ...WIN,
      borderRadius: 18,
      background: W.bg,
      color: W.text,
      fontFamily: SANS,
      overflow: 'hidden',
      boxShadow: '0 40px 120px rgba(0,0,0,.5)',
      opacity: 1 - dim * 0.78,
      transform: `translateX(${dim * 240}px) scale(${1 - dim * 0.06})`,
      filter: `blur(${dim * 5}px)`,
    }}
  >
    <div style={{ height: BAR, display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px', background: '#ecebe7', borderBottom: `1px solid ${W.line}` }}>
      {['#ff5f57', '#febc2e', '#28c840'].map(color => (
        <div key={color} style={{ width: 12, height: 12, borderRadius: 6, background: color }} />
      ))}
      <div style={{ marginLeft: 220, padding: '5px 18px', borderRadius: 8, background: '#fff', color: W.muted, fontSize: 15, border: `1px solid ${W.line}` }}>127.0.0.1:47231 · on this computer</div>
    </div>
    {children}
  </div>
)

const MAIN_LEFT = WIN.left + SIDE + 90

export const Yours: React.FC = () => {
  const frame = useCurrentFrame()
  const isNew = frame >= Y.clickNew
  const addedShown = typedCount(Y.added, frame, Y.addAt, Y.cps.added)
  const titleShown = typedCount(Y.title, frame, Y.titleAt, Y.cps.title)
  const bodyShown = typedCount(Y.body, frame, Y.bodyAt, Y.cps.body)
  const isTypingAdd = frame >= Y.clickInto && frame < Y.saved
  const isTypingNew = frame >= Y.titleAt
  const saved = (from: number) => ease(frame, from, from + 8) * (1 - ease(frame, from + 40, from + 50))

  // The pointer: into the note's last line, then to + New Note.
  const toNote = ease(frame, 6, Y.clickInto - 2, Easing.inOut(Easing.cubic))
  const toNew = ease(frame, Y.saved + 2, Y.clickNew - 2, Easing.inOut(Easing.cubic))
  const cursorX = interpolate(toNew, [0, 1], [interpolate(toNote, [0, 1], [1500, MAIN_LEFT + 760]), WIN.left + 90])
  const cursorY = interpolate(toNew, [0, 1], [interpolate(toNote, [0, 1], [960, WIN.top + 420]), WIN.top + BAR + 78])
  const pressed = (frame >= Y.clickInto && frame < Y.clickInto + 6) || (frame >= Y.clickNew && frame < Y.clickNew + 6)

  return (
    <Scene duration={YOURS_FRAMES}>
      {frame < Y.clickNew - 6 ? (
        <Caption delay={4} size={50} top={62}>
          Edit any note. <Accent>Add what you understood.</Accent>
        </Caption>
      ) : (
        <Caption delay={Y.clickNew - 4} size={50} top={62}>
          Or write <Accent>your own.</Accent>
        </Caption>
      )}
      <Window>
        <Sidebar notebooks={notebooksAt(frame, 'yours')} newPressed={frame >= Y.clickNew && frame < Y.clickNew + 6} />
        <div style={{ position: 'absolute', left: SIDE + 90, right: 90, top: BAR + 44, fontFamily: SANS }}>
          <div style={{ fontSize: 15, letterSpacing: '0.1em', color: W.muted }}>ALGORITHMS</div>
          <div style={{ marginTop: 6, fontSize: 46, fontWeight: 750, letterSpacing: '-0.02em', color: isNew && titleShown === 0 ? '#c9c8c2' : W.text }}>
            {isNew ? Y.title.slice(0, titleShown) || 'Untitled' : 'Binary search'}
            {isNew && isTypingNew && titleShown < Y.title.length ? <span style={{ color: W.accent }}>▍</span> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '12px 0 16px', fontSize: 17, color: W.muted }}>
            {isNew ? 'Created just now' : 'Created Oct 21 · saved from a Claude reply'}
            <span style={{ padding: '3px 10px', borderRadius: 7, border: `1px solid ${W.line}`, color: W.accent }}>{isNew ? '• Other' : `${LEARNING} Learning`} ▾</span>
            <span style={{ marginLeft: 'auto', color: '#3f8a5a', opacity: isNew ? saved(Y.done + 4) : saved(Y.saved) }}>Saved</span>
          </div>
          <Toolbar />
          <div style={{ marginTop: 26, fontSize: 25, lineHeight: 1.55, color: W.text }}>
            {isNew ? (
              frame >= Y.bodyAt ? <Rendered text={Y.body.slice(0, bodyShown)} caretAt={bodyShown < Y.body.length ? bodyShown : undefined} /> : <div style={{ color: '#c9c8c2' }}>Write in markdown…</div>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 30, marginBottom: 10 }}>Binary search</div>
                <div>{BINARY}</div>
                {frame >= Y.clickInto && <Rendered text={Y.added.slice(0, addedShown) || ' '} caretAt={isTypingAdd ? addedShown : undefined} />}
              </>
            )}
          </div>
        </div>
      </Window>
      {frame < Y.clickNew + 16 && (
        <div style={{ opacity: ease(frame, 4, 12) * (1 - ease(frame, Y.clickNew + 6, Y.clickNew + 16)) }}>
          <Cursor x={cursorX} y={cursorY} pressed={pressed} />
        </div>
      )}
    </Scene>
  )
}

/** What Export writes: the notebook as one Markdown file, laid out as the real export lays it out. */
const EXPORTED = [
  '# Algorithms',
  '#algorithms #cs-201',
  '_Exported from Live Notebook on 2026-10-26 · 4 notes_',
  '---',
  `## ${Y.title}`,
  ...Y.body.split('\n'),
  '---',
  '## Binary search',
  '_learning · created 2026-10-21 · from a message_',
  'Halve the range at each step: compare the target with…',
  '> My note: it only works on a sorted array, so check that first.',
  '---',
  '## Recursion needs a base case',
]

const mdColor = (line: string) =>
  line.startsWith('#') ? (line.startsWith('#a') ? C.accentDeep : C.ink) : line.startsWith('_') ? C.inkMuted : line === '---' ? '#b3b2ab' : line.startsWith('>') ? C.accentDeep : '#3d3d38'

export const Export: React.FC = () => {
  const frame = useCurrentFrame()
  const dialog = useSpring(X.dialog, 18)
  const closed = ease(frame, X.save + 2, X.save + 10)
  const away = ease(frame, X.file, X.file + 30)
  const file = useSpring(X.file + 2, 16, 0.9)

  const toHead = ease(frame, 2, X.hover, Easing.inOut(Easing.cubic))
  const toExport = ease(frame, X.hover + 2, X.click - 2, Easing.inOut(Easing.cubic))
  const toSave = ease(frame, X.dialog + 14, X.save - 2, Easing.inOut(Easing.cubic))
  const headY = WIN.top + BAR + 196
  const exportX = WIN.left + SIDE - 120
  const saveButton = { x: 1196, y: 452 }
  const cursorX = interpolate(toSave, [0, 1], [interpolate(toExport, [0, 1], [interpolate(toHead, [0, 1], [1400, WIN.left + 150]), exportX + 20]), saveButton.x + 30])
  const cursorY = interpolate(toSave, [0, 1], [interpolate(toExport, [0, 1], [interpolate(toHead, [0, 1], [900, headY]), headY]), saveButton.y + 10])
  const pressed = (frame >= X.click && frame < X.click + 6) || (frame >= X.save && frame < X.save + 6)

  return (
    <Scene duration={EXPORT_FRAMES}>
      <Caption delay={4} size={50} top={62}>
        Export a notebook as <Accent>one Markdown file.</Accent>
      </Caption>
      {frame >= X.file + 14 && (
        <div style={{ position: 'absolute', left: 1100, top: 470, width: 640, fontSize: 34, lineHeight: 1.3, color: C.text, fontWeight: 700, opacity: ease(frame, X.file + 20, X.file + 36), letterSpacing: '-0.02em' }}>
          A study guide, ready to
          <br />
          <Accent>share, print or revise from.</Accent>
        </div>
      )}
      <Window dim={away}>
        <Sidebar notebooks={notebooksAt(frame, 'export')} exportHover={ease(frame, X.hover - 4, X.hover + 4)} exportPressed={frame >= X.click && frame < X.click + 6} />
        <div style={{ position: 'absolute', left: SIDE + 90, right: 90, top: BAR + 44 }}>
          <div style={{ fontSize: 15, letterSpacing: '0.1em', color: W.muted }}>ALGORITHMS</div>
          <div style={{ marginTop: 6, fontSize: 46, fontWeight: 750, letterSpacing: '-0.02em' }}>{Y.title}</div>
          <div style={{ margin: '12px 0 16px', fontSize: 17, color: W.muted }}>Created today</div>
          <Toolbar />
          <div style={{ marginTop: 26, fontSize: 25, lineHeight: 1.55 }}>
            <Rendered text={Y.body} />
          </div>
        </div>
        {/* The Save dialog */}
        {frame >= X.dialog && (
          <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${0.18 * dialog * (1 - closed)})` }}>
            <div
              style={{
                position: 'absolute',
                left: (WIN.width - 620) / 2,
                top: BAR,
                width: 620,
                padding: '26px 30px',
                boxSizing: 'border-box',
                borderRadius: '0 0 16px 16px',
                background: '#fff',
                boxShadow: '0 24px 60px rgba(0,0,0,.25)',
                transform: `translateY(${(dialog - 1) * 60 - closed * 80}px)`,
                opacity: dialog * (1 - closed),
                fontSize: 18,
                color: W.text,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 20 }}>Export Algorithms as one markdown file</div>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '14px 12px', marginTop: 22, alignItems: 'center' }}>
                <span style={{ color: W.muted }}>Save As</span>
                <span style={{ padding: '7px 12px', border: `2px solid ${W.accent}`, borderRadius: 8, fontFamily: MONO, fontSize: 18 }}>algorithms.md</span>
                <span style={{ color: W.muted }}>Where</span>
                <span style={{ padding: '7px 12px', border: `1px solid ${W.line}`, borderRadius: 8 }}>Downloads ▾</span>
                <span style={{ color: W.muted }}>Format</span>
                <span style={{ padding: '7px 12px', border: `1px solid ${W.line}`, borderRadius: 8 }}>Markdown (.md) ▾ <span style={{ color: W.muted }}> or plain text</span></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                <span style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${W.line}` }}>Cancel</span>
                <span style={{ padding: '8px 22px', borderRadius: 8, background: frame >= X.save && frame < X.save + 6 ? '#c4643f' : W.accent, color: '#fff', fontWeight: 650 }}>Save</span>
              </div>
            </div>
          </div>
        )}
      </Window>

      {/* The exported file */}
      {frame >= X.file + 2 && (
        <div
          style={{
            position: 'absolute',
            left: 140,
            top: 190,
            width: 900,
            height: 700,
            borderRadius: 20,
            background: C.paper,
            color: C.ink,
            boxShadow: '0 40px 120px rgba(0,0,0,.5)',
            overflow: 'hidden',
            opacity: ease(frame, X.file + 2, X.file + 10),
            transform: `translateY(${(1 - file) * 120}px) scale(${0.8 + file * 0.2})`,
            transformOrigin: 'top left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 64, padding: '0 28px', borderBottom: '1px solid #e6e6e2', fontFamily: MONO, fontSize: 21, color: C.inkMuted }}>
            <span style={{ color: C.accentDeep }}>Downloads/</span>algorithms.md
          </div>
          <div style={{ padding: '20px 30px', fontFamily: MONO, fontSize: 21, lineHeight: 1.55 }}>
            {EXPORTED.map((line, i) => (
              <div key={i} style={{ minHeight: 33, color: mdColor(line), fontWeight: line.startsWith('# ') || line.startsWith('## ') ? 700 : 400, opacity: ease(frame, X.reveal + i * 4, X.reveal + i * 4 + 6), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {frame < X.save + 16 && (
        <div style={{ opacity: ease(frame, 0, 8) * (1 - ease(frame, X.save + 6, X.save + 16)) }}>
          <Cursor x={cursorX} y={cursorY} pressed={pressed} />
        </div>
      )}
    </Scene>
  )
}
