import { describe, expect, test } from 'claude-code/testing'

import type { NotebookEntry } from '../types'
import {
  heuristicTags,
  isCurrent,
  normalizeTag,
  notebookStats,
  parseTags,
  projectsOf,
  tagsBasis,
  tagsPrompt,
} from '../src/services/notebook-tags'

function entry(partial: Partial<NotebookEntry> & { id: string }): NotebookEntry {
  return {
    schemaVersion: 1,
    title: partial.id,
    content: 'body',
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

const source = (sessionId: string, cwd?: string) => ({
  captureMode: 'excerpt' as const,
  snapshot: '',
  capturedAt: 1,
  sessionId,
  ...(cwd === undefined ? {} : { context: { before: [], after: [], cwd } }),
})

const entries = [
  entry({ id: 'a', title: 'First', updatedAt: 5, sources: [source('s1', '/Users/me/live-claude-notebook')] }),
  entry({ id: 'b', title: 'Second', updatedAt: 9, sources: [source('s2', '/Users/me/live-claude-notebook/')] }),
  entry({ id: 'c', title: 'Third', updatedAt: 7, sources: [source('s2', '/srv/Other Project')] }),
  entry({ id: 'd', title: 'Archived', updatedAt: 50, status: 'archived', sources: [source('s3', '/x/archived-proj')] }),
  entry({ id: 'e', title: 'Elsewhere', folder: 'Ops', updatedAt: 3 }),
]

describe('notebook tags', () => {
  test('stats count active entries and distinct sessions', async () => {
    const stats = notebookStats(entries, 'General')
    expect(stats).toEqual({ folder: 'General', count: 3, sessions: 2, updatedAt: 9, latestTitle: 'Second' })
    expect(tagsBasis(stats)).toBe('3:9')
    expect(notebookStats(entries, 'Empty')).toEqual({ folder: 'Empty', count: 0, sessions: 0, updatedAt: 0 })
  })

  test('projects come from the notes’ directories, most frequent first', async () => {
    expect(projectsOf(entries, 'General')).toEqual(['live-claude-notebook', 'Other Project'])
    expect(projectsOf(entries, 'Ops')).toEqual([])
  })

  test('fallback tags are the projects, normalized, at most two', async () => {
    expect(heuristicTags(entries, 'General')).toEqual(['live-claude-notebook', 'other-project'])
    expect(heuristicTags(entries, 'Ops')).toEqual([])
  })

  test('tags are current only for the same basis', async () => {
    const stats = notebookStats(entries, 'General')
    expect(isCurrent({ tags: [], basis: '3:9', generatedAt: 1, by: 'model' }, stats)).toBe(true)
    expect(isCurrent({ tags: [], basis: '3:8', generatedAt: 1, by: 'model' }, stats)).toBe(false)
    expect(isCurrent(undefined, stats)).toBe(false)
  })

  test('the prompt names the notebook, its projects, and lists active notes newest first', async () => {
    const prompt = tagsPrompt('General', entries)
    expect(prompt).toContain('named "General"')
    expect(prompt).toContain('live-claude-notebook, Other Project')
    expect(prompt.indexOf('- Second:') < prompt.indexOf('- First:')).toBe(true)
    expect(prompt).not.toContain('Archived')
    expect(prompt).not.toContain('Elsewhere')
  })

  test('parseTags normalizes, dedupes and keeps at most three', async () => {
    expect(parseTags('Live Claude Notebook, #Caching , caching\nTTL rules, extra')).toEqual([
      'live-claude-notebook',
      'caching',
      'ttl-rules',
    ])
    expect(parseTags('  \n ')).toEqual([])
    expect(normalizeTag('x'.repeat(40))?.length).toBe(24)
  })
})
