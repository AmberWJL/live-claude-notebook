/**
 * The notes folder on disk, for everything that reads or writes it with
 * Node: the web server, the `live-notebook` command (and its MCP server),
 * and the editor extensions. The format of each file is note-format.mjs's;
 * this module finds, lists, searches and creates the files, and keeps the
 * inbox of replies an agent's hook captured. Plain JavaScript with no
 * dependencies; `note-store.d.mts` types it.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'

import {
  NOTEBOOK_META_FILE,
  NOTE_ROLES,
  NOTE_TYPES,
  NOTES_DIR,
  TOUCH_FILE,
  fileNameFor,
  isNotePath,
  noteMatches,
  parseNoteFile,
  safeFolderName,
  serializeNoteFile,
  titleOf,
} from './note-format.mjs'

/** The notebook a note goes to when none is named. */
export const DEFAULT_NOTEBOOK = 'General'
export const INBOX_DIR = 'inbox'
/** How many captured replies the inbox keeps; the oldest go first. */
export const INBOX_LIMIT = 50
/** The longest note accepted, as the Claude Code Mod accepts. */
export const MAX_NOTE_CHARS = 200_000

/** An error with a short code a caller can act on (`bad-folder`, `bad-path`, `empty`, `too-long`, `not-found`). */
export class NoteStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** The notes root: the one given, else `LIVE_NOTEBOOK_HOME`, else `~/.claude/live-notebook`. */
export function resolveRoot(given, env = process.env) {
  if (typeof given === 'string' && given.trim() !== '') return resolve(given.trim())
  const own = env.LIVE_NOTEBOOK_HOME?.trim()
  return resolve(own !== undefined && own !== '' ? own : join(homedir(), '.claude', 'live-notebook'))
}

export function notesDirOf(root) {
  return join(root, NOTES_DIR)
}

/** The absolute path of a note file named `<Notebook>/<name>.md`, or undefined when it would leave the notes folder. */
export function notePathOf(root, rel) {
  if (!isNotePath(rel)) return undefined
  const dir = notesDirOf(root)
  const abs = resolve(dir, rel)
  return abs.startsWith(dir + sep) ? abs : undefined
}

/** Marks a change, so the Claude Code Mod (which watches this one file) imports it within a few seconds. */
export function touch(root) {
  mkdirSync(notesDirOf(root), { recursive: true })
  writeFileSync(join(notesDirOf(root), TOUCH_FILE), String(Date.now()))
}

/** A notebook's `_notebook.json`: its tags, and its pinned and archived flags; `{}` when none. */
export function readNotebookMeta(folderAbs) {
  try {
    const meta = JSON.parse(readFileSync(join(folderAbs, NOTEBOOK_META_FILE), 'utf8'))
    return meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
  } catch {
    return {}
  }
}

/** Every active (not archived) note file, read: `{ path, folder, meta, content, mtime }`. */
export function readAllNotes(root) {
  const dir = notesDirOf(root)
  if (!existsSync(dir)) return []
  const notes = []
  for (const folder of readdirSync(dir, { withFileTypes: true })) {
    if (!folder.isDirectory() || folder.name.startsWith('.')) continue
    for (const file of readdirSync(join(dir, folder.name), { withFileTypes: true })) {
      if (!file.isFile() || extname(file.name) !== '.md') continue
      const abs = join(dir, folder.name, file.name)
      const { meta, content } = parseNoteFile(readFileSync(abs, 'utf8'))
      if (meta.archived === true) continue
      notes.push({ path: `${folder.name}/${file.name}`, folder: folder.name, meta, content, mtime: statSync(abs).mtime.toISOString() })
    }
  }
  return notes
}

function titleFor(note) {
  return note.meta.title ?? titleOf(note.content) ?? note.path.split('/')[1].replace(/\.md$/, '')
}

/**
 * The notebooks and their active notes, as the web notebook lists them:
 * pinned first, then by name; in each, pinned notes first, then the newest.
 * An archived notebook stays off the list until a note is saved into it again.
 */
