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
import { EXPORT_FORMATS, formatOf } from '../src/services/export-markdown.mjs'
import { deriveTitle } from '../src/utils/normalize-content'
import {
  NOTEBOOK_META_FILE,
  NOTES_DIR,
  TOUCH_FILE,
  blankNoteFile,
  changedFiles,
  planImport,
  relPathFor,
  serializeNote,
  slugOf,
  type NoteFile,
} from '../src/services/note-files'
import { NotebookService } from '../src/services/notebook-service'
import { activeIn, heuristicTags, isCurrent, notebookStats, parseTags, tagsBasis, tagsPrompt } from '../src/services/notebook-tags'
import { HostStoreNotebookRepository, type HostStore } from '../src/storage/host-store-adapter'
import {
  ROWS_LIMIT,
  contextAround,
  draftFromCandidate,
  draftFromExcerpt,
  findMessageIndex,
  fingerprint,
  matchRow,
  type CaptureMeta,
} from './capture'
import { EDITOR_KEY, SEARCH_EDITOR_KEY, TITLE_EDITOR_KEY, canScroll, type EditorPost, type EditorProps } from './ui/editor'
import { renderAssistantBlock } from './ui/message-row'
import { editorColumns, isOverPage, renderNotebookPane, renderReadOnlyPane, type PaneActions } from './ui/notebook-pane'

/** The pane's id and the plugin's name, as `plugin.json` spells it. */
const PANE = 'live-notebook'
const TITLE = 'Live Notebook'
/** A note row's grey under the pointer, light or dark as the theme is; the theme's own greys draw too dark. */
const HOVER_LIGHT = '#e8e8e8'
const HOVER_DARK = '#33332f'
/** The fewest rows the capture editor takes in the pane. */
const EDITOR_MIN_ROWS = 12
/** Rows of the pane the capture page needs besides the editor. */
const EDITOR_CHROME_ROWS = 11
/** An editor page's title field and the row above it. */
const TITLE_FIELD_ROWS = 2
/** Rows above the editor's text on its page: the header, the toolbar, the editor's top border, a row between each. */
const EDITOR_TOP_ROWS = 5
/** The preview under the editor: the row above it, its heading row and its border. */
const PREVIEW_CHROME_ROWS = 4
/** The fewest rows the editor keeps while the preview shares the page with it. */
const EDITOR_MIN_ROWS_WITH_PREVIEW = 6
/** The width asked for while a capture is being edited. */
const EDITOR_COLUMNS = 110
/** How often the notes directory is checked for edits made on the web. */
const IMPORT_EVERY_MS = 3_000
/** Where Export puts a notebook's markdown file when there is no Save dialog to ask, under the notes root. */
const EXPORTS_DIR = 'exports'
/** macOS's AppleScript runner, which shows the Save dialog; absent, there is no dialog. */
const OSASCRIPT = '/usr/bin/osascript'
/** macOS's preferences reader, which tells the Mac's appearance; absent, the engine's theme row decides. */
const DEFAULTS = '/usr/bin/defaults'
/** How long the Save dialog may stay open. */
const SAVE_DIALOG_MS = 600_000
/** How long a status line stays before it clears itself. */
const NOTICE_MS = 6_000
/** The model that chooses notebook tags and note types, and its limits. */
const TAGS_MODEL = 'haiku'
const TAGS_MAX_TOKENS = 60
const TAGS_TIMEOUT_MS = 20_000
const TYPE_MAX_TOKENS = 40
/** Room for a title line besides the type and tags. */
const TITLED_MAX_TOKENS = 90

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
const rowsAtom = atom({ plugin: 'live-notebook', key: 'rows' } as const, [] as AppendedRow[])
const queryAtom = atom({ plugin: 'live-notebook', key: 'query' } as const, '')
const searchSeedAtom = atom({ plugin: 'live-notebook', key: 'searchSeed' } as const, 0)
const typeFilterAtom = atom({ plugin: 'live-notebook', key: 'typeFilter' } as const, '')
const noticeAtom = atom({ plugin: 'live-notebook', key: 'notice' } as const, null as Notice)
const namingNotebookAtom = atom({ plugin: 'live-notebook', key: 'namingNotebook' } as const, false)
/** A saved note's `⋯` menu (Archive, Delete) is open. */
const menuOpenAtom = atom({ plugin: 'live-notebook', key: 'menuOpen' } as const, false)
/** A capture or edit page's breadcrumb title has been pressed: a field holds it until Enter. */
const titleEditingAtom = atom({ plugin: 'live-notebook', key: 'titleEditing' } as const, false)
const isLoadingAtom = atom({ plugin: 'live-notebook', key: 'isLoading' } as const, true)
const isSavingAtom = atom({ plugin: 'live-notebook', key: 'isSaving' } as const, false)
const collapsedAtom = atom({ plugin: 'live-notebook', key: 'collapsed' } as const, [] as string[])
const editorCommandAtom = atom({ plugin: 'live-notebook', key: 'editorCommand' } as const, null as { id: number; kind: string } | null)
const editorHeadingAtom = atom({ plugin: 'live-notebook', key: 'editorHeading' } as const, 'normal')
const editorScrollAtom = atom({ plugin: 'live-notebook', key: 'editorScroll' } as const, 0)
/** The preview under the capture editor starts folded away; Show preview opens it, and the choice holds for the session. */
const previewHiddenAtom = atom({ plugin: 'live-notebook', key: 'previewHidden' } as const, true)
const editorViewAtom = atom(
  { plugin: 'live-notebook', key: 'editorView' } as const,
  null as { draftId: string; top: number; total: number; height: number } | null,
)

