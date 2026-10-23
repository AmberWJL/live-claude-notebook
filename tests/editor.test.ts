import { describe, expect, test } from 'claude-code/testing'

import { applyCommand, applyKey, headingAt, pointAt, selectedText, stateFrom, textOf, visualRows } from '../hooks/ui/editor'

const W = 20
const H = 5

describe('editor state', () => {
  test('starts with the cursor at the top of the text', async () => {
    const state = stateFrom('d1', 'one\ntwo')
    expect(state.lines).toEqual(['one', 'two'])
    expect(state.row).toBe(0)
    expect(state.col).toBe(0)
    expect(state.top).toBe(0)
  })

  test('typing, enter and backspace edit at the cursor', async () => {
    let state = stateFrom('d1', 'ab')
    state = applyKey(state, { key: 'end' }, W, H)
    state = applyKey(state, { key: 'c' }, W, H)
    state = applyKey(state, { key: 'return' }, W, H)
    state = applyKey(state, { key: 'd' }, W, H)
    expect(textOf(state)).toBe('abc\nd')
    state = applyKey(state, { key: 'backspace' }, W, H)
    state = applyKey(state, { key: 'backspace' }, W, H)
    expect(textOf(state)).toBe('abc')
    expect(state.col).toBe(3)
  })

  test('pasted text with newlines is inserted as lines', async () => {
    let state = stateFrom('d1', 'x')
    state = applyKey(state, { key: 'A\nB' }, W, H)
    expect(textOf(state)).toBe('A\nBx')
    expect(state.row).toBe(1)
    expect(state.col).toBe(1)
  })

  test('arrows move across lines; home and end jump within one', async () => {
    let state = stateFrom('d1', 'first\nsecond')
    state = applyKey(state, { key: 'down' }, W, H)
    state = applyKey(state, { key: 'end' }, W, H)
    expect(state.row).toBe(1)
    expect(state.col).toBe(6)
    state = applyKey(state, { key: 'up' }, W, H)
    expect(state.row).toBe(0)
    expect(state.col).toBe(5)
    state = applyKey(state, { key: 'home' }, W, H)
    expect(state.col).toBe(0)
    state = applyKey(state, { key: 'right' }, W, H)
    state = applyKey(state, { key: 'end' }, W, H)
    expect(state.col).toBe(5)
    state = applyKey(state, { key: 'right' }, W, H)
    expect(state.row).toBe(1)
    expect(state.col).toBe(0)
  })

  test('ctrl+a selects everything, ctrl+e goes to the line end; other chords change nothing', async () => {
    const state = stateFrom('d1', 'abc\nde')
    expect(applyKey(state, { key: 'q', ctrl: true }, W, H)).toBe(state)
    expect(applyKey(state, { key: 'e', ctrl: true }, W, H).col).toBe(3)
    const all = applyKey(state, { key: 'a', meta: true }, W, H)
    expect(selectedText(all)).toBe('abc\nde')
    expect([all.row, all.col]).toEqual([1, 2])
  })

  test('long lines wrap at spaces, mid-word only when a word is wider than the row', async () => {
    const prose = 'The quick brown fox jumps over the lazy dog'
    expect(visualRows([prose], W).map(r => r.text)).toEqual(['The quick brown fox', 'jumps over the lazy', 'dog'])
    const long = 'x'.repeat(45)
    expect(visualRows([long, ''], W).map(r => r.text.length)).toEqual([20, 20, 5, 0])
    expect(visualRows(['ab cd', 'ef'], 5).map(r => r.text)).toEqual(['ab cd', 'ef'])
    expect(visualRows(['abcde fgh'], 5).map(r => r.text)).toEqual(['abcde', 'fgh'])
  })

  test('the window follows the cursor and fills with text when the cursor comes back up', async () => {
    let state = stateFrom('d1', Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'))
    expect(state.top).toBe(0)
    for (let i = 0; i < 11; i += 1) state = applyKey(state, { key: 'down' }, W, H)
    expect(state.row).toBe(11)
    expect(state.top).toBe(12 - H)
    // A taller window: the scroll comes back so the rows fill it, the cursor still shown.
    state = applyKey(state, { key: 'left' }, W, 10)
    expect(state.top).toBe(2)
    for (let i = 0; i < 11; i += 1) state = applyKey(state, { key: 'up' }, W, H)
    expect(state.row).toBe(0)
    expect(state.top).toBe(0)
  })

  test('a drag selects; typing replaces the selection; copy reads it; undo brings the cursor back', async () => {
    let state = stateFrom('d1', 'hello world\nsecond line')
    state = pointAt(state, 6, 0, W, H)
    state = pointAt(state, 3, 1, W, H, { extend: true })
    expect(selectedText(state)).toBe('world\nsec')
    state = applyKey(state, { key: 'left', shift: true }, W, H)
    expect(selectedText(state)).toBe('world\nse')
    state = applyKey(state, { key: 'X' }, W, H)
    expect(textOf(state)).toBe('hello Xcond line')
    expect([state.row, state.col]).toEqual([0, 7])
    expect(selectedText(state)).toBe('')
    state = applyCommand(state, 'undo')
    expect(textOf(state)).toBe('hello world\nsecond line')
    expect([state.row, state.col]).toEqual([1, 2])
    // Bold wraps a selection on one line.
    state = pointAt(state, 0, 0, W, H)
    state = applyKey(state, { key: 'right', shift: true }, W, H)
    for (let i = 0; i < 4; i += 1) state = applyKey(state, { key: 'right', shift: true }, W, H)
    expect(selectedText(state)).toBe('hello')
    state = applyCommand(state, 'bold')
    expect(textOf(state)).toBe('**hello** world\nsecond line')
    // Backspace over a selection removes just the selection.
    state = pointAt(state, 0, 1, W, H)
    state = applyKey(state, { key: 'end', shift: true }, W, H)
    state = applyKey(state, { key: 'backspace' }, W, H)
    expect(textOf(state)).toBe('**hello** world\n')
  })

  test('a click puts the cursor on the clicked line, so H1 heads that line', async () => {
    let state = stateFrom('d1', 'Title\nbody text\n')
    state = pointAt(state, 2, 0, W, H)
    expect([state.row, state.col]).toEqual([0, 2])
    state = applyCommand(state, 'h1')
    expect(textOf(state)).toBe('# Title\nbody text\n')
    state = pointAt(state, 50, 1, W, H)
    expect([state.row, state.col]).toEqual([1, 9])
    state = applyKey(state, { key: 'left' }, W, H)
    state = applyCommand(state, 'code')
    expect(textOf(state)).toBe('# Title\nbody `text`\n')
  })

  test('a click counts rows from the first one shown and stays inside a wrapped row', async () => {
    const long = 'x'.repeat(45)
    let state = stateFrom('d1', Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'))
    for (let i = 0; i < 11; i += 1) state = applyKey(state, { key: 'down' }, W, H)
    state = pointAt(state, 0, 0, W, H)
    expect(state.row).toBe(12 - H)
    state = pointAt(stateFrom('d2', long), 30, 0, W, H)
    expect([state.row, state.col]).toEqual([0, 20])
  })

  test('headingAt reads the level of the cursor line', async () => {
    let state = stateFrom('d1', '# Title\n## Sub\n### Small\nbody')
    expect(headingAt(state)).toBe('h1')
    state = pointAt(state, 0, 1, W, H)
    expect(headingAt(state)).toBe('h2')
    state = pointAt(state, 0, 2, W, H)
    expect(headingAt(state)).toBe('h3')
    expect(headingAt(applyCommand(state, 'normal'))).toBe('normal')
    state = pointAt(state, 0, 3, W, H)
    expect(headingAt(state)).toBe('normal')
  })
})