export function listNotebooks(root) {
  const dir = notesDirOf(root)
  mkdirSync(dir, { recursive: true })
  const byFolder = new Map()
  for (const note of readAllNotes(root)) {
    const list = byFolder.get(note.folder) ?? []
    list.push({
      path: note.path,
      id: note.meta.id ?? null,
      title: titleFor(note),
      created: note.meta.created ?? null,
      updated: note.meta.updated ?? note.mtime,
      captured: note.meta.captured ?? null,
      type: note.meta.type ?? null,
      tags: note.meta.tags ?? [],
      pinned: note.meta.pinned === true,
      preview: note.content.replace(/\s+/g, ' ').trim().slice(0, 140),
    })
    byFolder.set(note.folder, list)
  }
  const notebooks = []
  for (const folder of readdirSync(dir, { withFileTypes: true })) {
    if (!folder.isDirectory() || folder.name.startsWith('.')) continue
    const meta = readNotebookMeta(join(dir, folder.name))
    const tags = Array.isArray(meta.tags) ? meta.tags.filter(tag => typeof tag === 'string').slice(0, 3) : []
    const notes = byFolder.get(folder.name) ?? []
    notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updated).localeCompare(String(a.updated)))
    if (meta.archived === true && notes.length === 0) continue
    notebooks.push({ name: folder.name, tags, pinned: meta.pinned === true, count: notes.length, notes })
  }
  notebooks.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name))
  return notebooks
}

/** One note's file, read; undefined when there is none at that path. */
export function readNote(root, rel) {
  const abs = notePathOf(root, rel)
  if (abs === undefined) throw new NoteStoreError('bad-path', `Not a note path: ${String(rel)}`)
  if (!existsSync(abs)) return undefined
  const { meta, content } = parseNoteFile(readFileSync(abs, 'utf8'))
  return { path: rel, meta, content }
}

