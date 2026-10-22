/**
 * Notes as markdown files: how an entry is written to `<notes root>/<Notebook>/
 * <name>.md` with front matter, how such a file is read back, and how a scan
 * of the files is turned into the changes to apply to the store. Pure, so
 * the hooks module only does the reading and writing.
 */
import type { EntryType, NotebookEntry } from '../../types'
import { DEFAULT_FOLDER, isEntryType } from '../domain/notebook-entry'
import { normalizeContent } from '../utils/normalize-content'

/** The directory under the notes root that holds one folder per notebook. */
export const NOTES_DIR = 'notes'
/** Per-notebook metadata the web app reads (its tags). */
export const NOTEBOOK_META_FILE = '_notebook.json'
/** A file the web server touches after every write, so a change is one stat away. */
export const TOUCH_FILE = '.touch'

export function slugOf(text: string, max = 48): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug === '' ? 'note' : slug
}

export function fileNameFor(entry: Pick<NotebookEntry, 'id' | 'title'>): string {
  return `${slugOf(entry.title)}--${entry.id.slice(0, 8)}.md`
}

/** The relative path an entry's file takes when it is first exported. */
export function relPathFor(entry: Pick<NotebookEntry, 'id' | 'title' | 'folder'>): string {
  return `${entry.folder}/${fileNameFor(entry)}`
}

export type NoteMeta = {
  id?: string
  title?: string
  folder?: string
  type?: string
  created?: string
  updated?: string
  captured?: string
  session?: string
  archived?: boolean
}

function quote(value: string): string {
  return JSON.stringify(value)
}

export function serializeNote(entry: NotebookEntry): string {
  const source = entry.sources[0]
  const lines = [
    '---',
    `id: ${entry.id}`,
    `title: ${quote(entry.title)}`,
    `folder: ${quote(entry.folder)}`,
    ...(entry.type === 'other' ? [] : [`type: ${entry.type}`]),
    `created: ${new Date(entry.createdAt).toISOString()}`,
    `updated: ${new Date(entry.updatedAt).toISOString()}`,
  ]
  if (source !== undefined) lines.push(`captured: ${source.captureMode}`)
  if (source?.sessionId !== undefined) lines.push(`session: ${source.sessionId}`)
  if (entry.status === 'archived') lines.push('archived: true')
  lines.push('---', '', entry.content, '')
  return lines.join('\n')
}

/** Reads front matter and body; a file with no front matter is all body. */
export function parseNote(text: string): { meta: NoteMeta; content: string } {
  const normalized = text.replace(/\r\n?/g, '\n')
  const meta: NoteMeta = {}
  const body = (rest: string) => rest.replace(/\n$/, '')
  if (!normalized.startsWith('---\n')) return { meta, content: body(normalized) }
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) return { meta, content: body(normalized) }
  const head = normalized.slice(4, end)
  // Past the closing `---` line, then past the one blank line that separates it from the body.
  let content = normalized.slice(end + 4)
  if (content.startsWith('\n')) content = content.slice(1)
  if (content.startsWith('\n')) content = content.slice(1)
  for (const line of head.split('\n')) {
    const match = /^([a-zA-Z_]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1] ?? ''
    const raw = (match[2] ?? '').trim()
    let value: string = raw
    if (raw.startsWith('"')) {
      try {
        value = String(JSON.parse(raw))
      } catch {
        value = raw.slice(1, -1)
      }
    }
    switch (key) {
      case 'id':
      case 'title':
      case 'folder':
      case 'type':
      case 'created':
      case 'updated':
      case 'captured':
      case 'session':
        if (value !== '') meta[key] = value
        break
      case 'archived':
        meta.archived = value === 'true'
        break
      default:
        break
    }
  }
  return { meta, content: body(content) }
}

/** One markdown file found under the notes root. */
export type NoteFile = {
  /** `<Notebook>/<name>.md` */
  path: string
  folder: string
  mtimeMs: number
}

