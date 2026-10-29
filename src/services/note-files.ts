/**
 * Notes as markdown files: how an entry is written to `<notes root>/<Notebook>/
 * <name>.md` with front matter, how such a file is read back, and how a scan
 * of the files is turned into the changes to apply to the store. Pure, so
 * the hooks module only does the reading and writing.
 */
import type { EntryType, NotebookEntry, SourceRole } from '../types'
import { DEFAULT_FOLDER, isEntryType } from '../domain/notebook-entry'
import { normalizeContent } from '../utils/normalize-content'
import {
  NOTE_ROLES,
  fileNameFor as coreFileNameFor,
  isNoteId,
  parseNoteFile,
  projectNameOf,
  serializeNoteFile,
  sourcePathFor,
  type NoteFileMeta,
  type SourceFile,
} from '../core/note-format.mjs'

export { NOTEBOOK_META_FILE, NOTES_DIR, SETTINGS_FILE, SOURCES_DIR, TOUCH_FILE, TRASH_DIR, slugOf } from '../core/note-format.mjs'

export function fileNameFor(entry: Pick<NotebookEntry, 'id' | 'title'>): string {
  return coreFileNameFor(entry.id, entry.title)
}

/** The relative path an entry's file takes when it is first exported. */
export function relPathFor(entry: Pick<NotebookEntry, 'id' | 'title' | 'folder'>): string {
  return `${entry.folder}/${fileNameFor(entry)}`
}

export type NoteMeta = NoteFileMeta

/** The project a note was captured in, by name: recorded as such, or the last segment of an older capture's directory. */
export function projectOf(entry: Pick<NotebookEntry, 'sources'>): string | undefined {
  const context = entry.sources[0]?.context
  return context?.project ?? projectNameOf(context?.cwd)
}

function isSourceRole(value: unknown): value is Exclude<SourceRole, 'unknown'> {
  return typeof value === 'string' && (NOTE_ROLES as readonly string[]).includes(value)
}

/**
 * An entry's file. The front matter carries everything a note needs to be
 * rebuilt from the folder alone except the original snapshot, which is the
 * sidecar's (`sourceFileOf`).
 */
export function serializeNote(entry: NotebookEntry): string {
  const source = entry.sources[0]
  const meta: NoteFileMeta = {
    id: entry.id,
    title: entry.title,
    folder: entry.folder,
    created: new Date(entry.createdAt).toISOString(),
    updated: new Date(entry.updatedAt).toISOString(),
  }
  if (entry.type !== 'other') meta.type = entry.type
  if (entry.tags.length > 0) meta.tags = entry.tags
  if (source !== undefined) {
    meta.captured = source.captureMode
    if (isSourceRole(source.role)) meta.role = source.role
    if (source.sessionId !== undefined) meta.session = source.sessionId
  }
  const project = projectOf(entry)
  if (project !== undefined) meta.project = project
  if (entry.pinned === true) meta.pinned = true
  if (entry.status === 'archived') meta.archived = true
  return serializeNoteFile(meta, entry.content)
}

/**
 * The sidecar for a note saved from a conversation: the text exactly as it
 * was captured, before any edit. Undefined for a note written by hand (its
 * snapshot is its first text, nothing worth keeping apart).
 */
export function sourceFileOf(entry: NotebookEntry): { path: string; text: string } | undefined {
  const source = entry.sources[0]
  if (source === undefined || source.sessionId === undefined || source.snapshot === '' || !isNoteId(entry.id)) return undefined
  const file: SourceFile = {
    id: entry.id,
    captureMode: source.captureMode,
    capturedAt: new Date(source.capturedAt).toISOString(),
    snapshot: source.snapshot,
  }
  if (source.messageId !== undefined) file.messageId = source.messageId
  if (source.startOffset !== undefined) file.startOffset = source.startOffset
  if (source.endOffset !== undefined) file.endOffset = source.endOffset
  return { path: sourcePathFor(entry.id), text: `${JSON.stringify(file, null, 2)}\n` }
}

/**
 * An empty note's file, as the web notebook makes one: titled Untitled until
 * it has text. An empty file is not imported, so it becomes an entry only
 * once something is written in it.
 */
export function blankNoteFile(id: string, folder: string, now: number): { path: string; text: string } {
  const at = new Date(now).toISOString()
  const text = serializeNoteFile({ id, title: 'Untitled', folder, created: at, updated: at, captured: 'excerpt' }, '')
  return { path: relPathFor({ id, title: 'Untitled', folder }), text }
}

/** Reads front matter and body; a file with no front matter is all body. */
export function parseNote(text: string): { meta: NoteMeta; content: string } {
  return parseNoteFile(text)
}

/**
 * A note file's editable fields as this session last wrote or read them:
 * what a later write or import merges against. A field that differs from
 * its base changed on disk (on the web, by hand, or by another session).
 */
export type FileBase = {
  content: string
  title?: string
  type?: string
  tags?: readonly string[]
  pinned: boolean
}

