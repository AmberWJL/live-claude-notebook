/**
 * What the film is about: one Claude Code session designing sharing for
 * notebooks, and the two replies from it worth keeping. The scenes draw
 * these; cues.mjs says when.
 */
export const NOTEBOOK = 'Design'
export const NOTES_DIR = '~/.claude/live-notebook/notes'

export type Note = {
  title: string
  text: string
  /** The note's type as the pane shows it, with its glyph. */
  glyph: string
  type: 'Insight' | 'Learning'
  file: string
  tags: string[]
  /** A code line under the text, in the reply and in the note. */
  code?: string
}

/** The insight, saved the moment Claude says it. */
export const INSIGHT: Note = {
  title: 'Model the question, not the table',
  text: 'People never ask "what’s my role?". They ask "who can see this?". One grants table answers it directly; roles are a view on top.',
  glyph: '◉',
  type: 'Insight',
  file: 'model-the-question-not-the-table--3f2a91c0.md',
  tags: ['sharing', 'permissions'],
  code: 'grants(notebook_id, principal, can)',
}

/** The learning, from a side question: buried by the rush, then rescued. */
export const LEARNING: Note = {
  title: 'Optimistic vs pessimistic locking',
  text: 'Optimistic: write with a version check and retry on conflict. Pessimistic: lock the row first. Sharing settings rarely conflict, so optimistic.',
  glyph: '↗',
  type: 'Learning',
  file: 'optimistic-vs-pessimistic-locking--7c1e4b2a.md',
  tags: ['concurrency', 'sharing'],
}

/** In the order they are saved. */
export const NOTES = [INSIGHT, LEARNING]

/** The rest of the Design notebook, as the other scenes show it. */
export const SHEET = { title: 'Who can see this: the sheet', text: 'One row per grant: a person or a link, and what they can do.' }
export const LINKS = { title: 'Share links expire', text: 'Links get a 7-day TTL and a one-time token; a revoked link is a deleted grant.' }

/** A note's front matter, as the Mod writes it. */
export const frontMatter = (note: Note): string[] => [
  '---',
  `title: "${note.title}"`,
  `folder: "${NOTEBOOK}"`,
  `type: ${note.type.toLowerCase()}`,
  `tags: [${note.tags.map(tag => `"${tag}"`).join(', ')}]`,
  'captured: whole_message',
  'role: assistant',
  '---',
]
