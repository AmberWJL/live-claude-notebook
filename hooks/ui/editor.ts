/**
 * A multi-line text editor drawn by a `Client`: the Mod API's Input is one
 * line, so this surface module keeps the lines, the cursor, the selection
 * and the scroll itself and posts the text to the hooks module after every
 * change.
 *
 * Runs on the drawing thread with no `$`: pure functions over a small state,
 * exported so the tests can drive them without a surface.
 */
import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface, RenderElement } from 'claude-code'

export type EditorProps = {
  /** Changes when a different text should replace what is being edited. */
  draftId: string
  text: string
  placeholder?: string
  /** The toolbar's latest command; a new `id` is applied once. */
  command?: { id: number; kind: string } | null
  /** The region's size as the hooks module laid it out; used until the surface reports its own. */
  columns?: number
  rows?: number
}

export type Point = { row: number; col: number }

/** A text with the cursor that was in it, for undo and redo. */
type Snapshot = { text: string; row: number; col: number }

export type EditorState = {
  draftId: string
  lines: string[]
  row: number
  col: number
  /** The first visual row shown. */
  top: number
  /** The other end of the selection, the cursor being one; absent when nothing is selected. */
  anchor?: Point
  /** Earlier texts, newest last, for undo; and the ones undone, for redo. */
  history?: Snapshot[]
  future?: Snapshot[]
  /** The last toolbar command applied, by id. */
  commandId?: number
}

/** What the toolbar can ask of the editor. */
export type EditorCommand =
  | 'bold'
  | 'italic'
  | 'code'
  | 'link'
  | 'bullet'
  | 'number'
  | 'quote'
  | 'normal'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'undo'
  | 'redo'

const HISTORY_MAX = 60

/** The heading level of the cursor's line; what the toolbar's heading picker shows. */
export type EditorHeading = 'normal' | 'h1' | 'h2' | 'h3'

/**
 * What the module posts to the hooks module: the text after every change,
 * with the heading under the cursor; the heading alone when only the cursor
 * moved to a line of another level; text to put on the clipboard; or, for a
 * cut, that text with the content left behind (one post a frame, so together).
 */
export type EditorPost =
  | { type: 'content'; draftId: string; text: string; heading: EditorHeading }
  | { type: 'cursor'; draftId: string; heading: EditorHeading }
  | { type: 'copy'; draftId: string; text: string }
  | { type: 'cut'; draftId: string; text: string; content: string; heading: EditorHeading }

export const EDITOR_KEY = 'editor'

/** A fresh state over a text: the cursor at its start, nothing selected. */
export function stateFrom(draftId: string, text: string): EditorState {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return { draftId, lines, row: 0, col: 0, top: 0 }
}