/** A file's text as a base. */
export function baseOfText(text: string): FileBase {
  const { meta, content } = parseNote(text)
  const normalized = normalizeContent(content)
  const base: FileBase = { content: normalized.ok ? normalized.content : content, pinned: meta.pinned === true }
  if (meta.title !== undefined) base.title = meta.title
  if (meta.type !== undefined) base.type = meta.type
  if (meta.tags !== undefined) base.tags = [...meta.tags]
  return base
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * What a write of `entry` must take from the file on disk first: the fields
 * that changed there since `base` and still differ from the store. Both
 * sides changing the text is a conflict: the store's text stays and the
 * disk's comes back as `conflictContent`, to be kept as a note of its own.
 * Without a base nothing is known about the disk's history, and nothing is
 * taken (the write goes as before).
 */
export function mergeDiskChanges(
  entry: NotebookEntry,
  diskText: string,
  base: FileBase | undefined,
): { patch: { content?: string; title?: string; type?: EntryType; tags?: string[]; pinned?: boolean }; conflictContent?: string } {
  const patch: { content?: string; title?: string; type?: EntryType; tags?: string[]; pinned?: boolean } = {}
  if (base === undefined) return { patch }
  const disk = baseOfText(diskText)
  let conflictContent: string | undefined
  if (disk.content !== base.content && disk.content !== entry.content && disk.content.trim() !== '') {
    if (entry.content !== base.content) conflictContent = disk.content
    else patch.content = disk.content
  }
  if (disk.title !== undefined && disk.title.trim() !== '' && disk.title !== 'Untitled' && !sameValue(disk.title, base.title) && disk.title !== entry.title) {
    patch.title = disk.title
  }
  if (isEntryType(disk.type) && !sameValue(disk.type, base.type) && disk.type !== entry.type) patch.type = disk.type
  if (disk.tags !== undefined && !sameValue(disk.tags, base.tags) && !sameValue(disk.tags, entry.tags)) patch.tags = [...disk.tags]
  if (disk.pinned !== base.pinned && disk.pinned !== (entry.pinned === true)) patch.pinned = disk.pinned
  return conflictContent === undefined ? { patch } : { patch, conflictContent }
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
  | { kind: 'update'; entryId: string; content?: string; title?: string; file?: string; folder?: string; type?: EntryType; tags?: string[]; pinned?: boolean }
  | { kind: 'archive'; entryId: string }
  | {
      kind: 'create'
      path: string
      folder: string
      content: string
      title?: string
      id?: string
      createdAt?: number
      type?: EntryType
      tags?: string[]
      pinned?: true
      /** Where the note came from, as its front matter says: a file rebuilt from a conversation's capture keeps it. */
      origin?: { captureMode: 'whole_message' | 'excerpt'; role?: Exclude<SourceRole, 'unknown'>; sessionId?: string; project?: string }
    }

export type ImportPlanInput = {
  /** Every note file now present. */
  files: readonly NoteFile[]
  /** The text of each file whose modification time changed, by path. */
  texts: Readonly<Record<string, string>>
  entries: readonly NotebookEntry[]
  folders: readonly string[]
  /** Notebook directories now present. */
  dirs: readonly string[]
  /**
   * What this session last wrote to or read from each file, by path. A
   * field equal to its base did not change on disk, so the store's value
   * (a change not yet written to the file) stays.
   */
  bases?: Readonly<Record<string, FileBase>>
}

/** A file's record of the conversation it was saved from; undefined for a note written by hand. */
function originOf(meta: NoteMeta): Extract<ImportAction, { kind: 'create' }>['origin'] {
  if (meta.session === undefined) return undefined
  const origin: NonNullable<Extract<ImportAction, { kind: 'create' }>['origin']> = {
    captureMode: meta.captured === 'whole_message' ? 'whole_message' : 'excerpt',
    sessionId: meta.session,
  }
  if (isSourceRole(meta.role)) origin.role = meta.role
  if (meta.project !== undefined) origin.project = meta.project
  return origin
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
      if (meta.tags !== undefined && meta.tags.length > 0) create.tags = meta.tags
      if (meta.pinned === true) create.pinned = true
      const origin = originOf(meta)
      if (origin !== undefined) create.origin = origin
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
    const base = input.bases?.[file.path]
    const disk = baseOfText(text)
    const isDiskChange = (field: keyof FileBase) => base === undefined || !sameValue(disk[field], base[field])
    if (normalized.ok && normalized.content !== entry.content && isDiskChange('content')) {
      update.content = normalized.content
      isChanged = true
    }
    if (meta.title !== undefined && meta.title.trim() !== '' && meta.title !== 'Untitled' && meta.title !== entry.title && isDiskChange('title')) {
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
    if (isEntryType(meta.type) && meta.type !== entry.type && isDiskChange('type')) {
      update.type = meta.type
      isChanged = true
    }
    // Tags edited in the file. A file with no tags line says nothing about them (one written before files carried tags).
    if (meta.tags !== undefined && meta.tags.join('\n') !== entry.tags.join('\n') && isDiskChange('tags')) {
      update.tags = meta.tags
      isChanged = true
    }
    // A pin set or cleared on the web.
    if ((meta.pinned === true) !== (entry.pinned === true) && isDiskChange('pinned')) {
      update.pinned = meta.pinned === true
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