/** The pane body's width as last drawn, for telling a wheel over the home column from one over the page. */
let paneColumns = 0
let paneIsDesktop = false
/** The first page row under the editor as last drawn, for telling a wheel over the preview from one over the editor. */
let editorEndRow = Number.POSITIVE_INFINITY

/** Whether the terminal theme (the engine's `theme` row, dark by default) is a dark one, read at session start. */
let isDarkTheme = false
/** Whether the Mac's appearance, which the desktop app follows, is dark; read at a desktop session's start, null when unknown. */
let isMacDark: boolean | null = null

/**
 * Whether the Mac's appearance is dark: `defaults` prints `Dark` for the dark
 * appearance and fails for the light one, which sets no such key. Null off
 * macOS or when the reader fails.
 */
async function readMacAppearance($: Dollar): Promise<boolean | null> {
  try {
    if (!(await $.fs.exists(DEFAULTS))) return null
    const result = await $.process.run([DEFAULTS, 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: 5_000 })
    return result.exitCode === 0 && result.stdout.trim() === 'Dark'
  } catch {
    return null
  }
}

/**
 * Whether a surface draws in a dark theme. The desktop app follows the Mac's
 * appearance; the engine's `theme` row is the terminal's own setting and says
 * nothing about the desktop.
 */
function isDarkSurface(surface: RenderSurface): boolean {
  if (surface === 'desktop' && isMacDark !== null) return isMacDark
  return isDarkTheme
}

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
  await update($, titleEditingAtom, () => false)
  await update($, menuOpenAtom, () => false)
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
  await setQueryFromOutside($, '')
  await update($, typeFilterAtom, () => '')
  await update($, namingNotebookAtom, () => false)
  const view = await read($, viewAtom)
  await setView($, { kind: 'home' })
  // Leaving the editor by the home icon keeps what was written; Resume returns to it.
  if (view.kind === 'confirm' && (await read($, draftAtom)) !== null) {
    await flashNotice($, { tone: 'ok', text: 'Draft kept', resume: true })
  } else if (view.kind === 'edit') {
    const edit = await read($, editAtom)
    const entry = edit ? (await read($, entriesAtom)).find(one => one.id === edit.entryId) : undefined
    const isUnchanged =
      edit !== null &&
      entry !== undefined &&
      entry.content === edit.content &&
      entry.title === edit.title.trim() &&
      (edit.type ?? entry.type) === entry.type &&
      (edit.folder ?? entry.folder) === entry.folder
    if (isUnchanged) {
      await update($, editAtom, () => null)
    } else if (edit) {
      await flashNotice($, { tone: 'ok', text: 'Edit kept', resume: true })
    }
  }
}

/** Back to the edit or the capture the person left by the home icon. */
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

/** A query not typed into the desktop's search editor: the editor is re-seeded with it. */
async function setQueryFromOutside($: Dollar, query: string): Promise<void> {
  await setQuery($, query)
  await update($, searchSeedAtom, seed => (seed ?? 0) + 1)
}

async function setTypeFilter($: Dollar, type: string): Promise<void> {
  await update($, typeFilterAtom, () => type)
}

async function toggleNewNotebook($: Dollar): Promise<void> {
  await update($, namingNotebookAtom, isOpen => !(isOpen ?? false))
}

/** `⋯` on a saved note's page: its menu opens or closes. Its own flag, so the home page's new-notebook field beside it leaves it alone. */
async function toggleMenu($: Dollar): Promise<void> {
  await update($, menuOpenAtom, isOpen => !(isOpen ?? false))
}

/** Opens the pane on its current view, with the `⋯` menu closed. */
async function showPane($: Dollar): Promise<void> {
  await update($, namingNotebookAtom, () => false)
  await update($, menuOpenAtom, () => false)
  await update($, titleEditingAtom, () => false)
  await $.ui.open({ id: PANE, title: TITLE, focus: true })
}

/** Opens (or widens) the pane for editing a capture before it is saved. */
async function openForEditing($: Dollar): Promise<void> {
  await update($, namingNotebookAtom, () => false)
  await update($, titleEditingAtom, () => false)
  await update($, editorHeadingAtom, () => 'normal')
  await $.ui.open({ id: PANE, title: TITLE, focus: true, columns: EDITOR_COLUMNS, rows: 30 })
}

/**
 * A toolbar press: the editor applies the command once, by its id. The id
 * only grows; a newly opened text starts past it, so nothing is replayed.
 */
async function formatEditor($: Dollar, kind: string): Promise<void> {
  await update($, editorCommandAtom, current => ({ id: (current?.id ?? 0) + 1, kind }))
}

/** Show preview or Hide preview, at the end of the editor pages' formatting row; hidden to start, and the choice holds for the session. */
async function togglePreview($: Dollar): Promise<void> {
  await update($, previewHiddenAtom, isHidden => !(isHidden ?? false))
}

/** The breadcrumb's title pressed on a capture or edit page: a one-row editor takes its place, and the keys go to it. */
async function beginTitleEdit($: Dollar): Promise<void> {
  await update($, titleEditingAtom, () => true)
  // Best effort: a surface that cannot move the focus leaves the person to click into the row.
  try {
    await $.ui.focus({ requestId: PANE, key: TITLE_EDITOR_KEY })
  } catch {
    // nothing to do
  }
}