/** The heading level of the cursor's line. */
export function headingAt(state: EditorState): EditorHeading {
  const level = /^(#{1,3})\s/.exec(state.lines[state.row] ?? '')?.[1]?.length
  return level === 1 ? 'h1' : level === 2 ? 'h2' : level === 3 ? 'h3' : 'normal'
}

export function textOf(state: EditorState): string {
  return state.lines.join('\n')
}

type VisualRow = { row: number; start: number; text: string }

/**
 * Logical lines cut into rows of at most `width` cells, at a space where one
 * falls in the row (the space itself is left out), else mid-word. An empty
 * line is one row.
 */
export function visualRows(lines: readonly string[], width: number): VisualRow[] {
  const w = Math.max(1, width)
  const rows: VisualRow[] = []
  lines.forEach((line, row) => {
    if (line === '') {
      rows.push({ row, start: 0, text: '' })
      return
    }
    let start = 0
    while (start < line.length) {
      let end = Math.min(line.length, start + w)
      if (end < line.length) {
        const cut = line.lastIndexOf(' ', end)
        if (cut > start) end = cut
      }
      rows.push({ row, start, text: line.slice(start, end) })
      start = end < line.length && line[end] === ' ' ? end + 1 : end
    }
  })
  return rows
}

/** The visual row a position is on: the last row of its line starting at or before the column. */
function visualIndex(rows: readonly VisualRow[], row: number, col: number): number {
  let found = 0
  for (let index = 0; index < rows.length; index += 1) {
    const one = rows[index]
    if (one === undefined || one.row !== row) continue
    if (one.start <= col) found = index
    else break
  }
  return found
}

/** The scroll with the window filled where the text allows, and the cursor inside it. */
function withTop(state: EditorState, width: number, height: number): EditorState {
  const rows = visualRows(state.lines, width)
  const cursor = visualIndex(rows, state.row, state.col)
  const h = Math.max(1, height)
  let top = Math.max(0, Math.min(state.top, rows.length - h))
  if (cursor < top) top = cursor
  if (cursor >= top + h) top = cursor - h + 1
  return top === state.top ? state : { ...state, top }
}

const SPECIAL = new Set([
  'up',
  'down',
  'left',
  'right',
  'return',
  'enter',
  'tab',
  'backspace',
  'delete',
  'pageup',
  'pagedown',
  'home',
  'end',
  'escape',
])

// ------------------------------------------------------------ selection --

function isBefore(a: Point, b: Point): boolean {
  return a.row < b.row || (a.row === b.row && a.col < b.col)
}

/** The selected span, start before end; undefined when nothing is selected. */
export function selectionOf(state: EditorState): { start: Point; end: Point } | undefined {
  const { anchor } = state
  if (anchor === undefined) return undefined
  const cursor = { row: state.row, col: state.col }
  if (anchor.row === cursor.row && anchor.col === cursor.col) return undefined
  return isBefore(anchor, cursor) ? { start: anchor, end: cursor } : { start: cursor, end: anchor }
}

export function selectedText(state: EditorState): string {
  const span = selectionOf(state)
  if (span === undefined) return ''
  const { start, end } = span
  if (start.row === end.row) return (state.lines[start.row] ?? '').slice(start.col, end.col)
  const parts = [(state.lines[start.row] ?? '').slice(start.col)]
  for (let row = start.row + 1; row < end.row; row += 1) parts.push(state.lines[row] ?? '')
  parts.push((state.lines[end.row] ?? '').slice(0, end.col))
  return parts.join('\n')
}

function clearAnchor(state: EditorState): EditorState {
  if (state.anchor === undefined) return state
  const { anchor: _dropped, ...rest } = state
  return rest
}

/** The state with the selection removed from the text, the cursor at its start. */
export function deleteSelection(state: EditorState): EditorState {
  const span = selectionOf(state)
  if (span === undefined) return clearAnchor(state)
  const { start, end } = span
  const lines = [...state.lines]
  const head = (lines[start.row] ?? '').slice(0, start.col)
  const tail = (lines[end.row] ?? '').slice(end.col)
  lines.splice(start.row, end.row - start.row + 1, head + tail)
  return clearAnchor({ ...state, lines, row: start.row, col: start.col })
}

/** Everything selected, the cursor at the end. */
export function selectAll(state: EditorState): EditorState {
  const row = state.lines.length - 1
  return { ...state, anchor: { row: 0, col: 0 }, row, col: (state.lines[row] ?? '').length }
}

// -------------------------------------------------------------- editing --

function insert(state: EditorState, text: string): EditorState {
  const base = deleteSelection(state)
  const lines = [...base.lines]
  const current = lines[base.row] ?? ''
  const head = current.slice(0, base.col)
  const tail = current.slice(base.col)
  const parts = text.replace(/\r\n?/g, '\n').split('\n')
  const first = parts[0] ?? ''
  if (parts.length === 1) {
    lines[base.row] = head + first + tail
    return { ...base, lines, col: base.col + first.length }
  }
  const last = parts[parts.length - 1] ?? ''
  lines.splice(base.row, 1, head + first, ...parts.slice(1, -1), last + tail)
  return { ...base, lines, row: base.row + parts.length - 1, col: last.length }
}

/** The state with the text's previous version remembered, so undo can return to it. */
function remember(before: EditorState, after: EditorState): EditorState {
  if (textOf(before) === textOf(after)) return after
  const snapshot: Snapshot = { text: textOf(before), row: before.row, col: before.col }
  const history = [...(before.history ?? []), snapshot].slice(-HISTORY_MAX)
  return { ...after, history, future: [] }
}

function restore(state: EditorState, snapshot: Snapshot): EditorState {
  const fresh = stateFrom(state.draftId, snapshot.text)
  const row = Math.min(snapshot.row, fresh.lines.length - 1)
  return { ...fresh, row, col: Math.min(snapshot.col, (fresh.lines[row] ?? '').length), top: state.top }
}

/** The word around the cursor (letters, digits, the usual joiners), as a span. */
function wordAt(line: string, col: number): { start: number; end: number } {
  const isWord = (ch: string) => /[\p{Letter}\p{Number}_'-]/u.test(ch)
  let start = col
  let end = col
  while (start > 0 && isWord(line[start - 1] ?? '')) start -= 1
  while (end < line.length && isWord(line[end] ?? '')) end += 1
  return { start, end }
}

/** Wraps the selection on one line, else the word at the cursor (or inserts an empty pair), with `mark`. */
function wrap(state: EditorState, mark: string): EditorState {
  const span = selectionOf(state)
  const lines = [...state.lines]
  const line = lines[state.row] ?? ''
  const { start, end } = span !== undefined && span.start.row === span.end.row ? { start: span.start.col, end: span.end.col } : wordAt(line, state.col)
  const base = clearAnchor(state)
  if (start === end) {
    lines[state.row] = `${line.slice(0, state.col)}${mark}${mark}${line.slice(state.col)}`
    return { ...base, lines, col: state.col + mark.length }
  }
  const word = line.slice(start, end)
  const before = line.slice(start - mark.length, start)
  const after = line.slice(end, end + mark.length)
  if (before === mark && after === mark) {
    lines[state.row] = `${line.slice(0, start - mark.length)}${word}${line.slice(end + mark.length)}`
    return { ...base, lines, col: Math.max(start - mark.length, Math.min(state.col - mark.length, end - mark.length)) }
  }
  lines[state.row] = `${line.slice(0, start)}${mark}${word}${mark}${line.slice(end)}`
  return { ...base, lines, col: Math.min(state.col, end) + mark.length }
}

/** Sets or clears the prefix of the cursor's line (`# `, `- `, `> `, `1. `). */
function setPrefix(state: EditorState, prefix: string): EditorState {
  const lines = [...state.lines]
  const line = lines[state.row] ?? ''
  const stripped = line.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '')
  const isSame = prefix !== '' && line.startsWith(prefix)
  const next = isSame ? stripped : prefix + stripped
  lines[state.row] = next
  const delta = next.length - line.length
  return clearAnchor({ ...state, lines, col: Math.max(0, Math.min(next.length, state.col + delta)) })
}

/**
 * The cursor moved to a click at cell (`x`, `y`) of the region: `y` counts
 * from the first row shown, and a click past a row's end lands at its end.
 * With `extend`, the selection grows from its anchor (or the cursor) to there.
 */
export function pointAt(
  state: EditorState,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { extend?: boolean } = {},
): EditorState {
  const shown = withTop(state, width, height)
  const rows = visualRows(shown.lines, width)
  const target = rows[Math.max(0, Math.min(rows.length - 1, shown.top + Math.max(0, y)))]
  if (target === undefined) return shown
  const line = shown.lines[target.row] ?? ''
  const isLastOfLine = target.start + target.text.length >= line.length
  const end = isLastOfLine ? line.length : target.start + target.text.length
  const col = Math.max(target.start, Math.min(end, target.start + Math.max(0, x)))
  const moved = { ...shown, row: target.row, col }
  if (options.extend === true) return { ...moved, anchor: shown.anchor ?? { row: shown.row, col: shown.col } }
  return clearAnchor(moved)
}

/** A toolbar command applied at the cursor; `undo` and `redo` walk the history. */
export function applyCommand(state: EditorState, kind: string): EditorState {
  if (kind === 'undo') {
    const history = state.history ?? []
    const previous = history[history.length - 1]
    if (previous === undefined) return state
    const now: Snapshot = { text: textOf(state), row: state.row, col: state.col }
    return { ...restore(state, previous), history: history.slice(0, -1), future: [now, ...(state.future ?? [])] }
  }
  if (kind === 'redo') {
    const future = state.future ?? []
    const next = future[0]
    if (next === undefined) return state
    const now: Snapshot = { text: textOf(state), row: state.row, col: state.col }
    return { ...restore(state, next), history: [...(state.history ?? []), now].slice(-HISTORY_MAX), future: future.slice(1) }
  }
  let next = state
  switch (kind) {
    case 'bold':
      next = wrap(state, '**')
      break
    case 'italic':
      next = wrap(state, '_')
      break
    case 'code':
      next = wrap(state, '`')
      break
    case 'link': {
      const lines = [...state.lines]
      const line = lines[state.row] ?? ''
      const span = selectionOf(state)
      const { start, end } =
        span !== undefined && span.start.row === span.end.row ? { start: span.start.col, end: span.end.col } : wordAt(line, state.col)
      const text = start === end ? 'link text' : line.slice(start, end)
      const inserted = `[${text}](https://)`
      lines[state.row] = `${line.slice(0, start)}${inserted}${line.slice(end)}`
      next = clearAnchor({ ...state, lines, col: start + inserted.length - 1 })
      break
    }
    case 'bullet':
      next = setPrefix(state, '- ')
      break
    case 'number':
      next = setPrefix(state, '1. ')
      break
    case 'quote':
      next = setPrefix(state, '> ')
      break
    case 'normal':
      next = setPrefix(state, '')
      break
    case 'h1':
      next = setPrefix(state, '# ')
      break
    case 'h2':
      next = setPrefix(state, '## ')
      break
    case 'h3':
      next = setPrefix(state, '### ')
      break
    default:
      return state
  }
  return remember(state, next)
}

/** The cursor moved by a key, the selection kept when `shift` is held, dropped otherwise. */
function moveTo(state: EditorState, target: Point, shift: boolean): EditorState {
  const moved = { ...state, row: target.row, col: target.col }
  if (!shift) return clearAnchor(moved)
  return { ...moved, anchor: state.anchor ?? { row: state.row, col: state.col } }
}

/**
 * One key applied to the state: printable characters and pasted text are
 * inserted (over the selection, if any), the named keys edit or move, with
 * shift extending the selection. `width` and `height` are the region's, so
 * the scroll follows the cursor. Copy and cut are the module's: they need
 * the clipboard.
 */
export function applyKey(state: EditorState, event: ClientKeyEvent, width: number, height: number): EditorState {
  const lines = state.lines
  const line = lines[state.row] ?? ''
  const key = event.key
  const shift = event.shift === true
  let next: EditorState = state

  if (event.ctrl === true || event.meta === true) {
    if (key === 'a') next = selectAll(state)
    else if (key === 'e') next = moveTo(state, { row: state.row, col: line.length }, shift)
    else if (key === 'z' && shift) return withTop(applyCommand(state, 'redo'), width, height)
    else if (key === 'z') return withTop(applyCommand(state, 'undo'), width, height)
    else if (key === 'y') return withTop(applyCommand(state, 'redo'), width, height)
    else if (key === 'b') return withTop(applyCommand(state, 'bold'), width, height)
    else if (key === 'i') return withTop(applyCommand(state, 'italic'), width, height)
    else return state
    return withTop(next, width, height)
  }
  const span = selectionOf(state)
  if (key === 'return' || key === 'enter') {
    next = insert(state, '\n')
  } else if (key === 'tab') {
    next = insert(state, '  ')
  } else if (key === 'backspace') {
    if (span !== undefined) {
      next = deleteSelection(state)
    } else if (state.col > 0) {
      const edited = [...lines]
      edited[state.row] = line.slice(0, state.col - 1) + line.slice(state.col)
      next = { ...state, lines: edited, col: state.col - 1 }
    } else if (state.row > 0) {
      const edited = [...lines]
      const previous = edited[state.row - 1] ?? ''
      edited.splice(state.row - 1, 2, previous + line)
      next = { ...state, lines: edited, row: state.row - 1, col: previous.length }
    }
  } else if (key === 'delete') {
    if (span !== undefined) {
      next = deleteSelection(state)
    } else if (state.col < line.length) {
      const edited = [...lines]
      edited[state.row] = line.slice(0, state.col) + line.slice(state.col + 1)
      next = { ...state, lines: edited }
    } else if (state.row < lines.length - 1) {
      const edited = [...lines]
      edited.splice(state.row, 2, line + (edited[state.row + 1] ?? ''))
      next = { ...state, lines: edited }
    }
  } else if (key === 'left') {
    if (span !== undefined && !shift) next = clearAnchor({ ...state, ...span.start })
    else if (state.col > 0) next = moveTo(state, { row: state.row, col: state.col - 1 }, shift)
    else if (state.row > 0) next = moveTo(state, { row: state.row - 1, col: (lines[state.row - 1] ?? '').length }, shift)
  } else if (key === 'right') {
    if (span !== undefined && !shift) next = clearAnchor({ ...state, ...span.end })
    else if (state.col < line.length) next = moveTo(state, { row: state.row, col: state.col + 1 }, shift)
    else if (state.row < lines.length - 1) next = moveTo(state, { row: state.row + 1, col: 0 }, shift)
  } else if (key === 'up' || key === 'down' || key === 'pageup' || key === 'pagedown') {
    const rows = visualRows(lines, width)
    const at = visualIndex(rows, state.row, state.col)
    const step = key === 'up' ? -1 : key === 'down' ? 1 : key === 'pageup' ? -Math.max(1, height) : Math.max(1, height)
    const target = rows[Math.max(0, Math.min(rows.length - 1, at + step))]
    const here = rows[at]
    if (target !== undefined && here !== undefined) {
      const offset = state.col - here.start
      next = moveTo(state, { row: target.row, col: Math.min(target.start + offset, (lines[target.row] ?? '').length) }, shift)
    }
  } else if (key === 'home') {
    next = moveTo(state, { row: state.row, col: 0 }, shift)
  } else if (key === 'end') {
    next = moveTo(state, { row: state.row, col: line.length }, shift)
  } else if (!SPECIAL.has(key) && key.length > 0) {
    next = insert(state, key)
  }
  return withTop(remember(state, next), width, height)
}

// -------------------------------------------------------------- drawing --

type Style = { bold?: boolean; italic?: boolean; dimColor?: boolean; color?: string; inverse?: boolean }

function sameStyle(a: Style, b: Style): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.dimColor === b.dimColor && a.color === b.color && a.inverse === b.inverse
}

