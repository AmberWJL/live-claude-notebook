import { describe, expect, test } from 'claude-code/testing'

import type { NotebookEntry } from '../src/types'
import { matchExcerpt, searchEntries } from '../src/services/search-service'

function entry(partial: Partial<NotebookEntry> & { id: string }): NotebookEntry {
  return {
    schemaVersion: 1,
    title: partial.id,
    content: '',
    folder: 'General',
    type: 'other',
    tags: [],
    sources: [],
    status: 'confirmed',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const entries = [
  entry({ id: 'a', title: 'Cache Invalidation', content: 'The TTL was wrong.', updatedAt: 3 }),
  entry({ id: 'b', title: 'Deploy', content: 'Blue/green deploy notes', folder: 'Ops', tags: ['ops', 'release'], updatedAt: 2 }),
  entry({ id: 'c', title: 'Old idea', content: 'Archived content about cache', status: 'archived', updatedAt: 5 }),
]

describe('searchEntries', () => {
  test('matches title, content and tags, case-insensitively', async () => {
    expect(searchEntries(entries, 'CACHE').map(e => e.id)).toEqual(['a'])
    expect(searchEntries(entries, 'ttl').map(e => e.id)).toEqual(['a'])
    expect(searchEntries(entries, 'Release').map(e => e.id)).toEqual(['b'])
  })

  test('excludes archived entries by default and includes them on request', async () => {
    expect(searchEntries(entries, 'cache').map(e => e.id)).toEqual(['a'])
    expect(searchEntries(entries, 'cache', { includeArchived: true }).map(e => e.id)).toEqual(['c', 'a'])
  })

  test('an empty query lists active entries, most recently updated first', async () => {
    expect(searchEntries(entries, '').map(e => e.id)).toEqual(['a', 'b'])
    expect(searchEntries(entries, '   ').map(e => e.id)).toEqual(['a', 'b'])
  })

  test('no match is an empty list', async () => {
    expect(searchEntries(entries, 'zzz')).toEqual([])
  })

  test('a folder narrows the list; an empty folder means every folder', async () => {
    expect(searchEntries(entries, '', { folder: 'Ops' }).map(e => e.id)).toEqual(['b'])
    expect(searchEntries(entries, 'deploy', { folder: 'General' })).toEqual([])
    expect(searchEntries(entries, '', { folder: '' }).map(e => e.id)).toEqual(['a', 'b'])
  })
})

describe('matchExcerpt', () => {
  test('windows around the first match', async () => {
    const long = entry({ id: 'x', content: `${'a '.repeat(50)}NEEDLE${' b'.repeat(50)}` })
    const excerpt = matchExcerpt(long, 'needle', 30)
    expect(excerpt.includes('NEEDLE')).toBe(true)
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
  })
})
