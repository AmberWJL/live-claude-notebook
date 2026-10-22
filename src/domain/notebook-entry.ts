import type {
  CaptureContext,
  CaptureMode,
  ContextMessage,
  EntryStatus,
  EntryType,
  FoldersRecord,
  NotebookEntry,
  SourceReference,
  SourceRole,
} from '../../types'

export const SCHEMA_VERSION = 1 as const

/** The folder every notebook starts with and entries fall back to. */
export const DEFAULT_FOLDER = 'General'
export const MAX_FOLDER_CHARS = 40

export const ENTRY_TYPES: readonly EntryType[] = [
  'insight',
  'learning',
  'idea',
  'decision',
  'reference',
  'other',
]

const CAPTURE_MODES: readonly CaptureMode[] = ['whole_message', 'excerpt']
const SOURCE_ROLES: readonly SourceRole[] = ['user', 'assistant', 'tool', 'unknown']
const STATUSES: readonly EntryStatus[] = ['confirmed', 'archived']

export type CreateNotebookEntryInput = {
  /** A known id (an entry imported from a file that already names one). */
  id?: string
  title?: string
  content: string
  folder?: string
  type?: EntryType
  tags?: string[]
  source: SourceReference
  file?: string
  createdAt?: number
  /** True for an entry imported from a file: it does not become the last-used folder. */
  keepLastFolder?: true
}

export type UpdateNotebookEntryInput = {
  title?: string
  content?: string
  folder?: string
  type?: EntryType
  tags?: string[]
  file?: string
}

export type ListNotebookEntriesOptions = {
  includeArchived?: boolean
  folder?: string
}

export function isEntryType(value: unknown): value is EntryType {
  return typeof value === 'string' && (ENTRY_TYPES as readonly string[]).includes(value)
}

/** A folder name as stored: trimmed, bounded; undefined when unusable. */
export function normalizeFolderName(raw: string): string | undefined {
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name === '' || name.length > MAX_FOLDER_CHARS) return undefined
  return name
}

export function defaultFolders(): FoldersRecord {
  return { names: [DEFAULT_FOLDER], last: DEFAULT_FOLDER }
}

type Validation<T> = { ok: true; value: T } | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateContextMessages(value: unknown, field: string): Validation<ContextMessage[]> {
  if (!Array.isArray(value)) return { ok: false, reason: `context.${field} is not an array` }
  const messages: ContextMessage[] = []
  for (const item of value) {
    if (!isRecord(item) || (item.role !== 'user' && item.role !== 'assistant') || typeof item.text !== 'string') {
      return { ok: false, reason: `context.${field} holds a malformed message` }
    }
    messages.push({ role: item.role, text: item.text })
  }
  return { ok: true, value: messages }
}

function validateContext(value: unknown): Validation<CaptureContext> {
  if (!isRecord(value)) return { ok: false, reason: 'source.context is not an object' }
  const before = validateContextMessages(value.before, 'before')
  if (!before.ok) return before
  const after = validateContextMessages(value.after, 'after')
  if (!after.ok) return after
  if (value.cwd !== undefined && typeof value.cwd !== 'string') return { ok: false, reason: 'context.cwd is not a string' }
  const context: CaptureContext = { before: before.value, after: after.value }
  if (typeof value.cwd === 'string') context.cwd = value.cwd
  return { ok: true, value: context }
}