/**
 * One visual row as Text runs: the line's marker in the accent colour, a
 * heading bold, a quote dim italic; the selected span and the cursor cell
 * inverted. `selected` is the span of this row's cells, `cursor` the cell.
 */
function drawRow(
  surface: ClientSurface<EditorState>,
  one: VisualRow,
  logical: string,
  selected: { from: number; to: number } | undefined,
  cursor: number | undefined,
  placeholder: string | undefined,
): RenderElement {
  const { Box, Text } = surface.elements
  const isHeading = /^#{1,6}\s/.test(logical)
  const isQuote = /^>\s?/.test(logical)
  const marker = one.start === 0 ? (/^(\s*[-*+]\s|\s*\d+[.)]\s|>\s?)/.exec(logical)?.[0] ?? '') : ''
  const chars = one.text.split('')
  if (cursor !== undefined && cursor >= chars.length) chars.push(' ')
  const styles: Style[] = chars.map((_, index) => {
    const style: Style = {}
    if (index < marker.length) style.color = 'claude'
    else if (isHeading) style.bold = true
    else if (isQuote) {
      style.italic = true
      style.dimColor = true
    }
    if (selected !== undefined && index >= selected.from && index < selected.to) style.inverse = true
    if (index === cursor) style.inverse = true
    return style
  })
  const children: RenderElement[] = []
  let runStart = 0
  for (let index = 1; index <= chars.length; index += 1) {
    const style = styles[runStart] ?? {}
    if (index === chars.length || !sameStyle(style, styles[index] ?? {})) {
      children.push(Text({ ...style, wrap: 'truncate', children: chars.slice(runStart, index).join('') }))
      runStart = index
    }
  }
  if (children.length === 0) children.push(Text({ children: ' ' }))
  if (placeholder !== undefined) children.push(Text({ dimColor: true, children: placeholder }))
  return Box({ flexDirection: 'row', children })
}

