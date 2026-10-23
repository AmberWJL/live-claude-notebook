/**
 * A multi-line text editor drawn by a `Client`: the Mod API's Input is one
 * line, so this surface module keeps the lines, the cursor and the scroll
 * itself and posts the text to the hooks module after every change.
 *
 * Runs on the drawing thread with no `$`: pure functions over a small state,
 * exported so the tests can drive them without a surface.
 */
import type { ClientKeyEvent, ClientModule, ClientSurface, RenderElement } from 'claude-code'

export type EditorProps = {
  /** Changes when a different text should replace what is being edited. */
  draftId: string
  text: string
  placeholder?: string
  /** The toolbar's latest command; a new `id` is applied once. */
  command?: { id: number; kind: string } | null
}

export type EditorState = {
  draftId: string
  lines: string[]
  row: number
  col: number
  /** The first visual row shown. */
  top: number
  /** Earlier texts, newest last, for undo; and the ones undone, for redo. */
  history?: string[]
  future?: string[]
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

/** What the module posts to the hooks module after a change. */
export type EditorPost = { type: 'content'; draftId: string; text: string }

export const EDITOR_KEY = 'editor'

export function stateFrom(draftId: string, text: string): EditorState {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const row = lines.length - 1
  return { draftId, lines, row, col: lines[row]?.length ?? 0, top: 0 }
}

export function textOf(state: EditorState): string {
  return state.lines.join('\n')
}

type VisualRow = { row: number; start: number; text: string }

/** Logical lines cut into rows of at most `width` cells; an empty line is one row. */
export function visualRows(lines: readonly string[], width: number): VisualRow[] {
  const w = Math.max(1, width)
  const rows: VisualRow[] = []
  lines.forEach((line, row) => {
    if (line === '') {
      rows.push({ row, start: 0, text: '' })
      return
    }
    for (let start = 0; start < line.length; start += w) {
      rows.push({ row, start, text: line.slice(start, start + w) })
    }
  })
  return rows
}

function visualIndex(rows: readonly VisualRow[], row: number, col: number): number {
  let last = 0
  for (let index = 0; index < rows.length; index += 1) {
    const one = rows[index]
    if (one === undefined || one.row !== row) continue
    last = index
    if (col >= one.start && col < one.start + Math.max(1, one.text.length)) return index
  }
  return last
}

function withTop(state: EditorState, width: number, height: number): EditorState {
  const rows = visualRows(state.lines, width)
  const cursor = visualIndex(rows, state.row, state.col)
  const h = Math.max(1, height)
  let top = state.top
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

function insert(state: EditorState, text: string): EditorState {
  const lines = [...state.lines]
  const current = lines[state.row] ?? ''
  const head = current.slice(0, state.col)
  const tail = current.slice(state.col)
  const parts = text.replace(/\r\n?/g, '\n').split('\n')
  const first = parts[0] ?? ''
  if (parts.length === 1) {
    lines[state.row] = head + first + tail
    return { ...state, lines, col: state.col + first.length }
  }
  const last = parts[parts.length - 1] ?? ''
  lines.splice(state.row, 1, head + first, ...parts.slice(1, -1), last + tail)
  return { ...state, lines, row: state.row + parts.length - 1, col: last.length }
}

/** The state with the text's previous version remembered, so undo can return to it. */
function remember(before: EditorState, after: EditorState): EditorState {
  if (textOf(before) === textOf(after)) return after
  const history = [...(before.history ?? []), textOf(before)].slice(-HISTORY_MAX)
  return { ...after, history, future: [] }
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

/** Wraps the word at the cursor (or inserts an empty pair) with `mark`. */
function wrap(state: EditorState, mark: string): EditorState {
  const lines = [...state.lines]
  const line = lines[state.row] ?? ''
  const { start, end } = wordAt(line, state.col)
  if (start === end) {
    lines[state.row] = `${line.slice(0, state.col)}${mark}${mark}${line.slice(state.col)}`
    return { ...state, lines, col: state.col + mark.length }
  }
  const word = line.slice(start, end)
  const before = line.slice(start - mark.length, start)
  const after = line.slice(end, end + mark.length)
  if (before === mark && after === mark) {
    lines[state.row] = `${line.slice(0, start - mark.length)}${word}${line.slice(end + mark.length)}`
    return { ...state, lines, col: Math.max(start - mark.length, Math.min(state.col - mark.length, end - mark.length)) }
  }
  lines[state.row] = `${line.slice(0, start)}${mark}${word}${mark}${line.slice(end)}`
  return { ...state, lines, col: state.col + mark.length }
}

/** Sets or clears the prefix of the cursor's line (`# `, `- `, `> `, `1. `). */
function setPrefix(state: EditorState, prefix: string): EditorState {
  const lines = [...state.lines]
  const line = lines[state.row] ?? ''
  const stripped = line.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '')
  const removed = line.length - stripped.length
  const isSame = prefix !== '' && line.startsWith(prefix)
  const next = isSame ? stripped : prefix + stripped
  lines[state.row] = next
  const delta = next.length - line.length
  return { ...state, lines, col: Math.max(0, Math.min(next.length, state.col + delta + (delta < 0 ? 0 : 0) - 0)) }
}

/** A toolbar command applied at the cursor; `undo` and `redo` walk the history. */
export function applyCommand(state: EditorState, kind: string): EditorState {
  if (kind === 'undo') {
    const history = state.history ?? []
    const previous = history[history.length - 1]
    if (previous === undefined) return state
    const restored = stateFrom(state.draftId, previous)
    return { ...restored, history: history.slice(0, -1), future: [textOf(state), ...(state.future ?? [])] }
  }
  if (kind === 'redo') {
    const future = state.future ?? []
    const next = future[0]
    if (next === undefined) return state
    const restored = stateFrom(state.draftId, next)
    return { ...restored, history: [...(state.history ?? []), textOf(state)].slice(-HISTORY_MAX), future: future.slice(1) }
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
      const { start, end } = wordAt(line, state.col)
      const text = start === end ? 'link text' : line.slice(start, end)
      const inserted = `[${text}](https://)`
      lines[state.row] = `${line.slice(0, start)}${inserted}${line.slice(end)}`
      next = { ...state, lines, col: start + inserted.length - 1 }
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

/**
 * One key applied to the state: printable characters and pasted text are
 * inserted, the named keys edit or move. `width` and `height` are the
 * region's, so the scroll follows the cursor.
 */
export function applyKey(state: EditorState, event: ClientKeyEvent, width: number, height: number): EditorState {
  const lines = state.lines
  const line = lines[state.row] ?? ''
  const key = event.key
  let next: EditorState = state

  if (event.ctrl === true || event.meta === true) {
    if (key === 'a') next = { ...state, col: 0 }
    else if (key === 'e') next = { ...state, col: line.length }
    else if (key === 'z' && event.shift === true) return withTop(applyCommand(state, 'redo'), width, height)
    else if (key === 'z') return withTop(applyCommand(state, 'undo'), width, height)
    else if (key === 'y') return withTop(applyCommand(state, 'redo'), width, height)
    else if (key === 'b') return withTop(applyCommand(state, 'bold'), width, height)
    else if (key === 'i') return withTop(applyCommand(state, 'italic'), width, height)
    else return state
  } else if (key === 'return' || key === 'enter') {
    next = insert(state, '\n')
  } else if (key === 'tab') {
    next = insert(state, '  ')
  } else if (key === 'backspace') {
    if (state.col > 0) {
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
    if (state.col < line.length) {
      const edited = [...lines]
      edited[state.row] = line.slice(0, state.col) + line.slice(state.col + 1)
      next = { ...state, lines: edited }
    } else if (state.row < lines.length - 1) {
      const edited = [...lines]
      edited.splice(state.row, 2, line + (edited[state.row + 1] ?? ''))
      next = { ...state, lines: edited }
    }
  } else if (key === 'left') {
    if (state.col > 0) next = { ...state, col: state.col - 1 }
    else if (state.row > 0) next = { ...state, row: state.row - 1, col: (lines[state.row - 1] ?? '').length }
  } else if (key === 'right') {
    if (state.col < line.length) next = { ...state, col: state.col + 1 }
    else if (state.row < lines.length - 1) next = { ...state, row: state.row + 1, col: 0 }
  } else if (key === 'up' || key === 'down' || key === 'pageup' || key === 'pagedown') {
    const rows = visualRows(lines, width)
    const at = visualIndex(rows, state.row, state.col)
    const step = key === 'up' ? -1 : key === 'down' ? 1 : key === 'pageup' ? -Math.max(1, height) : Math.max(1, height)
    const target = rows[Math.max(0, Math.min(rows.length - 1, at + step))]
    const here = rows[at]
    if (target !== undefined && here !== undefined) {
      const offset = state.col - here.start
      next = { ...state, row: target.row, col: Math.min(target.start + offset, (lines[target.row] ?? '').length) }
    }
  } else if (key === 'home') {
    next = { ...state, col: 0 }
  } else if (key === 'end') {
    next = { ...state, col: line.length }
  } else if (!SPECIAL.has(key) && key.length > 0) {
    next = insert(state, key)
  }
  return withTop(remember(state, next), width, height)
}

/** The rows drawn: the window of visual rows from `top`, the cursor inverted. */
export function render(state: EditorState, surface: ClientSurface<EditorState>, placeholder: string): RenderElement {
  const { Box, Text } = surface.elements
  const width = Math.max(10, surface.columns || 60)
  const height = Math.max(3, surface.rows || 8)
  const shown = withTop(state, width, height)
  const rows = visualRows(shown.lines, width)
  const cursor = visualIndex(rows, shown.row, shown.col)
  const isEmpty = textOf(shown) === ''
  const children: RenderElement[] = []
  for (let index = shown.top; index < Math.min(rows.length, shown.top + height); index += 1) {
    const one = rows[index]
    if (one === undefined) continue
    const logical = shown.lines[one.row] ?? ''
    const isHeading = /^#{1,6}\s/.test(logical)
    const isQuote = /^>\s?/.test(logical)
    const marker = one.start === 0 ? (/^(\s*[-*+]\s|\s*\d+[.)]\s|>\s?)/.exec(logical)?.[0] ?? '') : ''
    if (index !== cursor) {
      const body = one.text.slice(marker.length)
      children.push(
        marker === ''
          ? Text({ wrap: 'truncate', bold: isHeading, children: one.text === '' ? ' ' : one.text })
          : Box({
              flexDirection: 'row',
              children: [Text({ color: 'claude', children: marker }), Text({ wrap: 'truncate', italic: isQuote, dimColor: isQuote, children: body })],
            }),
      )
      continue
    }
    const at = shown.col - one.start
    const before = one.text.slice(0, at)
    const under = one.text.slice(at, at + 1) || ' '
    const after = one.text.slice(at + 1)
    children.push(
      Box({
        flexDirection: 'row',
        children: [
          Text({ bold: isHeading, children: before }),
          Text({ inverse: true, children: under }),
          isEmpty ? Text({ dimColor: true, children: placeholder }) : Text({ bold: isHeading, children: after }),
        ],
      }),
    )
  }
  return Box({ flexDirection: 'column', children })
}

const Editor: ClientModule<EditorProps, EditorState> = (props, surface) => {
  let state = surface.state
  if (state === undefined || state.draftId !== props.draftId) {
    state = stateFrom(props.draftId, props.text)
    surface.setState(state)
  }
  const command = props.command ?? null
  if (command !== null && command.id !== (state.commandId ?? 0)) {
    const width = Math.max(10, surface.columns || 60)
    const height = Math.max(3, surface.rows || 8)
    const applied = { ...withTop(applyCommand(state, command.kind), width, height), commandId: command.id }
    if (textOf(applied) !== textOf(state)) {
      const post: EditorPost = { type: 'content', draftId: applied.draftId, text: textOf(applied) }
      surface.post(post)
    }
    state = applied
    surface.setState(state)
  }
  const current = state
  surface.onKey(event => {
    const width = Math.max(10, surface.columns || 60)
    const height = Math.max(3, surface.rows || 8)
    const next = applyKey(current, event, width, height)
    if (next === current) return
    surface.setState(next)
    if (textOf(next) !== textOf(current)) {
      const post: EditorPost = { type: 'content', draftId: next.draftId, text: textOf(next) }
      surface.post(post)
    }
  })
  return render(current, surface, props.placeholder ?? 'Click here, then type. Esc when done.')
}

export default Editor