function validateSource(value: unknown): Validation<SourceReference> {
  if (!isRecord(value)) return { ok: false, reason: 'source is not an object' }
  if (!(CAPTURE_MODES as readonly unknown[]).includes(value.captureMode)) {
    return { ok: false, reason: 'source.captureMode is not a capture mode' }
  }
  if (typeof value.snapshot !== 'string') return { ok: false, reason: 'source.snapshot is not a string' }
  if (!isFiniteNumber(value.capturedAt)) return { ok: false, reason: 'source.capturedAt is not a number' }
  for (const key of ['sessionId', 'messageId'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      return { ok: false, reason: `source.${key} is not a string` }
    }
  }
  if (value.role !== undefined && !(SOURCE_ROLES as readonly unknown[]).includes(value.role)) {
    return { ok: false, reason: 'source.role is not a role' }
  }
  for (const key of ['startOffset', 'endOffset'] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) {
      return { ok: false, reason: `source.${key} is not a number` }
    }
  }
  const source: SourceReference = {
    captureMode: value.captureMode as CaptureMode,
    snapshot: value.snapshot,
    capturedAt: value.capturedAt,
  }
  if (typeof value.sessionId === 'string') source.sessionId = value.sessionId
  if (typeof value.messageId === 'string') source.messageId = value.messageId
  if (value.role !== undefined) source.role = value.role as SourceRole
  if (isFiniteNumber(value.startOffset)) source.startOffset = value.startOffset
  if (isFiniteNumber(value.endOffset)) source.endOffset = value.endOffset
  if (value.context !== undefined) {
    const context = validateContext(value.context)
    if (!context.ok) return context
    source.context = context.value
  }
  return { ok: true, value: source }
}

/**
 * Checks a stored value against the schema before it is rendered or edited.
 * Unknown fields are dropped; a wrong or missing required field rejects. A
 * missing `folder` (an entry saved before folders existed) reads as the
 * default folder.
 */
export function validateEntry(value: unknown): Validation<NotebookEntry> {
  if (!isRecord(value)) return { ok: false, reason: 'entry is not an object' }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: `schemaVersion ${String(value.schemaVersion)} is not ${SCHEMA_VERSION}` }
  }
  if (typeof value.id !== 'string' || value.id === '') return { ok: false, reason: 'id is not a string' }
  if (typeof value.title !== 'string') return { ok: false, reason: 'title is not a string' }
  if (typeof value.content !== 'string') return { ok: false, reason: 'content is not a string' }
  if (value.folder !== undefined && typeof value.folder !== 'string') return { ok: false, reason: 'folder is not a string' }
  if (value.file !== undefined && typeof value.file !== 'string') return { ok: false, reason: 'file is not a string' }
  if (!isEntryType(value.type)) return { ok: false, reason: 'type is not an entry type' }
  if (!isStringArray(value.tags)) return { ok: false, reason: 'tags is not a string array' }
  if (!(STATUSES as readonly unknown[]).includes(value.status)) return { ok: false, reason: 'status is not a status' }
  if (!isFiniteNumber(value.createdAt)) return { ok: false, reason: 'createdAt is not a number' }
  if (!isFiniteNumber(value.updatedAt)) return { ok: false, reason: 'updatedAt is not a number' }
  if (!Array.isArray(value.sources)) return { ok: false, reason: 'sources is not an array' }
  const sources: SourceReference[] = []
  for (const raw of value.sources) {
    const checked = validateSource(raw)
    if (!checked.ok) return checked
    sources.push(checked.value)
  }
  const folder = typeof value.folder === 'string' ? normalizeFolderName(value.folder) : undefined
  const entry: NotebookEntry = {
    schemaVersion: SCHEMA_VERSION,
    id: value.id,
    title: value.title,
    content: value.content,
    folder: folder ?? DEFAULT_FOLDER,
    type: value.type,
    tags: value.tags,
    sources,
    status: value.status as EntryStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
  if (typeof value.file === 'string' && value.file !== '') entry.file = value.file
  return { ok: true, value: entry }
}

/** The folders record as stored; anything unreadable falls back to the default. */
export function validateFolders(value: unknown): FoldersRecord {
  if (!isRecord(value) || !isStringArray(value.names)) return defaultFolders()
  const names: string[] = []
  for (const raw of value.names) {
    const name = normalizeFolderName(raw)
    if (name !== undefined && !names.some(one => one.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  if (names.length === 0) names.push(DEFAULT_FOLDER)
  const last = typeof value.last === 'string' && names.includes(value.last) ? value.last : (names[0] ?? DEFAULT_FOLDER)
  return { names, last }
}
