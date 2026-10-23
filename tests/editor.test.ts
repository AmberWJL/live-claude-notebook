import { describe, expect, test } from 'claude-code/testing'

import { applyCommand, applyKey, headingAt, pointAt, stateFrom, textOf, visualRows } from '../hooks/ui/editor'

const W = 20
const H = 5

describe('editor state', () => {
  test('starts with the cursor at the end of the text', async () => {
    const state = stateFrom('d1', 'one\ntwo')
    expect(state.lines).toEqual(['one', 'two'])
    expect(state.row).toBe(1)
    expect(state.col).toBe(3)
  })

  test('typing, enter and backspace edit at the cursor', async () => {
    let state = stateFrom('d1', 'ab')
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
    state = applyKey(state, { key: 'left' }, W, H)
    state = applyKey(state, { key: 'A\nB' }, W, H)
    expect(textOf(state)).toBe('A\nBx')
    expect(state.row).toBe(1)
    expect(state.col).toBe(1)
  })

  test('arrows move across lines; home and end jump within one', async () => {
    let state = stateFrom('d1', 'first\nsecond')
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

  test('modifier chords other than ctrl+a and ctrl+e change nothing', async () => {
    const state = stateFrom('d1', 'abc')
    expect(applyKey(state, { key: 'c', ctrl: true }, W, H)).toBe(state)
    expect(applyKey(state, { key: 'a', ctrl: true }, W, H).col).toBe(0)
  })

  test('long lines wrap into visual rows and the window follows the cursor', async () => {
    const long = 'x'.repeat(45)
    expect(visualRows([long, ''], W).map(r => r.text.length)).toEqual([20, 20, 5, 0])
    let state = stateFrom('d1', Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'))
    expect(state.top).toBe(0)
    state = applyKey(state, { key: 'z' }, W, H)
    expect(state.top).toBe(12 - H)
    for (let i = 0; i < 11; i += 1) state = applyKey(state, { key: 'up' }, W, H)
    expect(state.row).toBe(0)
    expect(state.top).toBe(0)
  })

  test('a click puts the cursor on the clicked line, so H1 heads that line', async () => {
    let state = stateFrom('d1', 'Title\nbody text\n')
    state = pointAt(state, 2, 0, W, H)
    expect([state.row, state.col]).toEqual([0, 2])
    state = applyCommand(state, 'h1')
    expect(textOf(state)).toBe('# Title\nbody text\n')
    state = pointAt(state, 50, 1, W, H)
    expect([state.row, state.col]).toEqual([1, 9])
    state = applyCommand(state, 'code')
    expect(textOf(state)).toBe('# Title\nbody `text`\n')
  })

  test('a click counts rows from the first one shown and stays inside a wrapped row', async () => {
    const long = 'x'.repeat(45)
    let state = stateFrom('d1', Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'))
    state = pointAt(state, 0, 0, W, H)
    expect(state.row).toBe(12 - H)
    state = pointAt(stateFrom('d2', long), 30, 0, W, H)
    expect([state.row, state.col]).toEqual([0, 19])
  })

  test('headingAt reads the level of the cursor line', async () => {
    let state = stateFrom('d1', '# Title\n## Sub\n### Small\nbody')
    expect(headingAt(state)).toBe('normal')
    state = pointAt(state, 0, 0, W, H)
    expect(headingAt(state)).toBe('h1')
    state = pointAt(state, 0, 1, W, H)
    expect(headingAt(state)).toBe('h2')
    state = pointAt(state, 0, 2, W, H)
    expect(headingAt(state)).toBe('h3')
    expect(headingAt(applyCommand(state, 'normal'))).toBe('normal')
  })
})
