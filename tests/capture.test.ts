import { describe, expect, test } from 'claude-code/testing'

import type { AppendedRow } from '../types'
import {
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

describe('where a capture came from', () => {
  const messages = [
    { role: 'user' as const, text: 'q1' },
    { role: 'assistant' as const, text: '' },
    { role: 'assistant' as const, text: 'a1' },
    { role: 'user' as const, text: 'q2' },
    { role: 'assistant' as const, text: 'a2 with more words' },
    { role: 'user' as const, text: 'q3' },
  ]

  test('findMessageIndex prefers an exact match, then containment, newest first', async () => {
    expect(findMessageIndex(messages, 'a2 with more words')).toBe(4)
    expect(findMessageIndex(messages, 'more words')).toBe(4)
    expect(findMessageIndex(messages, 'q')).toBe(5)
    expect(findMessageIndex(messages, 'absent')).toBe(-1)
    expect(findMessageIndex(messages, '   ')).toBe(-1)
  })

  test('a draft carries the project it was given', async () => {
    const result = draftFromExcerpt('part', {}, { ...meta, context: { before: [], after: [], project: 'p' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.draft.source.context).toEqual({ before: [], after: [], project: 'p' })
  })
})
