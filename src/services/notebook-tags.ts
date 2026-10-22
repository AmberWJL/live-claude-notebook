/**
 * Up to three tags per notebook: the facts they are built from, the fallback
 * drawn from the notes' project directories, and the prompt a model answers
 * with better ones. Pure; the hooks module makes the model call.
 */
import type { NotebookEntry, NotebookTags } from '../../types'
import { byRecency } from './search-service'

export type NotebookStats = {
  folder: string
  count: number
  sessions: number
  updatedAt: number
  latestTitle?: string
}

export const MAX_TAGS = 3
export const MAX_TAG_CHARS = 24
const PROMPT_ENTRIES = 20
const PROMPT_CHARS = 300

export function activeIn(entries: readonly NotebookEntry[], folder: string): NotebookEntry[] {
  return entries.filter(entry => entry.folder === folder && entry.status !== 'archived').sort(byRecency)
}

export function notebookStats(entries: readonly NotebookEntry[], folder: string): NotebookStats {
  const active = activeIn(entries, folder)
  const sessions = new Set<string>()
  for (const entry of active) {
    for (const source of entry.sources) if (source.sessionId !== undefined) sessions.add(source.sessionId)
  }
  const stats: NotebookStats = {
    folder,
    count: active.length,
    sessions: sessions.size,
    updatedAt: active.reduce((max, entry) => Math.max(max, entry.updatedAt), 0),
  }
  const latest = active[0]
  if (latest !== undefined) stats.latestTitle = latest.title
  return stats
}

/** What the tags were made from; a different basis means they are stale. */
export function tagsBasis(stats: NotebookStats): string {
  return `${stats.count}:${stats.updatedAt}`
}

export function isCurrent(tags: NotebookTags | undefined, stats: NotebookStats): boolean {
  return tags !== undefined && tags.basis === tagsBasis(stats)
}

/** The project directory names the notes were captured in, most frequent first. */
export function projectsOf(entries: readonly NotebookEntry[], folder: string): string[] {
  const counts = new Map<string, number>()
  for (const entry of activeIn(entries, folder)) {
    for (const source of entry.sources) {
      const cwd = source.context?.cwd
      if (cwd === undefined) continue
      const name = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
      if (name !== '') counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
}

/** One tag as stored: lowercase, words joined by hyphens, bounded. */
export function normalizeTag(raw: string): string | undefined {
  const tag = raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_CHARS)
    .replace(/-+$/g, '')
  return tag === '' ? undefined : tag
}

/** Tags with no model: the project the notes came from. */
export function heuristicTags(entries: readonly NotebookEntry[], folder: string): string[] {
  const tags: string[] = []
  for (const project of projectsOf(entries, folder)) {
    const tag = normalizeTag(project)
    if (tag !== undefined && !tags.includes(tag)) tags.push(tag)
    if (tags.length === 2) break
  }
  return tags
}

export function tagsPrompt(folder: string, entries: readonly NotebookEntry[]): string {
  const projects = projectsOf(entries, folder)
  const lines = activeIn(entries, folder)
    .slice(0, PROMPT_ENTRIES)
    .map(entry => {
      const body = entry.content.replace(/\s+/g, ' ').trim().slice(0, PROMPT_CHARS)
      return `- ${entry.title}: ${body}`
    })
  return [
    `Below are the notes in a notebook named "${folder}", saved from several Claude Code sessions.`,
    projects.length > 0
      ? `They were captured while working in these project directories: ${projects.join(', ')}.`
      : 'No project directory is known for them.',
    `Choose at most ${MAX_TAGS} short tags (one to three words each) for this notebook: the first names the project when one is evident, the others say what the notes are about.`,
    'Answer with the tags alone, separated by commas: no numbering, no explanation, no # signs.',
    '',
    ...lines,
  ].join('\n')
}

/** A model's answer made safe to show: at most three normalized, distinct tags. */
export function parseTags(text: string): string[] {
  const tags: string[] = []
  for (const part of text.replace(/\n/g, ',').split(',')) {
    const tag = normalizeTag(part)
    if (tag !== undefined && !tags.includes(tag)) tags.push(tag)
    if (tags.length === MAX_TAGS) break
  }
  return tags
}
