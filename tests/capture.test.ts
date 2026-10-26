import { describe, expect, test } from 'claude-code/testing'

import type { AppendedRow } from '../types'
import {
  contextAround,
  draftFromCandidate,
  draftFromExcerpt,
  findMessageIndex,
  fingerprint,
  matchRow,
} from '../hooks/capture'

const meta = { draftId: 'd-1', capturedAt: 123, sessionId: 'session-1', folder: 'General' }

describe('matchRow', () => {
  test('matches only one unambiguous row of the same role', async () => {
    const rows: AppendedRow[] = [
      { uuid: 'x', role: 'assistant', ...fingerprint('same') },
      { uuid: 'y', role: 'assistant', ...fingerprint('same') },
      { uuid: 'z', role: 'user', ...fingerprint('same') },
    ]
    expect(matchRow(rows, 'assistant', 'same')).toBeUndefined()
    expect(matchRow(rows, 'user', 'same')).toBe('z')
    expect(matchRow(rows, 'user', 'other')).toBeUndefined()
  })
})

describe('drafts', () => {
  test('a whole-message draft keeps the raw snapshot and the message id', async () => {
    const result = draftFromCandidate({ index: 2, role: 'assistant', text: 'Body text\n\n', messageId: 'm-9' }, meta)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.content).toBe('Body text')
    expect(result.draft.id).toBe('d-1')
    expect(result.draft.folder).toBe('General')
    expect(result.draft.source).toEqual({
      captureMode: 'whole_message',
      role: 'assistant',
      messageId: 'm-9',
      sessionId: 'session-1',
      snapshot: 'Body text\n\n',
      capturedAt: 123,
    })
  })

  test('an excerpt draft is marked as such and may have no message id', async () => {
    const result = draftFromExcerpt('just this part', {}, meta)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.source.captureMode).toBe('excerpt')
    expect(result.draft.source.messageId).toBeUndefined()
  })

  test('empty text is refused with a message', async () => {
    const result = draftFromExcerpt('   ', {}, meta)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('empty')
  })
})

describe('context around a capture', () => {
  const messages = [
    { role: 'user' as const, text: 'q1' },
    { role: 'assistant' as const, text: '' },
    { role: 'assistant' as const, text: 'a1' },
    { role: 'user' as const, text: 'q2' },
    { role: 'assistant' as const, text: 'a2 with more words' },
    { role: 'user' as const, text: 'q3' },
  ]

  test('contextAround skips empty messages and bounds the window', async () => {
    expect(contextAround(messages, 4)).toEqual({
      before: [
        { role: 'assistant', text: 'a1' },
        { role: 'user', text: 'q2' },
      ],
      after: [{ role: 'user', text: 'q3' }],
    })
    expect(contextAround(messages, 2, { before: 5, after: 0 })).toEqual({
      before: [{ role: 'user', text: 'q1' }],
      after: [],
    })
    expect(contextAround(messages, -1)).toEqual({ before: [], after: [] })
  })

  test('contextAround clips long neighbours', async () => {
    const long = [{ role: 'user' as const, text: 'y'.repeat(5000) }, { role: 'assistant' as const, text: 'x' }]
    const { before } = contextAround(long, 1)
    expect(before[0]?.text.length).toBe(1500)
    expect(before[0]?.text.endsWith('…')).toBe(true)
  })

  test('findMessageIndex prefers an exact match, then containment, newest first', async () => {
    expect(findMessageIndex(messages, 'a2 with more words')).toBe(4)
    expect(findMessageIndex(messages, 'more words')).toBe(4)
    expect(findMessageIndex(messages, 'q')).toBe(5)
    expect(findMessageIndex(messages, 'absent')).toBe(-1)
    expect(findMessageIndex(messages, '   ')).toBe(-1)
  })

  test('a draft carries the context it was given', async () => {
    const result = draftFromExcerpt('part', {}, { ...meta, context: { before: [{ role: 'user', text: 'q' }], after: [], cwd: '/p' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.draft.source.context).toEqual({ before: [{ role: 'user', text: 'q' }], after: [], cwd: '/p' })
  })
})
