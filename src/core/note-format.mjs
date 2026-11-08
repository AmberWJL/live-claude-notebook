/**
 * The note file format, shared by everything that reads or writes the notes
 * folder: the web server, the Claude Code Mod and, later, the CLI and the
 * editor extensions. A note is `<root>/notes/<Notebook>/<slug>--<id8>.md`
 * with a small front matter block; what a capture kept beside the text (the
 * original snapshot) is a sidecar at `<root>/sources/<id>.json`. Plain
 * JavaScript with no dependencies so every one of them can import it as is;
 * `note-format.d.mts` types it for the Mod.
 */

export const NOTES_DIR = 'notes'
export const SOURCES_DIR = 'sources'
export const TRASH_DIR = 'trash'
export const SETTINGS_FILE = 'settings.json'
/** Per-notebook metadata: its tags and the web's pinned and archived flags. */
export const NOTEBOOK_META_FILE = '_notebook.json'
/** A file touched after every write through the server, so a change is one stat away. */
export const TOUCH_FILE = '.touch'

export const NOTE_TYPES = ['insight', 'learning', 'reference', 'other']
export const NOTE_ROLES = ['user', 'assistant', 'tool']
export const AI_MODES = ['chat-only', 'all', 'off']
/** When AI typing and tagging run: only on notes saved from a Claude Code conversation, unless set otherwise. */
export const DEFAULT_AI_MODE = 'chat-only'

const STRING_KEYS = ['id', 'title', 'folder', 'type', 'created', 'updated', 'captured', 'role', 'session', 'project']
/** Written JSON-quoted: free text that may hold a colon, a quote or a leading space. */
const QUOTED_KEYS = new Set(['title', 'folder', 'project'])
const ORDER = ['id', 'title', 'folder', 'type', 'tags', 'created', 'updated', 'captured', 'role', 'session', 'project']

export function slugOf(text, max = 48) {
  const slug = String(text)
    .toLowerCase()
    .normalize('NFKD')
    // An accent split off its letter goes, so `é` is `e`, not `e-`.
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug === '' ? 'note' : slug
}

export function fileNameFor(id, title) {
  return `${slugOf(title)}--${String(id).slice(0, 8)}.md`
}

/** The last segment of a path, either separator: what a note records as its project. */
export function projectNameOf(path) {
  if (typeof path !== 'string') return undefined
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return name === '' ? undefined : name
}

/** The first line of text that is not a code fence, without its markdown marks; undefined when none. */
export function titleOf(content) {
  const line = String(content)
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !l.startsWith('```'))
  if (line === undefined) return undefined
  const cleaned = line
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*>]\s+/, '')
    .replace(/[`*_]/g, '')
    .trim()
  return cleaned === '' ? undefined : cleaned.slice(0, 80)
}

/** A notebook name as a directory: trimmed, at most 40 characters, nothing that leaves the notes folder. */
export function safeFolderName(name) {
  if (typeof name !== 'string') return undefined
  const folder = name.replace(/\s+/g, ' ').trim()
  if (folder === '' || folder.length > 40 || /[/\\]/.test(folder) || folder.startsWith('.') || folder.includes('..')) {
    return undefined
  }
  return folder
}

/** Whether `rel` names a note file as `<Notebook>/<name>.md`, one level down and nowhere else. */
export function isNotePath(rel) {
  return typeof rel === 'string' && /^[^/\\]+\/[^/\\]+\.md$/.test(rel) && !rel.includes('..') && !rel.startsWith('.')
}

/** A note id as a sidecar file name: letters, digits and dashes only. */
export function isNoteId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id)
}

/** The sidecar holding a note's original capture, relative to the root. */
export function sourcePathFor(id) {
  return `${SOURCES_DIR}/${id}.json`
}

function parseTagList(raw) {
  try {
    const value = JSON.parse(raw)
    if (Array.isArray(value)) return value.filter(tag => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim())
  } catch {
    /* not a list */
  }
  return undefined
}

/**
 * Front matter and body. A file with no front matter is all body. Known keys
 * only; `tags` is a JSON list (`tags: ["a", "b"]`, which is also YAML), the
 * flags read `true` or not.
 */
export function parseNoteFile(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n')
  const meta = {}
  const body = rest => rest.replace(/\n$/, '')
  if (!normalized.startsWith('---\n')) return { meta, content: body(normalized) }
  // The block closes at the first line that is exactly `---`, which may be the very next one (empty front
  // matter). It is front matter only when every line in it is a `key: value` pair or blank: a note that
  // opens with a horizontal rule is all body.
  const lines = normalized.split('\n')
  const close = lines.indexOf('---', 1)
  if (close < 0) return { meta, content: body(normalized) }
  const headLines = lines.slice(1, close)
  if (!headLines.every(line => line.trim() === '' || /^[a-zA-Z_]+:/.test(line))) return { meta, content: body(normalized) }
  // Past the closing `---` line, then past the one blank line that separates it from the body.
  const rest = lines.slice(close + 1)
  if (rest[0] === '') rest.shift()
  const content = rest.join('\n')
  for (const line of headLines) {
    const match = /^([a-zA-Z_]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    const raw = match[2].trim()
    if (key === 'tags') {
      const tags = parseTagList(raw)
      if (tags !== undefined) meta.tags = tags
      continue
    }
    if (key === 'pinned' || key === 'archived') {
      meta[key] = raw === 'true'
      continue
    }
    if (!STRING_KEYS.includes(key)) continue
    let value = raw
    if (raw.startsWith('"')) {
      try {
        value = String(JSON.parse(raw))
      } catch {
        value = raw.slice(1, -1)
      }
    }
    if (value !== '') meta[key] = value
  }
  return { meta, content: body(content) }
}

/** The file for a note: its front matter in a fixed order, a blank line, the text. Empty and false fields are left out. */
export function serializeNoteFile(meta, content) {
  const lines = ['---']
  for (const key of ORDER) {
    const value = meta[key]
    if (key === 'tags') {
      if (Array.isArray(value) && value.length > 0) lines.push(`tags: ${JSON.stringify(value)}`)
      continue
    }
    if (value === undefined || value === null || value === '') continue
    lines.push(`${key}: ${QUOTED_KEYS.has(key) ? JSON.stringify(String(value)) : value}`)
  }
  if (meta.pinned === true) lines.push('pinned: true')
  if (meta.archived === true) lines.push('archived: true')
  lines.push('---', '', content, '')
  return lines.join('\n')
}

/** A sidecar's JSON as an object, or undefined when it is not one of ours. */
export function parseSourceFile(text) {
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.snapshot !== 'string') return undefined
    return value
  } catch {
    return undefined
  }
}

/** `settings.json`'s AI mode, the default when it is missing, unreadable or unknown. */
export function aiModeOf(settingsText) {
  try {
    const mode = JSON.parse(settingsText)?.ai
    return AI_MODES.includes(mode) ? mode : DEFAULT_AI_MODE
  } catch {
    return DEFAULT_AI_MODE
  }
}

/** Case-insensitive substring match over a note's title, text and tags. */
export function noteMatches(note, query) {
  const needle = String(query).trim().toLowerCase()
  if (needle === '') return true
  return (
    String(note.title ?? '').toLowerCase().includes(needle) ||
    String(note.content ?? '').toLowerCase().includes(needle) ||
    (note.tags ?? []).some(tag => String(tag).toLowerCase().includes(needle))
  )
}