export type ImportAction =
  | { kind: 'folder'; name: string }
  | { kind: 'folder-gone'; name: string }
  | { kind: 'update'; entryId: string; content?: string; title?: string; file?: string; folder?: string; type?: EntryType }
  | { kind: 'archive'; entryId: string }
  | { kind: 'create'; path: string; folder: string; content: string; title?: string; id?: string; createdAt?: number; type?: EntryType }

export type ImportPlanInput = {
  /** Every note file now present. */
  files: readonly NoteFile[]
  /** The text of each file whose modification time changed, by path. */
  texts: Readonly<Record<string, string>>
  entries: readonly NotebookEntry[]
  folders: readonly string[]
  /** Notebook directories now present. */
  dirs: readonly string[]
}

/** Which files changed since they were last imported. */
export function changedFiles(files: readonly NoteFile[], known: Readonly<Record<string, number>>): NoteFile[] {
  return files.filter(file => known[file.path] !== file.mtimeMs)
}

/**
 * The changes a scan of the files implies for the store: a directory that
 * is a new notebook, a file whose text differs from its entry, a file with
 * no entry (made in the web app), an entry whose file is gone.
 */
export function planImport(input: ImportPlanInput): ImportAction[] {
  const actions: ImportAction[] = []
  for (const dir of input.dirs) {
    if (!input.folders.some(one => one.toLowerCase() === dir.toLowerCase())) actions.push({ kind: 'folder', name: dir })
  }
  // A notebook whose directory disappeared was renamed or deleted on the web
  // (or by hand). The default notebook stays whatever happens to its folder.
  if (input.dirs.length > 0) {
    for (const folder of input.folders) {
      if (folder === DEFAULT_FOLDER) continue
      if (!input.dirs.some(dir => dir.toLowerCase() === folder.toLowerCase())) actions.push({ kind: 'folder-gone', name: folder })
    }
  }
  const byPath = new Map<string, NotebookEntry>()
  const byId = new Map<string, NotebookEntry>()
  for (const entry of input.entries) {
    byId.set(entry.id, entry)
    if (entry.file !== undefined) byPath.set(entry.file, entry)
  }
  const present = new Set(input.files.map(file => file.path))
  const matched = new Set<string>()

  for (const file of input.files) {
    const text = input.texts[file.path]
    if (text === undefined) continue
    const { meta, content } = parseNote(text)
    const entry = byPath.get(file.path) ?? (meta.id !== undefined ? byId.get(meta.id) : undefined)
    if (entry !== undefined) matched.add(entry.id)
    const normalized = normalizeContent(content)
    if (entry === undefined) {
      if (meta.archived === true || !normalized.ok) continue
      const create: ImportAction = { kind: 'create', path: file.path, folder: file.folder, content: normalized.content }
      if (meta.title !== undefined && meta.title !== 'Untitled') create.title = meta.title
      if (meta.id !== undefined && !byId.has(meta.id)) create.id = meta.id
      if (isEntryType(meta.type)) create.type = meta.type
      const created = meta.created === undefined ? NaN : Date.parse(meta.created)
      if (Number.isFinite(created)) create.createdAt = created
      actions.push(create)
      continue
    }
    if (meta.archived === true) {
      if (entry.status === 'confirmed') actions.push({ kind: 'archive', entryId: entry.id })
      continue
    }
    const update: ImportAction = { kind: 'update', entryId: entry.id }
    let isChanged = false
    if (normalized.ok && normalized.content !== entry.content) {
      update.content = normalized.content
      isChanged = true
    }
    if (meta.title !== undefined && meta.title.trim() !== '' && meta.title !== 'Untitled' && meta.title !== entry.title) {
      update.title = meta.title
      isChanged = true
    }
    if (entry.file !== file.path) {
      update.file = file.path
      isChanged = true
    }
    if (file.folder !== entry.folder) {
      update.folder = file.folder
      isChanged = true
    }
    if (isEntryType(meta.type) && meta.type !== entry.type) {
      update.type = meta.type
      isChanged = true
    }
    if (isChanged) actions.push(update)
  }

  for (const entry of input.entries) {
    if (entry.file !== undefined && entry.status === 'confirmed' && !present.has(entry.file) && !matched.has(entry.id)) {
      actions.push({ kind: 'archive', entryId: entry.id })
    }
  }
  return actions
}
