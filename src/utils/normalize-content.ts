/**
 * The documented size ceiling for one entry's content. The host store holds
 * 4 MiB of JSON in all; this keeps a single capture well inside it and leaves
 * room for many entries.
 */
export const MAX_CONTENT_CHARS = 200_000

export type NormalizeResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'empty' | 'too-large'; message: string }

/**
 * Prepares captured text for storage: line endings become `\n`, trailing
 * blank lines go, everything else (indentation, code blocks, inner blank
 * lines) stays. Empty or oversized text is reported, never truncated.
 */
export function normalizeContent(raw: string): NormalizeResult {
  const content = raw.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  if (content.trim() === '') {
    return { ok: false, reason: 'empty', message: 'Nothing to save: the content is empty.' }
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return {
      ok: false,
      reason: 'too-large',
      message: `This content is ${content.length.toLocaleString()} characters; the limit is ${MAX_CONTENT_CHARS.toLocaleString()}. Save a smaller excerpt instead.`,
    }
  }
  return { ok: true, content }
}

/** A title from the first meaningful line, stripped of markdown markers. */
export function deriveTitle(content: string, max = 80): string {
  const line = content
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !/^```/.test(l))
  if (line === undefined) return 'Untitled'
  const cleaned = line
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*>]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/[`*_]/g, '')
    .trim()
  if (cleaned === '') return 'Untitled'
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned
}

export function parseTags(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim().replace(/^#/, '').toLowerCase()
    if (tag !== '') seen.add(tag)
  }
  return [...seen]
}

/** One line of preview text, whitespace collapsed, cut to `max` characters. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (max <= 1) return flat === '' ? '' : '…'
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** Markdown reduced to readable text: markers gone, the words kept. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*```[^\n]*$/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/(\*\*|__)([^*_\n]+)\1/g, '$2')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1')
}

/**
 * A row's preview: the content as plain text, without the line the title
 * was derived from (so the title is not shown twice), cut to `max`.
 */
export function previewOf(entry: { title: string; content: string }, max: number): string {
  const lines = plainText(entry.content)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  const isTitleLine = deriveTitle(entry.content) === entry.title
  const body = isTitleLine ? lines.slice(1) : lines
  return oneLine(body.join(' ') || lines.join(' '), max)
}