/** Enter in that field: the title shows in the breadcrumb again. */
async function endTitleEdit($: Dollar): Promise<void> {
  await update($, titleEditingAtom, () => false)
}

async function setEditTitle($: Dollar, title: string): Promise<void> {
  await update($, editAtom, edit => (edit ? { ...edit, title } : null))
}

/** The edit page's type picker changed; the type is saved with the edit. */
async function setEditType($: Dollar, type: EntryType): Promise<void> {
  await update($, editAtom, edit => (edit ? { ...edit, type } : null))
}

/** The edit page's notebook picker changed; the note moves when the edit is saved. */
async function setEditFolder($: Dollar, folder: string): Promise<void> {
  await update($, editAtom, edit => (edit ? { ...edit, folder } : null))
}

/** What the editor's ⌘C or ⌘X puts on the clipboard; only a failure is said. */
async function copyText($: Dollar, text: string, surface: RenderSurface): Promise<void> {
  const result = await $.ui.copy({ text, surface })
  if (!result.isCopied) await flashNotice($, { tone: 'error', text: 'Nothing to copy to here' })
}

/**
 * The Save dialog for an export, on macOS: the path chosen, or undefined
 * when it was cancelled. The dialog belongs to the app in front (the desktop
 * app or the terminal), so it shows over it. Without `osascript` (another
 * OS) there is no dialog: the file goes to `fallback`.
 */
async function chooseSavePath($: Dollar, prompt: string, name: string, fallback: string): Promise<string | undefined> {
  if (!(await $.fs.exists(OSASCRIPT))) return fallback
  const script = `tell application (path to frontmost application as text) to POSIX path of (choose file name with prompt ${JSON.stringify(prompt)} default name ${JSON.stringify(name)} default location (path to downloads folder))`
  const result = await $.process.run([OSASCRIPT, '-e', script], { timeoutMs: SAVE_DIALOG_MS })
  const path = result.stdout.trim()
  return result.exitCode === 0 && path !== '' ? path : undefined
}

/**
 * Export, on a notebook's header row: its notes as one file, the same the
 * web notebook's Export downloads, saved where the Save dialog is pointed.
 * The dialog proposes `<notebook>.md`; a name ending in `.txt` saves plain
 * text instead, and one without an extension gets `.md`. The notice names
 * the path and offers to copy it.
 */