/** The rows drawn: the window of visual rows from `top`, the selection and the cursor inverted. */
export function render(state: EditorState, surface: ClientSurface<EditorState>, width: number, height: number, placeholder: string): RenderElement {
  const { Box } = surface.elements
  const shown = withTop(state, width, height)
  const rows = visualRows(shown.lines, width)
  const cursorRow = visualIndex(rows, shown.row, shown.col)
  const isEmpty = textOf(shown) === ''
  const span = selectionOf(shown)
  const children: RenderElement[] = []
  for (let index = shown.top; index < Math.min(rows.length, shown.top + height); index += 1) {
    const one = rows[index]
    if (one === undefined) continue
    const logical = shown.lines[one.row] ?? ''
    let selected: { from: number; to: number } | undefined
    if (span !== undefined && one.row >= span.start.row && one.row <= span.end.row) {
      const lo = one.row === span.start.row ? span.start.col : 0
      const hi = one.row === span.end.row ? span.end.col : logical.length + 1
      const from = Math.max(0, Math.min(one.text.length, lo - one.start))
      const to = Math.max(0, Math.min(one.text.length + 1, hi - one.start))
      if (from < to) selected = { from, to }
    }
    const cursor = index === cursorRow ? shown.col - one.start : undefined
    children.push(drawRow(surface, one, logical, selected, cursor, isEmpty && index === cursorRow ? placeholder : undefined))
  }
  return Box({ flexDirection: 'column', children })
}

