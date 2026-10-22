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
}

export type EditorState = {
  draftId: string
  lines: string[]
  row: number
  col: number
  /** The first visual row shown. */
  top: number
}

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
  return withTop(next, width, height)
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
    if (index !== cursor) {
      children.push(Text({ wrap: 'truncate', children: one.text === '' ? ' ' : one.text }))
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
          Text({ children: before }),
          Text({ inverse: true, children: under }),
          isEmpty ? Text({ dimColor: true, children: placeholder }) : Text({ children: after }),
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
