/** The types of `note-format.mjs`, the note file format every reader and writer of the notes folder shares. */

export const NOTES_DIR: 'notes'
export const SOURCES_DIR: 'sources'
export const TRASH_DIR: 'trash'
export const SETTINGS_FILE: 'settings.json'
export const NOTEBOOK_META_FILE: '_notebook.json'
export const TOUCH_FILE: '.touch'

export const NOTE_TYPES: readonly ['insight', 'learning', 'reference', 'other']
export const NOTE_ROLES: readonly ['user', 'assistant', 'tool']

export type AiMode = 'chat-only' | 'all' | 'off'
export const AI_MODES: readonly AiMode[]
export const DEFAULT_AI_MODE: 'chat-only'

/** A note file's front matter, as read; every field is optional. */
export type NoteFileMeta = {
  id?: string
  title?: string
  folder?: string
  type?: string
  tags?: string[]
  created?: string
  updated?: string
  /** `whole_message` or `excerpt`. */
  captured?: string
  /** Who wrote the captured text: `user`, `assistant` or `tool`. */
  role?: string
  session?: string
  /** The name (not the path) of the project directory the note was captured in. */
  project?: string
  pinned?: boolean
  archived?: boolean
}

/** A note's sidecar under `sources/`: the text exactly as captured, and where it came from. */
export type SourceFile = {
  id: string
  captureMode: string
  capturedAt: string
  snapshot: string
  messageId?: string
  startOffset?: number
  endOffset?: number
}

export function slugOf(text: string, max?: number): string
export function fileNameFor(id: string, title: string): string
export function projectNameOf(path: string | undefined): string | undefined
export function titleOf(content: string): string | undefined
export function safeFolderName(name: unknown): string | undefined
export function isNotePath(rel: unknown): rel is string
export function isNoteId(id: unknown): id is string
export function sourcePathFor(id: string): string
export function parseNoteFile(text: string): { meta: NoteFileMeta; content: string }
export function serializeNoteFile(meta: NoteFileMeta, content: string): string
export function parseSourceFile(text: string): SourceFile | undefined
export function aiModeOf(settingsText: string): AiMode
export function noteMatches(note: { title?: string; content?: string; tags?: readonly string[] }, query: string): boolean
