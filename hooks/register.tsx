/**
 * Live Notebook's hooks module. Everything that touches `$` lives in this
 * file: the engine follows `$` only into functions declared here. The data
 * model, storage adapter, service, search, file format and the pane's
 * drawing are pure modules under ../src and ./ui, handed plain data and
 * closures.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import type {
  AppendedRow,
  CaptureContext,
  CaptureDraft,
  EditDraft,
  EntryType,
  FoldersRecord,
  MessageCandidate,
  NotebookEntry,
  NotebookTags,
  NotebookView,
  Notice,
  ServerInfo,
  SourceRole,
} from '../types'
import { NotebookError, messageOf } from '../src/domain/errors'
import { defaultFolders } from '../src/domain/notebook-entry'
import { classifyPrompt, parseClassification } from '../src/services/classify'
import {
  NOTEBOOK_META_FILE,
  NOTES_DIR,
  TOUCH_FILE,
  changedFiles,
  planImport,
  relPathFor,
  serializeNote,
  type NoteFile,
} from '../src/services/note-files'
import { NotebookService } from '../src/services/notebook-service'
import { heuristicTags, isCurrent, notebookStats, parseTags, tagsBasis, tagsPrompt } from '../src/services/notebook-tags'
import { HostStoreNotebookRepository, type HostStore } from '../src/storage/host-store-adapter'
import {
  ROWS_LIMIT,
  candidatesFrom,
  contextAround,
  draftFromCandidate,
  draftFromExcerpt,
  findMessageIndex,
  fingerprint,
  matchRow,
  type CaptureMeta,
} from './capture'
import { EDITOR_KEY, type EditorPost, type EditorProps } from './ui/editor'
import { renderAssistantBlock } from './ui/message-row'
import { renderNotebookPane, renderReadOnlyPane, type PaneActions } from './ui/notebook-pane'

/** The pane's id and the plugin's name, as `plugin.json` spells it. */
const PANE = 'live-notebook'
const TITLE = 'Live Notebook'
/** The fewest rows the content editor takes in the pane. */
const EDITOR_MIN_ROWS = 12
/** Rows of the pane the editor page needs besides the editor. */
const EDITOR_CHROME_ROWS = 11
/** The width asked for while a note is being written or edited. */
const EDITOR_COLUMNS = 110
/** How often the notes directory is checked for edits made on the web. */
const IMPORT_EVERY_MS = 3_000
/** How long a status line stays before it clears itself. */
const NOTICE_MS = 6_000
/** The model that chooses notebook tags and note types, and its limits. */
const TAGS_MODEL = 'haiku'
const TAGS_MAX_TOKENS = 60
const TAGS_TIMEOUT_MS = 20_000
const TYPE_MAX_TOKENS = 40

// Session state the pane draws from. Declared here, as consts of the hooks
// module, so the engine can match each one to the contract in ../types.
const viewAtom = atom({ plugin: 'live-notebook', key: 'view' } as const, { kind: 'home' } as NotebookView)
const entriesAtom = atom({ plugin: 'live-notebook', key: 'entries' } as const, [] as NotebookEntry[])
const draftAtom = atom({ plugin: 'live-notebook', key: 'draft' } as const, null as CaptureDraft | null)
const editAtom = atom({ plugin: 'live-notebook', key: 'edit' } as const, null as EditDraft | null)
const foldersAtom = atom({ plugin: 'live-notebook', key: 'folders' } as const, defaultFolders() as FoldersRecord)
const tagsAtom = atom({ plugin: 'live-notebook', key: 'tags' } as const, {} as Record<string, NotebookTags>)
const notesRootAtom = atom({ plugin: 'live-notebook', key: 'notesRoot' } as const, '')
const serverAtom = atom({ plugin: 'live-notebook', key: 'server' } as const, null as ServerInfo | null)
const knownAtom = atom({ plugin: 'live-notebook', key: 'known' } as const, {} as Record<string, number>)
const touchAtom = atom({ plugin: 'live-notebook', key: 'touch' } as const, 0)
const candidatesAtom = atom({ plugin: 'live-notebook', key: 'candidates' } as const, [] as MessageCandidate[])
const rowsAtom = atom({ plugin: 'live-notebook', key: 'rows' } as const, [] as AppendedRow[])
const queryAtom = atom({ plugin: 'live-notebook', key: 'query' } as const, '')
const typeFilterAtom = atom({ plugin: 'live-notebook', key: 'typeFilter' } as const, '')
const noticeAtom = atom({ plugin: 'live-notebook', key: 'notice' } as const, null as Notice)
const namingNotebookAtom = atom({ plugin: 'live-notebook', key: 'namingNotebook' } as const, false)
const isLoadingAtom = atom({ plugin: 'live-notebook', key: 'isLoading' } as const, true)
const isSavingAtom = atom({ plugin: 'live-notebook', key: 'isSaving' } as const, false)
const showSnapshotAtom = atom({ plugin: 'live-notebook', key: 'showSnapshot' } as const, false)
const collapsedAtom = atom({ plugin: 'live-notebook', key: 'collapsed' } as const, [] as string[])
const editorCommandAtom = atom({ plugin: 'live-notebook', key: 'editorCommand' } as const, null as { id: number; kind: string } | null)

type Dollar = EngineInterface

// ---------------------------------------------------------------------------
// Storage and service, bound to this session's `$`
// ---------------------------------------------------------------------------

