import type { NotebookEntry } from '../../types'

export type SearchOptions = {
  includeArchived?: boolean
  /** Only entries in this folder; absent or empty, every folder. */
  folder?: string
}

/** Most recently updated first; ties broken by creation time, then id. */
export function byRecency(a: NotebookEntry, b: NotebookEntry): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}

/**
 * Case-insensitive substring search over title, content and tags. An empty
 * query lists everything (archived entries excluded unless asked for).
 */
export function searchEntries(
  entries: readonly NotebookEntry[],
  query: string,
  options: SearchOptions = {},
): NotebookEntry[] {
  const needle = query.trim().toLowerCase()
  const folder = options.folder?.trim() ?? ''
  return entries
    .filter(entry => options.includeArchived === true || entry.status !== 'archived')
    .filter(entry => folder === '' || entry.folder === folder)
    .filter(entry => needle === '' || matches(entry, needle))
    .sort(byRecency)
}

function matches(entry: NotebookEntry, needle: string): boolean {
  return (
    entry.title.toLowerCase().includes(needle) ||
    entry.content.toLowerCase().includes(needle) ||
    entry.tags.some(tag => tag.toLowerCase().includes(needle))
  )
}

/** A short window of content around the first match, for a result row. */
export function matchExcerpt(entry: NotebookEntry, query: string, width = 80): string {
  const needle = query.trim().toLowerCase()
  const flat = entry.content.replace(/\s+/g, ' ').trim()
  if (needle === '') return flat.slice(0, width)
  const at = flat.toLowerCase().indexOf(needle)
  if (at < 0) return flat.slice(0, width)
  const start = Math.max(0, at - Math.floor((width - needle.length) / 2))
  const slice = flat.slice(start, start + width)
  return `${start > 0 ? '…' : ''}${slice}${start + width < flat.length ? '…' : ''}`
}