/** Tells the hooks module what changed: the text (with the cursor's heading), or the heading alone. */
function postChange(surface: ClientSurface<EditorState>, previous: EditorState, next: EditorState): void {
  const heading = headingAt(next)
  if (textOf(previous) !== textOf(next)) {
    const post: EditorPost = { type: 'content', draftId: next.draftId, text: textOf(next), heading }
    surface.post(post)
  } else if (headingAt(previous) !== heading) {
    const post: EditorPost = { type: 'cursor', draftId: next.draftId, heading }
    surface.post(post)
  }
}

const Editor: ClientModule<EditorProps, EditorState> = (props, surface) => {
  // The region as laid out; before the first layout, as the hooks module sized it.
  const width = Math.max(10, surface.columns || props.columns || 60)
  const height = Math.max(3, surface.rows || props.rows || 8)
  let state = surface.state
  const command = props.command ?? null
  if (state === undefined || state.draftId !== props.draftId) {
    // A fresh text starts past the toolbar's latest command, so it is never replayed.
    state = { ...stateFrom(props.draftId, props.text), commandId: command?.id ?? 0 }
    surface.setState(state)
    const heading = headingAt(state)
    if (heading !== 'normal') {
      const post: EditorPost = { type: 'cursor', draftId: state.draftId, heading }
      surface.post(post)
    }
  }
  if (command !== null && command.id !== (state.commandId ?? 0)) {
    const applied = { ...withTop(applyCommand(state, command.kind), width, height), commandId: command.id }
    postChange(surface, state, applied)
    state = applied
    surface.setState(state)
  }
  const current = state
  const settle = (next: EditorState) => {
    if (next === current) return
    surface.setState(next)
    postChange(surface, current, next)
  }
  // A click puts the cursor where it lands; a drag (or a shift+click) selects up to there.
  surface.onPointer((event: ClientPointerEvent) => {
    if (event.type === 'down' && event.button === 'left') {
      settle(pointAt(current, event.x, event.y, width, height, { extend: event.shift === true }))
    } else if (event.type === 'move' && event.button === 'left' && current.anchor !== undefined) {
      settle(pointAt(current, event.x, event.y, width, height, { extend: true }))
    } else if (event.type === 'up' && current.anchor !== undefined && selectionOf(current) === undefined) {
      settle(clearAnchor(current))
    }
  })
  surface.onKey(event => {
    if ((event.ctrl === true || event.meta === true) && (event.key === 'c' || event.key === 'x')) {
      const text = selectedText(current)
      if (text === '') return
      if (event.key === 'c') {
        const post: EditorPost = { type: 'copy', draftId: current.draftId, text }
        surface.post(post)
        return
      }
      const cut = withTop(remember(current, deleteSelection(current)), width, height)
      const post: EditorPost = { type: 'cut', draftId: cut.draftId, text, content: textOf(cut), heading: headingAt(cut) }
      surface.post(post)
      surface.setState(cut)
      return
    }
    settle(applyKey(current, event, width, height))
  })
  return render(current, surface, width, height, props.placeholder ?? 'Click here, then type. Esc when done.')
}

export default Editor
