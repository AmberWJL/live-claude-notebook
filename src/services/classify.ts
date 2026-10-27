/**
 * What a model assigns to a saved note so the list can show it: its type
 * (insight, learning, ...) for the filters and a few tags. Pure; the hooks
 * module makes the model call and the person can change the result.
 */
import type { EntryType } from '../../types'
import { ENTRY_TYPES } from '../domain/notebook-entry'
import { normalizeTag } from './notebook-tags'

const CONTENT_CHARS = 1_200
export const MAX_NOTE_TAGS = 3
/** The most words a model's title for a note may have. */
export const MAX_TITLE_WORDS = 6

export const TYPE_LABELS: Readonly<Record<EntryType, string>> = {
  insight: 'Insight',
  learning: 'Learning',
  reference: 'Reference',
  other: 'Other',
}

/** A one-character mark for each type, drawn in the accent colour. */
export const TYPE_GLYPHS: Readonly<Record<EntryType, string>> = {
  insight: '◉',
  learning: '↗',
  reference: '▤',
  other: '•',
}

/**
 * The prompt for a note's type and tags; `withTitle` also asks for a title,
 * for a note saved from the chat, whose first line is rarely a good one.
 */
export function classifyPrompt(title: string, content: string, options: { withTitle?: boolean } = {}): string {
  const body = content.replace(/\s+/g, ' ').trim().slice(0, CONTENT_CHARS)
  const withTitle = options.withTitle === true
  return [
    'Classify this note saved from a Claude Code conversation.',
    ...(withTitle ? [`Title: a short title naming what the note is about, at most ${MAX_TITLE_WORDS} words, no quotes.`] : []),
    'Type: exactly one of insight (an explanation or finding worth remembering), learning (a lesson from something that went right or wrong),',
    'reference (a command, snippet, link or fact to look up), other.',
    `Tags: at most ${MAX_NOTE_TAGS} short lowercase tags (one or two words each) naming the technology, project or topic.`,
    `Answer on ${withTitle ? 'three' : 'two'} lines, exactly:`,
    ...(withTitle ? ['title: <the title>'] : []),
    'type: <one word>',
    'tags: <tags separated by commas>',
    '',
    ...(withTitle ? [] : [`Title: ${title}`]),
    `Note: ${body}`,
  ].join('\n')
}

/** A model's title, unquoted, without a closing period, cut to MAX_TITLE_WORDS; undefined when empty. */
export function cleanTitle(text: string): string | undefined {
  const words = text
    .trim()
    .replace(/^["'“‘`*_]+|["'”’`*_]+$/g, '')
    .replace(/[.。]+$/, '')
    .replace(/["'”’`*_]+$/, '')
    .split(/\s+/)
    .filter(word => word !== '')
  if (words.length === 0) return undefined
  const title = words.slice(0, MAX_TITLE_WORDS).join(' ').slice(0, 100).trim()
  return title === '' || title.toLowerCase() === 'untitled' ? undefined : title
}

/** The first type named in a text; undefined when none is. */
export function parseType(text: string): EntryType | undefined {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? []
  for (const word of words) {
    const singular = word.replace(/s$/, '')
    const found = ENTRY_TYPES.find(type => type === word || type === singular)
    if (found !== undefined) return found
  }
  return undefined
}

export type Classification = { type?: EntryType; tags: string[]; title?: string }

/** A model's two-line answer; tolerant of an answer that is only a type. */
export function parseClassification(text: string): Classification {
  const lines = text.split('\n').map(line => line.trim())
  const typeLine = lines.find(line => /^type\s*:/i.test(line))
  const tagsLine = lines.find(line => /^tags?\s*:/i.test(line))
  const titleLine = lines.find(line => /^title\s*:/i.test(line))
  const result: Classification = { tags: [] }
  const title = titleLine === undefined ? undefined : cleanTitle(titleLine.replace(/^title\s*:/i, ''))
  if (title !== undefined) result.title = title
  const type = parseType(typeLine ?? (tagsLine === undefined ? text : ''))
  if (type !== undefined) result.type = type
  if (tagsLine !== undefined) {
    for (const part of tagsLine.replace(/^tags?\s*:/i, '').split(',')) {
      const tag = normalizeTag(part)
      if (tag !== undefined && tag !== 'none' && !result.tags.includes(tag)) result.tags.push(tag)
      if (result.tags.length === MAX_NOTE_TAGS) break
    }
  }
  return result
}