function storeOf($: Dollar): HostStore {
  return {
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
    delete: key => $.store.delete(key),
    keys: () => $.store.keys(),
  }
}

function repositoryOf($: Dollar): HostStoreNotebookRepository {
  return new HostStoreNotebookRepository(storeOf($))
}

function serviceOf($: Dollar): NotebookService {
  return new NotebookService({
    repository: repositoryOf($),
    newId: () => crypto.randomUUID(),
    now: () => $.clock.now(),
  })
}

function textOf(content: readonly { type: string }[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

async function setNotice($: Dollar, notice: Notice): Promise<void> {
  await update($, noticeAtom, () => notice)
}

/** A status line that clears itself, unless another has replaced it meanwhile. */
async function flashNotice($: Dollar, notice: Exclude<Notice, null>): Promise<void> {
  const stamped: Exclude<Notice, null> = { ...notice, at: await $.clock.now() }
  await update($, noticeAtom, () => stamped)
  $.clock.after(NOTICE_MS, () => void update($, noticeAtom, current => (current?.at === stamped.at ? null : current ?? null)))
}

/** A capture of the same message, or the same text, already in the notebook. */
function duplicateOf(entries: readonly NotebookEntry[], draft: CaptureDraft): NotebookEntry | undefined {
  const messageId = draft.source.messageId
  return entries.find(
    entry =>
      entry.status !== 'archived' &&
      (entry.content === draft.content ||
        (messageId !== undefined && entry.sources.some(source => source.messageId === messageId && source.snapshot === draft.source.snapshot))),
  )
}

async function setView($: Dollar, view: NotebookView): Promise<void> {
  await update($, viewAtom, () => view)
}

/** Reloads the drawing cache from the store; reports malformed records. */
async function refreshEntries($: Dollar): Promise<void> {
  const repository = repositoryOf($)
  const [{ entries, malformed }, folders] = await Promise.all([repository.readAll(), repository.readFolders()])
  await update($, entriesAtom, () => entries)
  await update($, foldersAtom, () => folders)
  if (malformed.length > 0) {
    const n = malformed.length
    await setNotice($, {
      tone: 'error',
      text: `${n} stored ${n === 1 ? 'entry is' : 'entries are'} unreadable and ${n === 1 ? 'was' : 'were'} left untouched (${malformed[0]?.reason ?? 'unknown'}).`,
    })
  }
}

/** After any change to entries: the cache, then the tags that depend on it. */
async function afterChange($: Dollar): Promise<void> {
  await refreshEntries($)
  await refreshTags($)
}

async function showHome($: Dollar): Promise<void> {
  await update($, queryAtom, () => '')
  await update($, typeFilterAtom, () => '')
  await update($, namingNotebookAtom, () => false)
  const view = await read($, viewAtom)
  await setView($, { kind: 'home' })
  // Leaving the editor by the home icon keeps what was written; Resume returns to it.
  if (view.kind === 'confirm' && (await read($, draftAtom)) !== null) {
    await flashNotice($, { tone: 'ok', text: 'Draft kept', resume: true })
  } else if (view.kind === 'edit' && (await read($, editAtom)) !== null) {
    await flashNotice($, { tone: 'ok', text: 'Edit kept', resume: true })
  }
}

async function resumeEditing($: Dollar): Promise<void> {
  const [draft, edit] = await Promise.all([read($, draftAtom), read($, editAtom)])
  await setNotice($, null)
  if (edit) await setView($, { kind: 'edit', entryId: edit.entryId })
  else if (draft) await setView($, { kind: 'confirm' })
  else return
  await openForEditing($)
}


async function setQuery($: Dollar, query: string): Promise<void> {
  await update($, queryAtom, () => query)
}

async function setTypeFilter($: Dollar, type: string): Promise<void> {
  await update($, typeFilterAtom, () => type)
}

async function toggleNewNotebook($: Dollar): Promise<void> {
  await update($, namingNotebookAtom, isOpen => !(isOpen ?? false))
}

async function toggleSnapshot($: Dollar): Promise<void> {
  await update($, showSnapshotAtom, isShown => !(isShown ?? false))
}

/** A toolbar press: the editor applies the command once, by its id. */
async function formatEditor($: Dollar, kind: string): Promise<void> {
  await update($, editorCommandAtom, current => ({ id: (current?.id ?? 0) + 1, kind }))
}

/** Opens (or widens) the pane for writing. */
async function openForEditing($: Dollar): Promise<void> {
  await update($, editorCommandAtom, () => null)
  await update($, namingNotebookAtom, () => false)
  await $.ui.open({ id: PANE, title: TITLE, focus: true, columns: EDITOR_COLUMNS, rows: 30 })
}

async function toggleNotebook($: Dollar, folder: string): Promise<void> {
  await update($, collapsedAtom, list =>
    (list ?? []).includes(folder) ? (list ?? []).filter(one => one !== folder) : [...(list ?? []), folder],
  )
}

/** Scrolls the transcript to the message a note was captured from, while it is still drawn. */
async function viewSource($: Dollar, entryId: string): Promise<void> {
  const entry = (await read($, entriesAtom)).find(one => one.id === entryId)
  const messageId = entry?.sources[0]?.messageId
  if (messageId === undefined) return
  const result = await $.ui.scroll({ to: { requestId: messageId } })
  if (result.deny !== undefined) await flashNotice($, { tone: 'error', text: 'That message is not on screen any more' })
}

async function copyText($: Dollar, text: string, surface: RenderSurface): Promise<void> {
  const result = await $.ui.copy({ text, surface })
  await flashNotice($, result.isCopied ? { tone: 'ok', text: 'Copied' } : { tone: 'error', text: 'Nothing to copy to here' })
}

/** Asks the model for the note's type (insight, decision, ...); the person can change it later. */
async function classifyEntry($: Dollar, entryId: string): Promise<void> {
  const service = serviceOf($)
  const entry = await service.getById(entryId)
  if (!entry || entry.type !== 'other' || entry.content.trim() === '') return
  const result = await $.model.complete({
    model: TAGS_MODEL,
    prompt: classifyPrompt(entry.title, entry.content),
    maxTokens: TYPE_MAX_TOKENS,
    timeoutMs: TAGS_TIMEOUT_MS,
  })
  if (!result.isAnswered) return
  const { type, tags } = parseClassification(result.text)
  const current = await service.getById(entryId)
  if (!current) return
  const patch: { type?: EntryType; tags?: string[] } = {}
  if (type !== undefined && type !== 'other' && current.type === 'other') patch.type = type
  if (tags.length > 0 && current.tags.length === 0) patch.tags = tags
  if (patch.type === undefined && patch.tags === undefined) return
  const updated = await service.update(entryId, patch)
  try {
    await writeNoteFile($, updated)
  } catch {
    /* the file keeps its old front matter; the next export writes it */
  }
  await refreshEntries($)
}

async function setEntryType($: Dollar, entryId: string, type: EntryType): Promise<void> {
  try {
    const updated = await serviceOf($).update(entryId, { type })
    await writeNoteFile($, updated)
    await refreshEntries($)
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

// ---------------------------------------------------------------------------
// Notes as files
// ---------------------------------------------------------------------------

async function notesRootOf($: Dollar): Promise<string> {
  const cached = await read($, notesRootAtom)
  if (cached !== '') return cached
  const home = await $.env.get('HOME')
  const root = `${home !== undefined && home !== '' ? home : '.'}/.claude/live-notebook`
  await update($, notesRootAtom, () => root)
  return root
}

async function notesDirOf($: Dollar): Promise<string> {
  return `${await notesRootOf($)}/${NOTES_DIR}`
}

/** Writes an entry's markdown file (assigning a path the first time) and remembers its time. */
async function writeNoteFile($: Dollar, entry: NotebookEntry): Promise<NotebookEntry> {
  const dir = await notesDirOf($)
  const current = entry.file === undefined ? await serviceOf($).setFile(entry.id, relPathFor(entry)) : entry
  const file = current.file ?? relPathFor(current)
  const abs = `${dir}/${file}`
  await $.fs.write(abs, serializeNote(current))
  const stat = await $.fs.stat(abs)
  await update($, knownAtom, known => ({ ...(known ?? {}), [file]: stat.mtimeMs }))
  return current
}

async function writeNotebookMeta($: Dollar, folder: string, tags: NotebookTags | undefined): Promise<void> {
  const dir = await notesDirOf($)
  await $.fs.write(
    `${dir}/${folder}/${NOTEBOOK_META_FILE}`,
    JSON.stringify({ name: folder, tags: tags?.tags ?? [], generatedAt: tags?.generatedAt ?? null }, null, 2),
  )
}

/** Every entry without a file, or whose file is gone, gets one; every notebook gets its directory. */
async function exportAll($: Dollar): Promise<void> {
  const dir = await notesDirOf($)
  const [entries, folders, tags] = await Promise.all([read($, entriesAtom), read($, foldersAtom), read($, tagsAtom)])
  for (const entry of entries) {
    if (entry.status !== 'confirmed') continue
    if (entry.file !== undefined && (await $.fs.exists(`${dir}/${entry.file}`))) continue
    await writeNoteFile($, entry)
  }
  for (const folder of folders.names) {
    if (!(await $.fs.exists(`${dir}/${folder}/${NOTEBOOK_META_FILE}`))) await writeNotebookMeta($, folder, tags[folder])
  }
}

async function scanNoteFiles($: Dollar): Promise<{ files: NoteFile[]; dirs: string[] }> {
  const dir = await notesDirOf($)
  const files: NoteFile[] = []
  const dirs: string[] = []
  let top
  try {
    top = await $.fs.list(dir)
  } catch {
    return { files, dirs }
  }
  for (const entry of top) {
    if (entry.kind !== 'dir' || entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    dirs.push(entry.name)
    let inner
    try {
      inner = await $.fs.list(`${dir}/${entry.name}`)
    } catch {
      continue
    }
    for (const file of inner) {
      if (file.kind !== 'file' || !file.name.endsWith('.md')) continue
      files.push({ path: `${entry.name}/${file.name}`, folder: entry.name, mtimeMs: file.mtimeMs })
    }
  }
  return { files, dirs }
}

/**
 * Brings edits made to the files (by the web app or any editor) into the
 * store. Cheap when nothing changed: one stat of the touch file, unless
 * forced. Returns how many changes were applied.
 */
async function importChanges($: Dollar, options: { force?: boolean } = {}): Promise<number> {
  const dir = await notesDirOf($)
  if (options.force !== true) {
    let mark = 0
    try {
      mark = (await $.fs.stat(`${dir}/${TOUCH_FILE}`)).mtimeMs
    } catch {
      mark = 0
    }
    if (mark === (await read($, touchAtom))) return 0
    await update($, touchAtom, () => mark)
  }
  const { files, dirs } = await scanNoteFiles($)
  const known = await read($, knownAtom)
  const texts: Record<string, string> = {}
  for (const file of changedFiles(files, known)) {
    try {
      texts[file.path] = await $.fs.read(`${dir}/${file.path}`)
    } catch {
      /* unreadable now; next scan */
    }
  }
  const [entries, folders] = await Promise.all([read($, entriesAtom), read($, foldersAtom)])
  const actions = planImport({ files, texts, entries, folders: folders.names, dirs })
  const service = serviceOf($)
  const now = await $.clock.now()
  let applied = 0
  for (const action of actions) {
    try {
      if (action.kind === 'folder') await service.ensureFolder(action.name)
      else if (action.kind === 'folder-gone') await service.removeFolder(action.name)
      else if (action.kind === 'archive') await service.archive(action.entryId)
      else if (action.kind === 'update') {
        const patch: { content?: string; title?: string; file?: string; folder?: string; type?: EntryType } = {}
        if (action.content !== undefined) patch.content = action.content
        if (action.title !== undefined) patch.title = action.title
        if (action.file !== undefined) patch.file = action.file
        if (action.folder !== undefined) patch.folder = action.folder
        if (action.type !== undefined) patch.type = action.type
        await service.update(action.entryId, patch)
      } else {
        const input: Parameters<NotebookService['create']>[0] = {
          content: action.content,
          folder: action.folder,
          file: action.path,
          keepLastFolder: true,
          source: {
            captureMode: 'excerpt',
            role: 'unknown',
            snapshot: action.content,
            capturedAt: now,
            context: { before: [], after: [] },
          },
        }
        if (action.title !== undefined) input.title = action.title
        if (action.id !== undefined) input.id = action.id
        if (action.createdAt !== undefined) input.createdAt = action.createdAt
        if (action.type !== undefined) input.type = action.type
        await service.create(input)
      }
      applied += 1
    } catch (error) {
      await setNotice($, { tone: 'error', text: `A note file could not be imported: ${messageOf(error)}` })
    }
  }
  const next: Record<string, number> = {}
  for (const file of files) next[file.path] = file.mtimeMs
  await update($, knownAtom, () => next)
  if (applied > 0) await afterChange($)
  return applied
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Every notebook whose entries changed gets project-based tags now and a model's soon. */
async function refreshTags($: Dollar): Promise<void> {
  const [entries, folders, current, now] = await Promise.all([
    read($, entriesAtom),
    read($, foldersAtom),
    read($, tagsAtom),
    $.clock.now(),
  ])
  const next = { ...current }
  const changed: string[] = []
  const stale: string[] = []
  for (const folder of folders.names) {
    const stats = notebookStats(entries, folder)
    if (isCurrent(current[folder], stats)) continue
    next[folder] = { tags: heuristicTags(entries, folder), basis: tagsBasis(stats), generatedAt: now, by: 'heuristic' }
    changed.push(folder)
    if (stats.count > 0) stale.push(folder)
  }
  if (changed.length === 0) return
  await update($, tagsAtom, () => next)
  for (const folder of changed) {
    try {
      await writeNotebookMeta($, folder, next[folder])
    } catch {
      /* the web page shows the tags next time */
    }
  }
  if (stale.length > 0) $.clock.after(1, () => void generateTags($, stale))
}

async function generateTags($: Dollar, folders: readonly string[]): Promise<void> {
  for (const folder of folders) {
    const entries = await read($, entriesAtom)
    const stats = notebookStats(entries, folder)
    if (stats.count === 0) continue
    const basis = tagsBasis(stats)
    const result = await $.model.complete({
      model: TAGS_MODEL,
      prompt: tagsPrompt(folder, entries),
      maxTokens: TAGS_MAX_TOKENS,
      timeoutMs: TAGS_TIMEOUT_MS,
    })
    if (!result.isAnswered) continue
    const tags = parseTags(result.text)
    if (tags.length === 0) continue
    if (tagsBasis(notebookStats(await read($, entriesAtom), folder)) !== basis) continue
    const record: NotebookTags = { tags, basis, generatedAt: await $.clock.now(), by: 'model' }
    await repositoryOf($).writeTags(folder, record)
    await update($, tagsAtom, current => ({ ...(current ?? {}), [folder]: record }))
    try {
      await writeNotebookMeta($, folder, record)
    } catch {
      /* the web page shows the tags next time */
    }
  }
}

// ---------------------------------------------------------------------------
// The web notebook server
// ---------------------------------------------------------------------------

function parseServerInfo(stdout: string): ServerInfo {
  const line = stdout
    .trim()
    .split('\n')
    .map(one => one.trim())
    .filter(one => one.startsWith('{'))
    .pop()
  if (line === undefined) throw new NotebookError('storage', 'The web notebook server gave no address.')
  const parsed = JSON.parse(line) as Partial<ServerInfo>
  if (typeof parsed.port !== 'number' || typeof parsed.pid !== 'number' || typeof parsed.url !== 'string') {
    throw new NotebookError('storage', 'The web notebook server gave a malformed address.')
  }
  return { port: parsed.port, pid: parsed.pid, url: parsed.url, startedAt: parsed.startedAt ?? 0 }
}

/**
 * The node binary to run the server with: the PATH's, else the usual
 * install places, since a desktop-launched Claude Code may carry a bare PATH.
 */
async function nodeBinary($: Dollar): Promise<string> {
  try {
    const probe = await $.process.run(['node', '--version'], { timeoutMs: 5_000 })
    if (probe.exitCode === 0) return 'node'
  } catch {
    /* not on PATH */
  }
  const home = (await $.env.get('HOME')) ?? ''
  const candidates = ['/opt/homebrew/bin/node', '/usr/local/bin/node']
  try {
    const versions = (await $.fs.list(`${home}/.nvm/versions/node`))
      .filter(entry => entry.kind === 'dir')
      .map(entry => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const version of versions) candidates.unshift(`${home}/.nvm/versions/node/${version}/bin/node`)
  } catch {
    /* no nvm */
  }
  for (const candidate of candidates) {
    if (await $.fs.exists(candidate)) return candidate
  }
  throw new NotebookError('storage', 'Node.js was not found. Install it, or put `node` on the PATH Claude Code starts with.')
}

async function startServer($: Dollar): Promise<ServerInfo> {
  const root = await notesRootOf($)
  const pluginRoot = $.plugin.root
  const node = await nodeBinary($)
  const run = await $.process.run(
    [node, `${pluginRoot}/server/notebook-server.mjs`, '--launch', '--root', root, '--web', `${pluginRoot}/web`],
    { timeoutMs: 20_000 },
  )
  if (run.exitCode !== 0) {
    throw new NotebookError(
      'storage',
      `The web notebook server did not start (${run.stderr.trim() || run.stdout.trim() || `exit ${run.exitCode}`}). Is node on your PATH?`,
    )
  }
  const info = parseServerInfo(run.stdout)
  await update($, serverAtom, () => info)
  return info
}

/** Keeps the web notebook up from the start of the session; a failure waits for the person to press Open. */
async function ensureServer($: Dollar): Promise<void> {
  try {
    await startServer($)
  } catch {
    /* reported when the person opens it */
  }
}

async function openWeb($: Dollar, folder?: string): Promise<void> {
  try {
    const info = await startServer($)
    const url = folder === undefined ? info.url : `${info.url}/#/${encodeURIComponent(folder)}`
    const opened = await $.process.run(['open', url], { timeoutMs: 10_000 })
    if (opened.exitCode !== 0) await $.process.run(['xdg-open', url], { timeoutMs: 10_000 })
    await flashNotice($, { tone: 'ok', text: 'Opened in your browser' })
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/** What every capture records beside the text: when, where, which notebook, and the context around it. */
async function captureMeta($: Dollar, context?: Pick<CaptureContext, 'before' | 'after'>): Promise<CaptureMeta> {
  const [capturedAt, sessionId, cwd, folders] = await Promise.all([
    $.clock.now(),
    $.session.id(),
    $.session.root(),
    read($, foldersAtom),
  ])
  const meta: CaptureMeta = { draftId: crypto.randomUUID(), capturedAt, sessionId, folder: folders.last }
  if (context !== undefined) meta.context = { ...context, cwd }
  return meta
}

async function startCapturePick($: Dollar): Promise<number> {
  const [messages, rows] = await Promise.all([$.session.messages(), read($, rowsAtom)])
  const candidates = candidatesFrom(messages, rows)
  await update($, candidatesAtom, () => candidates)
  await setNotice($, null)
  await setView($, { kind: 'pick' })
  return candidates.length
}

async function pickCandidate($: Dollar, candidate: MessageCandidate): Promise<void> {
  const messages = await $.session.messages()
  const result = draftFromCandidate(candidate, await captureMeta($, contextAround(messages, candidate.index)))
  if (!result.ok) {
    await setNotice($, { tone: 'error', text: result.message })
    return
  }
  await update($, draftAtom, () => result.draft)
  await setNotice($, null)
  await setView($, { kind: 'confirm' })
}

async function startExcerptDraft(
  $: Dollar,
  text: string,
  origin: { messageId?: string; role?: SourceRole } = {},
): Promise<boolean> {
  const messages = await $.session.messages()
  const at = findMessageIndex(messages, text)
  const source = { ...origin }
  if (source.role === undefined && at >= 0) source.role = messages[at]?.role
  const result = draftFromExcerpt(text, source, await captureMeta($, contextAround(messages, at)))
  if (!result.ok) {
    await setNotice($, { tone: 'error', text: result.message })
    await setView($, { kind: 'home' })
    return false
  }
  await update($, draftAtom, () => result.draft)
  await setNotice($, null)
  await setView($, { kind: 'confirm' })
  return true
}

/** The save control under a reply block: a whole-message draft with the row's id. */
async function saveMessageBlock($: Dollar, text: string, messageId: string): Promise<void> {
  const messages = await $.session.messages()
  const at = findMessageIndex(messages, text)
  const candidate: MessageCandidate = { index: at, role: 'assistant', text, messageId }
  const result = draftFromCandidate(candidate, await captureMeta($, contextAround(messages, at)))
  if (!result.ok) {
    await setNotice($, { tone: 'error', text: result.message })
    await setView($, { kind: 'home' })
  } else {
    await update($, draftAtom, () => result.draft)
    await setNotice($, null)
    await setView($, { kind: 'confirm' })
  }
  await openForEditing($)
}

async function setDraftFolder($: Dollar, folder: string): Promise<void> {
  await update($, draftAtom, draft => (draft ? { ...draft, folder } : null))
}

async function setEditFolder($: Dollar, folder: string): Promise<void> {
  await update($, editAtom, edit => (edit ? { ...edit, folder } : null))
}

/** Creates (or finds) a notebook and selects it in whichever form is open. */
async function addFolder($: Dollar, name: string): Promise<void> {
  try {
    const record = await serviceOf($).addFolder(name)
    await update($, foldersAtom, () => record)
    await update($, draftAtom, draft => (draft ? { ...draft, folder: record.last } : null))
    await update($, editAtom, edit => (edit ? { ...edit, folder: record.last } : null))
    const fromHome = (await read($, namingNotebookAtom)) === true
    await update($, namingNotebookAtom, () => false)
    await setNotice($, fromHome ? { tone: 'ok', text: `Notebook "${record.last}" created` } : null)
    await refreshTags($)
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

/** A blank note, written in the pane's editor and filed in the last-used notebook. */
async function startBlankDraft($: Dollar): Promise<void> {
  const meta = await captureMeta($, { before: [], after: [] })
  const draft: CaptureDraft = {
    id: meta.draftId,
    content: '',
    folder: meta.folder,
    source: {
      captureMode: 'excerpt',
      role: 'unknown',
      snapshot: '',
      capturedAt: meta.capturedAt,
      sessionId: meta.sessionId,
      ...(meta.context === undefined ? {} : { context: meta.context }),
    },
  }
  await update($, draftAtom, () => draft)
  await setNotice($, null)
  await setView($, { kind: 'confirm' })
  await openForEditing($)
}

/** The editor posted new text: it belongs to the draft or the edit whose id it names. */
async function acceptEditorText($: Dollar, post: EditorPost): Promise<void> {
  await update($, draftAtom, draft => (draft && draft.id === post.draftId ? { ...draft, content: post.text } : draft ?? null))
  await update($, editAtom, edit => (edit && edit.id === post.draftId ? { ...edit, content: post.text } : edit ?? null))
}

async function cancelDraft($: Dollar): Promise<void> {
  await update($, draftAtom, () => null)
  await update($, editAtom, () => null)
  await setNotice($, null)
  await setView($, { kind: 'home' })
}

/**
 * The one place an entry is created. Success is reported only after the
 * repository write resolved; on failure the draft and the form stay.
 */
async function confirmSave($: Dollar): Promise<void> {
  const draft = await read($, draftAtom)
  if (!draft) {
    await showHome($)
    return
  }
  const existing = draft.source.snapshot === '' ? undefined : duplicateOf(await read($, entriesAtom), draft)
  if (existing !== undefined) {
    await update($, draftAtom, () => null)
    await flashNotice($, { tone: 'ok', text: `Already in ${existing.folder}`, open: existing.id })
    await setView($, { kind: 'home' })
    return
  }
  await update($, isSavingAtom, () => true)
  try {
    const entry = await serviceOf($).create({ content: draft.content, folder: draft.folder, source: draft.source })
    let fileNote = ''
    try {
      await writeNoteFile($, entry)
    } catch (error) {
      fileNote = ` (file not written: ${messageOf(error)})`
    }
    await afterChange($)
    await update($, draftAtom, () => null)
    await flashNotice($, { tone: 'ok', text: `Saved to ${entry.folder}${fileNote}`, open: entry.id })
    await setView($, { kind: 'home' })
    $.ui.toast(`Saved to ${entry.folder}: ${entry.title}`)
    $.clock.after(1, () => void classifyEntry($, entry.id))
  } catch (error) {
    await setNotice($, {
      tone: 'error',
      text: `${messageOf(error)} Your draft is still here; press Save to retry.`,
    })
  } finally {
    await update($, isSavingAtom, () => false)
  }
}

async function openEntry($: Dollar, entryId: string): Promise<void> {
  await setNotice($, null)
  await update($, showSnapshotAtom, () => false)
  await setView($, { kind: 'detail', entryId })
}

async function startEdit($: Dollar, entryId: string): Promise<void> {
  const entry = (await read($, entriesAtom)).find(one => one.id === entryId)
  if (!entry) return
  await update($, editAtom, () => ({ id: crypto.randomUUID(), entryId, content: entry.content, folder: entry.folder }))
  await setNotice($, null)
  await setView($, { kind: 'edit', entryId })
  await openForEditing($)
}

async function saveEdit($: Dollar): Promise<void> {
  const edit = await read($, editAtom)
  if (!edit) {
    await showHome($)
    return
  }
  await update($, isSavingAtom, () => true)
  try {
    const entry = await serviceOf($).update(edit.entryId, { content: edit.content, folder: edit.folder })
    let fileNote = ''
    try {
      await writeNoteFile($, entry)
    } catch (error) {
      fileNote = ` (file not written: ${messageOf(error)})`
    }
    await afterChange($)
    await update($, editAtom, () => null)
    await flashNotice($, { tone: 'ok', text: `Saved changes${fileNote}` })
    await setView($, { kind: 'detail', entryId: entry.id })
  } catch (error) {
    await setNotice($, { tone: 'error', text: `${messageOf(error)} Your changes are still here.` })
  } finally {
    await update($, isSavingAtom, () => false)
  }
}

async function cancelEdit($: Dollar): Promise<void> {
  const edit = await read($, editAtom)
  await update($, editAtom, () => null)
  await setNotice($, null)
  if (edit) await setView($, { kind: 'detail', entryId: edit.entryId })
  else await showHome($)
}

async function armDelete($: Dollar, entryId: string, isDeleteArmed: boolean): Promise<void> {
  await setView($, { kind: 'detail', entryId, isDeleteArmed })
}

async function archiveEntry($: Dollar, entryId: string): Promise<void> {
  try {
    const service = serviceOf($)
    await service.archive(entryId)
    const entry = await service.getById(entryId)
    if (entry) {
      try {
        await writeNoteFile($, entry)
      } catch {
        /* the file keeps the old text; the web app shows it until the next export */
      }
    }
    await afterChange($)
    await flashNotice($, { tone: 'ok', text: 'Archived' })
    await setView($, { kind: 'home' })
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

async function deleteEntry($: Dollar, entryId: string): Promise<void> {
  try {
    const service = serviceOf($)
    const entry = await service.getById(entryId)
    await service.delete(entryId)
    if (entry?.file !== undefined) {
      const abs = `${await notesDirOf($)}/${entry.file}`
      try {
        await $.process.run(['rm', '-f', abs], { timeoutMs: 5_000 })
      } catch {
        /* the file stays; the next import archives nothing since the entry is gone */
      }
      await update($, knownAtom, known => {
        const next = { ...(known ?? {}) }
        delete next[entry.file ?? '']
        return next
      })
    }
    await afterChange($)
    await flashNotice($, { tone: 'ok', text: 'Deleted' })
    await setView($, { kind: 'home' })
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

function actionsOf($: Dollar): PaneActions {
  return {
    search: query => void setQuery($, query),
    filterType: type => void setTypeFilter($, type),
    toggleNewNotebook: () => void toggleNewNotebook($),
    toggleNotebook: folder => void toggleNotebook($, folder),
    dismissNotice: () => void setNotice($, null),
    home: () => void showHome($),
    newNote: () => void startBlankDraft($),
    openWeb: folder => void openWeb($, folder),
    pick: candidate => void pickCandidate($, candidate),
    setDraftFolder: folder => void setDraftFolder($, folder),
    addFolder: name => void addFolder($, name),
    format: kind => void formatEditor($, kind),
    save: () => void confirmSave($),
    cancel: () => void cancelDraft($),
    resume: () => void resumeEditing($),
    open: entryId => void openEntry($, entryId),
    edit: entryId => void startEdit($, entryId),
    setType: (entryId, type) => void setEntryType($, entryId, type),
    toggleSnapshot: () => void toggleSnapshot($),
    viewSource: entryId => void viewSource($, entryId),
    copy: (text, surface) => void copyText($, text, surface),
    setEditFolder: folder => void setEditFolder($, folder),
    saveEdit: () => void saveEdit($),
    cancelEdit: () => void cancelEdit($),
    archive: entryId => void archiveEntry($, entryId),
    armDelete: (entryId, isArmed) => void armDelete($, entryId, isArmed),
    remove: entryId => void deleteEntry($, entryId),
  }
}

function isEditorPost(data: unknown): data is EditorPost {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).type === 'content' &&
    typeof (data as Record<string, unknown>).draftId === 'string' &&
    typeof (data as Record<string, unknown>).text === 'string'
  )
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'save',
      description: 'Save a recent message, the selected text, or typed text to Live Notebook',
      argumentHint: '[excerpt text]',
    })
    await $.command.register({
      name: 'notebook',
      description: 'Open Live Notebook; "web" opens it in the browser',
      argumentHint: '[search | web]',
    })
    try {
      const repository = repositoryOf($)
      await repository.ensureMeta()
      const tags = await repository.readTags()
      await update($, tagsAtom, () => tags)
      await refreshEntries($)
      await importChanges($, { force: true })
      await exportAll($)
      await refreshTags($)
    } catch (error) {
      await setNotice($, { tone: 'error', text: `Live Notebook could not read its store: ${messageOf(error)}` })
    } finally {
      await update($, isLoadingAtom, () => false)
    }
    $.clock.every(IMPORT_EVERY_MS, () => void importChanges($))
    $.clock.after(1, () => void ensureServer($))
    return next(e)
  })

  // Remember each main-conversation row's id so a captured message can be
  // matched back to it. Best effort: a fingerprint, not the text, is kept.
  // It also tells a reply's final text apart from the narration between tool
  // calls: a text block is `pending` until a tool call follows it (then
  // `intermediate`) or the turn ends (then `final`). Only final blocks get a
  // save control.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const row = e.message
    if (e.agentId === undefined && (row.type === 'user' || row.type === 'assistant') && row.role && !row.isMeta) {
      const text = textOf(row.content)
      const hasToolUse = row.role === 'assistant' && row.content.some(block => block.type === 'tool_use')
      await update($, rowsAtom, rows => {
        let kept = rows ?? []
        if (hasToolUse) kept = kept.map(one => (one.kind === 'pending' ? { ...one, kind: 'intermediate' as const } : one))
        if (text.trim() !== '') {
          const seen: AppendedRow = { uuid: e.uuid, role: row.role ?? 'assistant', ...fingerprint(text) }
          if (row.role === 'assistant') seen.kind = 'pending'
          kept = [...kept, seen]
        }
        return kept.slice(-ROWS_LIMIT)
      })
    }
    return stored
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, rowsAtom, rows =>
        (rows ?? []).map(one => (one.kind === 'pending' ? { ...one, kind: 'final' as const } : one)),
      )
    }
    return next(e)
  })

  on('command.run', { command: 'save' }, async ($, e) => {
    const typed = e.args.trim()
    let text: string
    if (typed !== '') {
      const ok = await startExcerptDraft($, typed)
      text = ok
        ? 'Review the excerpt in the Live Notebook pane, then press Save.'
        : 'That excerpt cannot be saved; see the pane.'
    } else {
      const selected = await $.ui.selection()
      if (selected !== undefined && selected.text.trim() !== '') {
        const origin = selected.requestId === undefined ? {} : { messageId: selected.requestId }
        const ok = await startExcerptDraft($, selected.text, origin)
        text = ok
          ? 'Review the selected text in the Live Notebook pane, then press Save.'
          : 'The selection cannot be saved; see the pane.'
      } else {
        const count = await startCapturePick($)
        text =
          count === 0
            ? 'No messages to pick from yet. Type /save followed by the text to save an excerpt.'
            : 'Pick a message in the Live Notebook pane, then press Save.'
      }
    }
    if ((await read($, viewAtom)).kind === 'confirm') await openForEditing($)
    else await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text }
  })

  on('command.run', { command: 'notebook' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'web') {
      await openWeb($)
      const server = await read($, serverAtom)
      return { text: server ? `Web notebook: ${server.url}` : 'The web notebook could not be started; see the pane.' }
    }
    // Not setQuery: opening the pane keeps a standing notice (an unreadable store record).
    await update($, queryAtom, () => args)
    await setView($, { kind: 'home' })
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: args === '' ? 'Live Notebook opened.' : `Live Notebook opened, searching for "${args}".` }
  })

  // The content editor posts its text after every change.
  on('ui.message', { element: EDITOR_KEY }, async ($, e, next) => {
    if (isEditorPost(e.data)) await acceptEditorText($, e.data)
    return next(e)
  })

  // A `Save to notebook` control under every assistant reply block. Summary
  // rows (the text between two tool calls) and empty blocks are left to the
  // engine, as are surfaces where a transcript row cannot be clicked.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary === true || e.props.text.trim() === '') return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { text, isFirstOfReply } = e.props
    const messageId = e.requestId
    // Narration between tool calls, and a block whose turn is still running,
    // is left to the engine; the reply at the end of a turn gets the control.
    const rows = await read($, rowsAtom)
    const row = rows.find(one => one.uuid === messageId) ?? rows.find(one => one.uuid === matchRow(rows, 'assistant', text))
    if (row?.kind === 'pending' || row?.kind === 'intermediate') return next(e)
    return renderAssistantBlock(
      $.ui.resolve(e),
      { surface: e.surface, text, isFirstOfReply },
      { save: () => void saveMessageBlock($, text, messageId) },
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [view, entries, draft, edit, folders, tags, server, candidates, query, notice, currentSessionId] =
      await Promise.all([
        read($, viewAtom),
        read($, entriesAtom),
        read($, draftAtom),
        read($, editAtom),
        read($, foldersAtom),
        read($, tagsAtom),
        read($, serverAtom),
        read($, candidatesAtom),
        read($, queryAtom),
        read($, noticeAtom),
        $.session.id(),
      ])
    const [typeFilter, isNamingNotebook, isLoading, isSaving, showSnapshot, notesRoot, collapsed, editorCommand] =
      await Promise.all([
        read($, typeFilterAtom),
        read($, namingNotebookAtom),
        read($, isLoadingAtom),
        read($, isSavingAtom),
        read($, showSnapshotAtom),
        read($, notesRootAtom),
        read($, collapsedAtom),
        read($, editorCommandAtom),
      ])
    const editorRows = Math.max(EDITOR_MIN_ROWS, (e.props.scroll?.bodyRows ?? 0) - EDITOR_CHROME_ROWS)
    if (e.surface === 'mobile') return renderReadOnlyPane($.ui.resolve(e), entries)

    // The editor is a Client; its module path must be a literal in this file.
    let editor: RenderElement | undefined
    const editing = view.kind === 'confirm' ? draft : view.kind === 'edit' ? edit : null
    if (editing && e.surface !== 'vscode') {
      const { Client } = $.ui.resolve(e)
      const props: EditorProps = { draftId: editing.id, text: editing.content, command: editorCommand }
      editor = <Client key={EDITOR_KEY} module="./ui/editor.ts" props={props} width="100%" height={editorRows} />
    }

    return renderNotebookPane(
      $.ui.resolve(e),
      {
        view,
        entries,
        draft,
        edit,
        folders,
        tags,
        server,
        candidates,
        query,
        typeFilter,
        notice,
        isNamingNotebook,
        isLoading,
        isSaving,
        showSnapshot,
        collapsed,
        notesRoot,
        width: e.props.bodyColumns,
        editorRows,
        currentSessionId,
        ...(editor === undefined ? {} : { editor }),
      },
      actionsOf($),
    )
  })
}