/** A window of text around the first match, for a search result. */
function snippetOf(content, query, width = 160) {
  const flat = content.replace(/\s+/g, ' ').trim()
  const needle = query.trim().toLowerCase()
  const at = needle === '' ? -1 : flat.toLowerCase().indexOf(needle)
  if (at < 0) return flat.slice(0, width)
  const start = Math.max(0, at - Math.floor((width - needle.length) / 2))
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + width)}${start + width < flat.length ? '…' : ''}`
}

/** Active notes whose title, text or tags hold `query` (case-insensitive), newest first, at most `limit`. */
export function searchNotes(root, query, { limit = 50 } = {}) {
  return readAllNotes(root)
    .filter(note => noteMatches({ title: titleFor(note), content: note.content, tags: note.meta.tags }, query))
    .map(note => ({
      path: note.path,
      notebook: note.folder,
      title: titleFor(note),
      type: note.meta.type ?? null,
      tags: note.meta.tags ?? [],
      updated: note.meta.updated ?? note.mtime,
      snippet: snippetOf(note.content, query),
    }))
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
    .slice(0, Math.max(1, limit))
}

/**
 * Writes a new note: `<Notebook>/<slug>--<id8>.md`, its notebook made if new.
 * `content` is the text; the title is the one given, else its first line.
 * `captured`, `role`, `agent` and `project` say where it came from. Empty
 * text is refused unless `allowEmpty` (a blank note the web opens to write).
 */
export function createNote(root, input) {
  const folder = safeFolderName(input.folder ?? DEFAULT_NOTEBOOK)
  if (folder === undefined) throw new NoteStoreError('bad-folder', 'A notebook name is 1 to 40 characters, with no slash and not starting with a dot.')
  const content = String(input.content ?? '').replace(/\r\n?/g, '\n')
  if (content.trim() === '' && input.allowEmpty !== true) throw new NoteStoreError('empty', 'There is no text to save.')
  if (content.length > MAX_NOTE_CHARS) throw new NoteStoreError('too-long', `A note holds at most ${MAX_NOTE_CHARS.toLocaleString('en-US')} characters.`)
  const given = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : ''
  const title = given !== '' && given !== 'Untitled' ? given.slice(0, 200) : (titleOf(content) ?? 'Untitled')
  const id = input.id ?? randomUUID()
  const now = new Date(input.now ?? Date.now()).toISOString()
  const meta = { id, title, folder, created: now, updated: now, captured: input.captured === 'whole_message' ? 'whole_message' : 'excerpt' }
  if (NOTE_TYPES.includes(input.type) && input.type !== 'other') meta.type = input.type
  if (Array.isArray(input.tags)) {
    const tags = input.tags.filter(tag => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim())
    if (tags.length > 0) meta.tags = tags
  }
  if (NOTE_ROLES.includes(input.role)) meta.role = input.role
  if (typeof input.agent === 'string' && /^[a-z0-9-]{1,32}$/.test(input.agent)) meta.agent = input.agent
  if (typeof input.project === 'string' && input.project.trim() !== '') meta.project = input.project.trim().slice(0, 120)
  const rel = `${folder}/${fileNameFor(id, title)}`
  const abs = notePathOf(root, rel)
  if (abs === undefined) throw new NoteStoreError('bad-path', 'That notebook name cannot be a folder.')
  mkdirSync(join(notesDirOf(root), folder), { recursive: true })
  writeFileSync(abs, serializeNoteFile(meta, content), { flag: 'wx' })
  touch(root)
  return { path: rel, meta, content }
}

// ---------------------------------------------------------------------------
// The inbox: replies an agent's hook captured, kept until saved or dropped
// ---------------------------------------------------------------------------

function inboxDirOf(root) {
  return join(root, INBOX_DIR)
}

function isInboxName(name) {
  return typeof name === 'string' && /^[0-9A-Za-z-]{1,80}\.json$/.test(name)
}

/** Keeps a captured reply; past `INBOX_LIMIT`, the oldest go. Returns its name. */
export function addToInbox(root, item, { limit = INBOX_LIMIT, now = Date.now() } = {}) {
  const text = String(item.text ?? '').replace(/\r\n?/g, '\n')
  if (text.trim() === '') throw new NoteStoreError('empty', 'There is no text to keep.')
  const dir = inboxDirOf(root)
  mkdirSync(dir, { recursive: true })
  const at = new Date(now).toISOString()
  const name = `${at.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`
  const record = { agent: typeof item.agent === 'string' ? item.agent : 'unknown', capturedAt: at, text: text.slice(0, MAX_NOTE_CHARS) }
  if (typeof item.project === 'string' && item.project !== '') record.project = item.project
  writeFileSync(join(dir, name), `${JSON.stringify(record, null, 2)}\n`)
  const names = readdirSync(dir).filter(isInboxName).sort()
  for (const old of names.slice(0, Math.max(0, names.length - limit))) unlinkSync(join(dir, old))
  return name
}

/** The captured replies, newest first: `{ name, agent, capturedAt, text, project? }`. */
export function listInbox(root) {
  const dir = inboxDirOf(root)
  if (!existsSync(dir)) return []
  const items = []
  for (const name of readdirSync(dir).filter(isInboxName).sort().reverse()) {
    const item = readInboxItem(root, name)
    if (item !== undefined) items.push(item)
  }
  return items
}

export function readInboxItem(root, name) {
  if (!isInboxName(name)) throw new NoteStoreError('bad-path', `Not an inbox item: ${String(name)}`)
  try {
    const record = JSON.parse(readFileSync(join(inboxDirOf(root), name), 'utf8'))
    if (typeof record?.text !== 'string') return undefined
    return { name, agent: String(record.agent ?? 'unknown'), capturedAt: String(record.capturedAt ?? ''), text: record.text, ...(typeof record.project === 'string' ? { project: record.project } : {}) }
  } catch {
    return undefined
  }
}

export function removeInboxItem(root, name) {
  if (!isInboxName(name)) throw new NoteStoreError('bad-path', `Not an inbox item: ${String(name)}`)
  const abs = join(inboxDirOf(root), name)
  if (existsSync(abs)) unlinkSync(abs)
}

/**
 * Files a captured reply as a note, word for word, and drops it from the
 * inbox. Its agent and project come along; no session, so the Claude Code
 * Mod never sends it to a model unless the AI setting says `all`.
 */
export function saveInboxItem(root, name, { folder, title } = {}) {
  const item = readInboxItem(root, name)
  if (item === undefined) throw new NoteStoreError('not-found', 'That reply is no longer in the inbox.')
  const note = createNote(root, {
    folder,
    title,
    content: item.text,
    captured: 'whole_message',
    role: 'assistant',
    agent: item.agent,
    project: item.project,
  })
  removeInboxItem(root, name)
  return note
}
