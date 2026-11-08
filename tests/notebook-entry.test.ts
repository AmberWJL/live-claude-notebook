import { describe, expect, test } from 'claude-code/testing'

import { ENTRY_TYPES, validateEntry } from '../src/domain/notebook-entry'

const stored = {
  schemaVersion: 1,
  id: 'e-1',
  title: 'Blue/green deploy',
  content: 'Switch traffic only after health checks pass.',
  folder: 'Ops',
  type: 'learning',
  tags: [],
  sources: [],
  status: 'confirmed',
  createdAt: 1,
  updatedAt: 1,
}

describe('validateEntry', () => {
  test('the types are insight, learning, reference and other', async () => {
    expect(ENTRY_TYPES).toEqual(['insight', 'learning', 'reference', 'other'])
    const checked = validateEntry(stored)
    expect(checked.ok && checked.value.type).toBe('learning')
  })

  test('an entry saved with a type notes no longer have reads as other; an unknown type still rejects', async () => {
    for (const type of ['decision', 'idea']) {
      const checked = validateEntry({ ...stored, type })
      expect(checked.ok && checked.value.type).toBe('other')
    }
    expect(validateEntry({ ...stored, type: 'question' })).toEqual({ ok: false, reason: 'type is not an entry type' })
  })
})