async function exportNotebook($: Dollar, folder: string): Promise<void> {
  try {
    const [entries, tags, root, now] = await Promise.all([read($, entriesAtom), read($, tagsAtom), notesRootOf($), $.clock.now()])
    const notes = activeIn(entries, folder).map(entry => ({
      title: entry.title,
      type: entry.type,
      created: new Date(entry.createdAt).toISOString(),
      fromMessage: entry.sources[0]?.captureMode === 'whole_message',
      content: entry.content,
    }))
    const name = `${slugOf(folder)}.md`
    const chosen = await chooseSavePath($, `Export ${folder} as markdown (.md) or plain text (.txt)`, name, `${root}/${EXPORTS_DIR}/${name}`)
    if (chosen === undefined) return
    const path = /\.[^./]+$/.test(chosen) ? chosen : `${chosen}.md`
    const text = EXPORT_FORMATS[formatOf(path)].render({ name: folder, tags: tags[folder]?.tags ?? [], notes }, new Date(now).toISOString().slice(0, 10))
    await $.fs.write(path, text)
    await setNotice($, { tone: 'ok', text: `Exported ${folder} to ${path}`, copy: path })
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

async function toggleNotebook($: Dollar, folder: string): Promise<void> {
  await update($, collapsedAtom, list =>
    (list ?? []).includes(folder) ? (list ?? []).filter(one => one !== folder) : [...(list ?? []), folder],
  )
}

/** A note saved from the chat (it keeps the session it came from), not one written on the web. */
function isFromChat(entry: NotebookEntry): boolean {
  const source = entry.sources[0]
  return source !== undefined && source.sessionId !== undefined && source.snapshot !== ''
}

/** Whether the title is still the one taken from the first line, so a model's may replace it. */
function hasDerivedTitle(entry: NotebookEntry): boolean {
  return entry.title === deriveTitle(entry.content)
}

/**
 * Asks the model for the note's type (insight, learning, ...) and tags and,
 * with `withTitle`, a title of at most six words; the person can change any
 * of them later. A title the person set is never replaced.
 */
async function classifyEntry($: Dollar, entryId: string, options: { withTitle?: boolean } = {}): Promise<void> {
  const service = serviceOf($)
  const entry = await service.getById(entryId)
  const withTitle = options.withTitle === true && entry !== undefined && hasDerivedTitle(entry)
  if (!entry || (entry.type !== 'other' && !withTitle) || entry.content.trim() === '') return
  const result = await $.model.complete({
    model: TAGS_MODEL,
    prompt: classifyPrompt(entry.title, entry.content, { withTitle }),
    maxTokens: withTitle ? TITLED_MAX_TOKENS : TYPE_MAX_TOKENS,
    timeoutMs: TAGS_TIMEOUT_MS,
  })
  if (!result.isAnswered) return
  const { type, tags, title } = parseClassification(result.text)
  const current = await service.getById(entryId)
  if (!current) return
  const patch: { type?: EntryType; tags?: string[]; title?: string } = {}
  if (type !== undefined && type !== 'other' && current.type === 'other') patch.type = type
  if (tags.length > 0 && current.tags.length === 0) patch.tags = tags
  if (withTitle && title !== undefined && hasDerivedTitle(current)) patch.title = title
  if (patch.type === undefined && patch.tags === undefined && patch.title === undefined) return
  const updated = await service.update(entryId, patch)
  try {
    await writeNoteFile($, updated)
  } catch {
    /* the file keeps its old front matter; the next export writes it */
  }
  await refreshEntries($)
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
  const path = `${dir}/${folder}/${NOTEBOOK_META_FILE}`
  // The web's own keys (a pinned or archived notebook) stay.
  const existing = await readNotebookMeta($, path)
  await $.fs.write(
    path,
    JSON.stringify({ ...existing, name: folder, tags: tags?.tags ?? [], generatedAt: tags?.generatedAt ?? null }, null, 2),
  )
}

/** A notebook's meta file as an object; `{}` when there is none or it does not parse. */
async function readNotebookMeta($: Dollar, path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(path))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
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
    let inner
    try {
      inner = await $.fs.list(`${dir}/${entry.name}`)
    } catch {
      dirs.push(entry.name)
      continue
    }
    // A notebook archived on the web is no notebook of the pane's: its directory is left out, so the folder goes;
    // its files, every one marked archived, still archive their entries.
    const hasMeta = inner.some(file => file.kind === 'file' && file.name === NOTEBOOK_META_FILE)
    const isArchived = hasMeta && (await readNotebookMeta($, `${dir}/${entry.name}/${NOTEBOOK_META_FILE}`)).archived === true
    if (!isArchived) dirs.push(entry.name)
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
  // Notes written on the web have no type until a model gives them one, as a save in the pane does.
  const toClassify: string[] = []
  for (const action of actions) {
    try {
      if (action.kind === 'folder') await service.ensureFolder(action.name)
      else if (action.kind === 'folder-gone') await service.removeFolder(action.name)
      else if (action.kind === 'archive') await service.archive(action.entryId)
      else if (action.kind === 'update') {
        const patch: { content?: string; title?: string; file?: string; folder?: string; type?: EntryType; pinned?: boolean } = {}
        if (action.content !== undefined) patch.content = action.content
        if (action.title !== undefined) patch.title = action.title
        if (action.file !== undefined) patch.file = action.file
        if (action.folder !== undefined) patch.folder = action.folder
        if (action.type !== undefined) patch.type = action.type
        if (action.pinned !== undefined) patch.pinned = action.pinned
        const updated = await service.update(action.entryId, patch)
        if (updated.type === 'other' && action.content !== undefined) toClassify.push(updated.id)
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
        if (action.pinned !== undefined) input.pinned = action.pinned
        const created = await service.create(input)
        toClassify.push(created.id)
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
  for (const id of toClassify) $.clock.after(1, () => void classifyEntry($, id))
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

/** Opens the web notebook in the browser, at a note's file when one is named. */
async function openWeb($: Dollar, file?: string): Promise<void> {
  try {
    const info = await startServer($)
    const url = file === undefined ? info.url : `${info.url}/#/${encodeURIComponent(file)}`
    const opened = await $.process.run(['open', url], { timeoutMs: 10_000 })
    if (opened.exitCode !== 0) await $.process.run(['xdg-open', url], { timeoutMs: 10_000 })
    await update($, noticeAtom, current => (current?.tone === 'error' ? null : current ?? null))
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

/** Edit: the note opens in the web notebook, its file written first if it has none yet. */
async function editInWeb($: Dollar, entryId: string): Promise<void> {
  const entry = (await read($, entriesAtom)).find(one => one.id === entryId)
  if (!entry) return
  try {
    const dir = await notesDirOf($)
    const current = entry.file !== undefined && (await $.fs.exists(`${dir}/${entry.file}`)) ? entry : await writeNoteFile($, entry)
    await openWeb($, current.file)
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

/** + Add New Note: an empty note in the last-used notebook, opened in the web notebook to write. */
async function newNoteInWeb($: Dollar): Promise<void> {
  try {
    const [dir, folders, now] = await Promise.all([notesDirOf($), read($, foldersAtom), $.clock.now()])
    const blank = blankNoteFile(crypto.randomUUID(), folders.last, now)
    await $.fs.write(`${dir}/${blank.path}`, blank.text)
    await openWeb($, blank.path)
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

async function setDraftTitle($: Dollar, title: string): Promise<void> {
  await update($, draftAtom, draft => (draft ? { ...draft, title } : null))
}

/** The capture page's type picker changed; undefined (the picker on Other) leaves the type to the model. */
async function setDraftType($: Dollar, type: EntryType | undefined): Promise<void> {
  await update($, draftAtom, draft => {
    if (!draft) return null
    const { type: _dropped, ...rest } = draft
    return type === undefined ? rest : { ...rest, type }
  })
}

/** Creates (or finds) a notebook and selects it for the capture, if one is open. */
async function addFolder($: Dollar, name: string): Promise<void> {
  try {
    const record = await serviceOf($).addFolder(name)
    await update($, foldersAtom, () => record)
    await update($, draftAtom, draft => (draft ? { ...draft, folder: record.last } : null))
    await update($, namingNotebookAtom, () => false)
    // A failed add's error goes; a kept draft's Resume stays, the new notebook now picked for it.
    if ((await read($, noticeAtom))?.tone === 'error') await setNotice($, null)
    await refreshTags($)
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

/**
 * What the editor posted, for the capture or the edit whose id it names: its
 * text, the heading under its cursor and its window, each kept only when it
 * changed (the window redraws nothing), and text for the clipboard.
 */
async function acceptEditorPost($: Dollar, post: EditorPost, surface: RenderSurface): Promise<void> {
  const [draft, edit, heading] = await Promise.all([read($, draftAtom), read($, editAtom), read($, editorHeadingAtom)])
  if (draft?.id !== post.draftId && edit?.id !== post.draftId) return
  if (post.clipboard !== undefined) await copyText($, post.clipboard, surface)
  const { cursor, ...shown } = post.view
  await update($, editorViewAtom, () => ({ draftId: post.draftId, ...shown }))
  const editing = draft?.id === post.draftId ? draft : edit
  // A desktop's editor draws the whole text in the pane (`fit`): typing on a text's last row, past the
  // rows the page holds, keeps that row in view by scrolling the pane to its end, the dates under it.
  if (cursor !== undefined && editing?.content !== post.text && cursor >= shown.total - 1 && shown.total >= shown.height && (await read($, previewHiddenAtom))) {
    // Only a convenience: a surface that cannot scroll there leaves the text's own update to go on.
    await $.ui.scroll({ to: 'end', in: PANE }).catch(() => undefined)
  }
  if (draft?.id === post.draftId && draft.content !== post.text) {
    await update($, draftAtom, current => (current && current.id === post.draftId ? { ...current, content: post.text } : current ?? null))
  }
  if (edit?.id === post.draftId && edit.content !== post.text) {
    await update($, editAtom, current => (current && current.id === post.draftId ? { ...current, content: post.text } : current ?? null))
  }
  if (heading !== post.heading) await update($, editorHeadingAtom, () => post.heading)
}

/**
 * A wheel tick on the editor page scrolls the text while it has more to
 * show that way; it is handed on to the pane past the text's ends, over the
 * home column beside the page, over the preview under the editor, and while
 * the `⋯` menu is open. `row` is the page row under the pointer.
 *
 * @returns true when the editor took the tick
 */
async function wheelEditor($: Dollar, by: number, column: number, row: number): Promise<boolean> {
  const [view, isMenuOpen, draft, edit, shown] = await Promise.all([
    read($, viewAtom),
    read($, namingNotebookAtom),
    read($, draftAtom),
    read($, editAtom),
    read($, editorViewAtom),
  ])
  const editing = view.kind === 'confirm' ? draft : view.kind === 'edit' ? edit : null
  if (editing === null || isMenuOpen || !isOverPage(column, paneColumns, paneIsDesktop) || row >= editorEndRow) return false
  if (shown === null || shown.draftId !== editing.id || !canScroll(shown, by)) return false
  // Moved here at once, so ticks that come before the editor reports stop at the text's end.
  const top = Math.max(0, Math.min(shown.top + by, shown.total - shown.height))
  await update($, editorViewAtom, () => ({ ...shown, top }))
  await update($, editorScrollAtom, total => (total ?? 0) + by)
  return true
}

/**
 * The title editor's post: the title as typed so far, and `submit` on Enter,
 * which puts the title back in the breadcrumb.
 */
async function acceptTitlePost($: Dollar, post: EditorPost, surface: RenderSurface): Promise<void> {
  const [view, draft, edit] = await Promise.all([read($, viewAtom), read($, draftAtom), read($, editAtom)])
  const editing = view.kind === 'confirm' ? draft : view.kind === 'edit' ? edit : null
  if (editing === null || post.draftId !== titleDraftId(editing.id)) return
  if (post.clipboard !== undefined) await copyText($, post.clipboard, surface)
  const title = post.text.replace(/\s*\n\s*/g, ' ')
  if (view.kind === 'confirm' && (draft?.title ?? '') !== title) await setDraftTitle($, title)
  if (view.kind === 'edit' && edit?.title !== title) await setEditTitle($, title)
  if (post.submit === true) await endTitleEdit($)
}

/** The title editor's own draft id, so a note's title and its text never share an editor state. */
function titleDraftId(editingId: string): string {
  return `title:${editingId}`
}

/** The desktop's search editor posts the query as it is typed; Enter adds nothing, the list filters as it goes. */
async function acceptSearchPost($: Dollar, post: EditorPost, surface: RenderSurface): Promise<void> {
  if (post.draftId !== searchDraftId(await read($, searchSeedAtom))) return
  if (post.clipboard !== undefined) await copyText($, post.clipboard, surface)
  const query = post.text.replace(/\s*\n\s*/g, ' ')
  if ((await read($, queryAtom)) !== query) await setQuery($, query)
}

/** The search editor's draft id: a new one whenever the query was set from outside it, so it takes that text. */
function searchDraftId(seed: number): string {
  return `search:${seed}`
}

function isEditorPost(data: unknown): data is EditorPost {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  const view = record.view as Record<string, unknown> | null | undefined
  return (
    typeof record.draftId === 'string' &&
    typeof record.text === 'string' &&
    typeof record.heading === 'string' &&
    (record.clipboard === undefined || typeof record.clipboard === 'string') &&
    (record.submit === undefined || record.submit === true) &&
    typeof view === 'object' &&
    view !== null &&
    typeof view.top === 'number' &&
    typeof view.total === 'number' &&
    typeof view.height === 'number'
  )
}

async function cancelDraft($: Dollar): Promise<void> {
  await update($, draftAtom, () => null)
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
    // A title the person typed is theirs, and the model's title does not replace it.
    const title = (draft.title ?? '').trim()
    // A type the person picked is kept too: the model types only a note saved without one.
    const entry = await serviceOf($).create({
      content: draft.content,
      folder: draft.folder,
      source: draft.source,
      ...(title === '' ? {} : { title }),
      ...(draft.type === undefined ? {} : { type: draft.type }),
    })
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
    $.clock.after(1, () => void classifyEntry($, entry.id, { withTitle: true }))
  } catch (error) {
    await setNotice($, {
      tone: 'error',
      text: `${messageOf(error)} Your draft is still here; press Save to retry.`,
    })
  } finally {
    await update($, isSavingAtom, () => false)
  }
}

/** Opens a note's page in the pane. */
async function openNote($: Dollar, entryId: string): Promise<void> {
  if (!(await read($, entriesAtom)).some(one => one.id === entryId)) return
  await setNotice($, null)
  await setView($, { kind: 'note', entryId })
  await showPane($)
}

/** Edit: the note in the pane's editor; a kept edit of the same note is resumed. */
async function startEdit($: Dollar, entryId: string): Promise<void> {
  const entry = (await read($, entriesAtom)).find(one => one.id === entryId)
  if (!entry) return
  const kept = await read($, editAtom)
  if (kept?.entryId !== entryId) {
    await update($, editAtom, () => ({ id: crypto.randomUUID(), entryId, content: entry.content, title: entry.title, type: entry.type, folder: entry.folder }))
  }
  await setNotice($, null)
  await setView($, { kind: 'edit', entryId })
  await openForEditing($)
}

/** Saves the pane edit to the note and its file, then shows the note again. */
async function saveEdit($: Dollar): Promise<void> {
  const edit = await read($, editAtom)
  if (!edit) {
    await showHome($)
    return
  }
  const saved = (await read($, entriesAtom)).find(one => one.id === edit.entryId)
  // A cleared title goes back to the text's first line; an unchanged one stays derived or the person's own.
  const title = edit.title.trim() === '' ? deriveTitle(edit.content) : edit.title.trim()
  const folder = edit.folder !== undefined && edit.folder !== saved?.folder ? edit.folder : undefined
  await update($, isSavingAtom, () => true)
  try {
    const patch = {
      content: edit.content,
      ...(title !== '' && title !== saved?.title ? { title } : {}),
      ...(edit.type !== undefined && edit.type !== saved?.type ? { type: edit.type } : {}),
      ...(folder !== undefined ? { folder } : {}),
    }
    const updated = await serviceOf($).update(edit.entryId, patch)
    // A note moved to another notebook gets its file there, and the one it had goes.
    const entry = folder !== undefined ? await serviceOf($).setFile(updated.id, relPathFor(updated)) : updated
    let fileNote: Notice = null
    try {
      await writeNoteFile($, entry)
      if (saved?.file !== undefined && saved.file !== entry.file) await forgetNoteFile($, saved.file)
    } catch (error) {
      fileNote = { tone: 'error', text: `Saved, but the file was not written: ${messageOf(error)}` }
    }
    await afterChange($)
    await update($, editAtom, () => null)
    await setNotice($, fileNote)
    await setView($, { kind: 'note', entryId: entry.id })
    await showPane($)
    if (entry.type === 'other') $.clock.after(1, () => void classifyEntry($, entry.id))
  } catch (error) {
    await setNotice($, { tone: 'error', text: `${messageOf(error)} Your changes are still here.` })
  } finally {
    await update($, isSavingAtom, () => false)
  }
}

/** Drops the pane edit and shows the note as saved. */
async function cancelEdit($: Dollar): Promise<void> {
  const edit = await read($, editAtom)
  await update($, editAtom, () => null)
  await setNotice($, null)
  if (edit) await setView($, { kind: 'note', entryId: edit.entryId })
  else await setView($, { kind: 'home' })
  await showPane($)
}

async function armDelete($: Dollar, entryId: string, isDeleteArmed: boolean): Promise<void> {
  await setView($, { kind: 'note', entryId, isDeleteArmed })
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
    await update($, editAtom, edit => (edit?.entryId === entryId ? null : edit ?? null))
    await setNotice($, null)
    await setView($, { kind: 'home' })
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

/** Removes a note's file and forgets its mtime; a file that will not go stays, and the next import archives nothing for it since the entry has moved on. */
async function forgetNoteFile($: Dollar, file: string): Promise<void> {
  const abs = `${await notesDirOf($)}/${file}`
  try {
    await $.process.run(['rm', '-f', abs], { timeoutMs: 5_000 })
  } catch {
    /* the file stays */
  }
  await update($, knownAtom, known => {
    const next = { ...(known ?? {}) }
    delete next[file]
    return next
  })
}

async function deleteEntry($: Dollar, entryId: string): Promise<void> {
  try {
    const service = serviceOf($)
    const entry = await service.getById(entryId)
    await service.delete(entryId)
    if (entry?.file !== undefined) await forgetNoteFile($, entry.file)
    await afterChange($)
    await update($, editAtom, edit => (edit?.entryId === entryId ? null : edit ?? null))
    await setNotice($, null)
    await setView($, { kind: 'home' })
  } catch (error) {
    await setNotice($, { tone: 'error', text: messageOf(error) })
  }
}

function actionsOf($: Dollar): PaneActions {
  return {
    search: query => void setQueryFromOutside($, query),
    filterType: type => void setTypeFilter($, type),
    toggleNewNotebook: () => void toggleNewNotebook($),
    toggleMenu: () => void toggleMenu($),
    toggleNotebook: folder => void toggleNotebook($, folder),
    exportNotebook: folder => void exportNotebook($, folder),
    dismissNotice: () => void setNotice($, null),
    copy: (text, surface) => void copyText($, text, surface),
    home: () => void showHome($),
    newNote: () => void newNoteInWeb($),
    setDraftFolder: folder => void setDraftFolder($, folder),
    setDraftTitle: title => void setDraftTitle($, title),
    beginTitleEdit: () => void beginTitleEdit($),
    endTitleEdit: () => void endTitleEdit($),
    setDraftType: type => void setDraftType($, type),
    addFolder: name => void addFolder($, name),
    format: kind => void formatEditor($, kind),
    save: () => void confirmSave($),
    cancel: () => void cancelDraft($),
    resume: () => void resumeEditing($),
    open: entryId => void openNote($, entryId),
    edit: entryId => void startEdit($, entryId),
    openInWeb: entryId => void editInWeb($, entryId),
    saveEdit: () => void saveEdit($),
    setEditTitle: title => void setEditTitle($, title),
    setEditType: type => void setEditType($, type),
    setEditFolder: folder => void setEditFolder($, folder),
    togglePreview: () => void togglePreview($),
    cancelEdit: () => void cancelEdit($),
    archive: entryId => void archiveEntry($, entryId),
    armDelete: (entryId, isArmed) => void armDelete($, entryId, isArmed),
    remove: entryId => void deleteEntry($, entryId),
  }
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
    // Notes saved from the chat before titles came from the model get one, once.
    const untitled = (await read($, entriesAtom)).filter(one => one.status === 'confirmed' && isFromChat(one) && hasDerivedTitle(one))
    if (untitled.length > 0) {
      $.clock.after(1, () => void (async () => {
        for (const one of untitled) await classifyEntry($, one.id, { withTitle: true })
      })())
    }
    try {
      const theme = (await $.config.list()).find(row => row.key === 'theme')
      isDarkTheme = typeof theme?.value === 'string' && theme.value.startsWith('dark')
    } catch {
      /* light, the default */
    }
    // The desktop app starts the engine through the SDK, which reports no surface yet; only the REPL says terminal.
    if (e.surface !== 'terminal') isMacDark = await readMacAppearance($)
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
        // Nothing to save: no pane, a hint. A whole reply is saved with the control under it.
        return { text: 'Select text in the conversation, or type /save followed by the text to save. A whole reply is saved with the Save to notebook control under it.' }
      }
    }
    if ((await read($, viewAtom)).kind === 'confirm') await openForEditing($)
    else await showPane($)
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
    await update($, searchSeedAtom, seed => (seed ?? 0) + 1)
    await setView($, { kind: 'home' })
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: args === '' ? 'Live Notebook opened.' : `Live Notebook opened, searching for "${args}".` }
  })

  // The capture editor posts its text, the heading under its cursor and its
  // window after every change, and what a copy or cut puts on the clipboard.
  on('ui.message', { element: EDITOR_KEY }, async ($, e, next) => {
    if (isEditorPost(e.data)) await acceptEditorPost($, e.data, e.surface)
    return next(e)
  })

  // The breadcrumb's title, while it is being edited, posts the same way.
  on('ui.message', { element: TITLE_EDITOR_KEY }, async ($, e, next) => {
    if (isEditorPost(e.data)) await acceptTitlePost($, e.data, e.surface)
    return next(e)
  })

  // So does the desktop's search field.
  on('ui.message', { element: SEARCH_EDITOR_KEY }, async ($, e, next) => {
    if (isEditorPost(e.data)) await acceptSearchPost($, e.data, e.surface)
    return next(e)
  })

  // The wheel over the capture page scrolls its text, which the editor draws
  // in a window of its own; the pane keeps still while it does.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || e.pointer === undefined || e.by === 0) return next(e)
    // The page row under the pointer: the window's first row as it is now, plus the pointer's row in it.
    const row = Math.max(0, e.offset - e.by) + e.pointer.row
    return (await wheelEditor($, e.by, e.pointer.column, row)) ? {} : next(e)
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
    const [view, entries, draft, edit, folders, server, query, notice] = await Promise.all([
      read($, viewAtom),
      read($, entriesAtom),
      read($, draftAtom),
      read($, editAtom),
      read($, foldersAtom),
      read($, serverAtom),
      read($, queryAtom),
      read($, noticeAtom),
    ])
    const [typeFilter, isNamingNotebook, isMenuOpen, isEditingTitle, isLoading, isSaving, notesRoot, collapsed] = await Promise.all([
      read($, typeFilterAtom),
      read($, namingNotebookAtom),
      read($, menuOpenAtom),
      read($, titleEditingAtom),
      read($, isLoadingAtom),
      read($, isSavingAtom),
      read($, notesRootAtom),
      read($, collapsedAtom),
    ])
    const [editorCommand, editorHeading, editorScroll, previewHidden] = await Promise.all([
      read($, editorCommandAtom),
      read($, editorHeadingAtom),
      read($, editorScrollAtom),
      read($, previewHiddenAtom),
    ])
    paneColumns = e.props.bodyColumns
    paneIsDesktop = e.surface === 'desktop'
    const bodyRows = e.props.scroll?.bodyRows ?? 0
    if (e.surface === 'mobile') return renderReadOnlyPane($.ui.resolve(e), entries)

    // A capture before it is saved, or a saved note after Edit, is edited in
    // the pane; the editor is a Client, whose module path must be a literal here.
    let editor: RenderElement | undefined
    let titleEditor: RenderElement | undefined
    const editing = view.kind === 'confirm' ? draft : view.kind === 'edit' ? edit : null
    editorEndRow = Number.POSITIVE_INFINITY
    if (editing && e.surface !== 'vscode') {
      const { Client } = $.ui.resolve(e)
      // The editor fills the page's rows; with the preview showing, it takes half of them and the preview the rest.
      const free = bodyRows - EDITOR_CHROME_ROWS - TITLE_FIELD_ROWS
      const rows = previewHidden
        ? Math.max(EDITOR_MIN_ROWS, free)
        : Math.max(EDITOR_MIN_ROWS_WITH_PREVIEW, Math.floor((free - PREVIEW_CHROME_ROWS) / 2))
      if (!previewHidden) editorEndRow = EDITOR_TOP_ROWS + TITLE_FIELD_ROWS + rows
      const props: EditorProps = {
        draftId: editing.id,
        text: editing.content,
        command: editorCommand,
        columns: editorColumns(e.props.bodyColumns, e.surface === 'desktop'),
        rows,
        scroll: editorScroll,
        // A desktop draws the whole text and scrolls it with the pane: its wheel only reaches a pane taller than its window.
        ...(e.surface === 'desktop' ? { fit: true as const } : {}),
      }
      // No height: the region is as tall as the rows the editor draws (`rows`, or the whole text under `fit`).
      editor = <Client key={EDITOR_KEY} module="./ui/editor.ts" props={props} width="100%" />
      if (isEditingTitle) {
        // The breadcrumb's title, pressed: a one-row editor over the title typed so far; empty, it shows the title
        // the note has now (its own, or the one derived from its text) as a placeholder.
        const entry = view.kind === 'edit' ? entries.find(one => one.id === editing.id) : undefined
        const typed = view.kind === 'confirm' ? draft?.title ?? '' : edit?.title ?? ''
        const shown = typed.trim() !== '' ? typed : entry?.title ?? (editing.content.trim() === '' ? 'Untitled' : deriveTitle(editing.content))
        const titleProps: EditorProps = {
          draftId: titleDraftId(editing.id),
          text: typed,
          placeholder: shown,
          columns: Math.max(10, editorColumns(e.props.bodyColumns, e.surface === 'desktop') - (editing.folder ?? entry?.folder ?? "").length - 6),
          rows: 1,
          singleLine: true,
        }
        titleEditor = <Client key={TITLE_EDITOR_KEY} module="./ui/editor.ts" props={titleProps} width="100%" />
      }
    }

    // On a desktop the search field is the mod's own one-row editor: the surface's Input would draw an Enter
    // button beside it that a mod can only name, not drop.
    let searchEditor: RenderElement | undefined
    if (e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      const searchProps: EditorProps = {
        draftId: searchDraftId(await read($, searchSeedAtom)),
        text: query,
        placeholder: 'Search notes…',
        columns: Math.max(10, e.props.bodyColumns - 6),
        rows: 1,
        singleLine: true,
      }
      searchEditor = <Client key={SEARCH_EDITOR_KEY} module="./ui/editor.ts" props={searchProps} width="100%" />
    }

    try {
      return renderNotebookPane(
        $.ui.resolve(e),
        {
          surface: e.surface,
          view,
          entries,
          draft,
          edit,
          folders,
          server,
          query,
          typeFilter,
          notice,
          isNamingNotebook,
          isMenuOpen,
          isEditingTitle,
          isLoading,
          isSaving,
          collapsed,
          notesRoot,
          width: e.props.bodyColumns,
          rows: bodyRows,
          hoverColor: isDarkSurface(e.surface) ? HOVER_DARK : HOVER_LIGHT,
          isDark: isDarkSurface(e.surface),
          editorHeading,
          isPreviewShown: !previewHidden,
          ...(editor === undefined ? {} : { editor }),
          ...(titleEditor === undefined ? {} : { titleEditor }),
          ...(searchEditor === undefined ? {} : { searchEditor }),
        },
        actionsOf($),
      )
    } catch (error) {
      // A drawing that throws would leave the pane blank; say what went wrong instead.
      const { Box, Text, Button } = $.ui.resolve(e)
      $.ui.log(`Live Notebook could not draw its pane: ${messageOf(error)}`, { to: 'debug' })
      return (
        <Box flexDirection="column">
          <Text color="error">{`Live Notebook could not draw this view: ${messageOf(error)}`}</Text>
          <Box marginTop={1}>
            <Button key="render-error-home" onPress={() => void showHome($)}>
              Back to notes
            </Button>
          </Box>
        </Box>
      )
    }
  })
}
