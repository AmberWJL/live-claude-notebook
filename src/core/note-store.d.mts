/** The types of `note-store.mjs`, the notes folder on disk for every Node reader and writer. */
import type { NoteFileMeta } from './note-format.mjs'

export const DEFAULT_NOTEBOOK: 'General'
export const INBOX_DIR: 'inbox'
export const INBOX_LIMIT: number
export const MAX_NOTE_CHARS: number

export type NoteStoreErrorCode = 'bad-folder' | 'bad-path' | 'empty' | 'too-long' | 'not-found'
export class NoteStoreError extends Error {
  code: NoteStoreErrorCode
  constructor(code: NoteStoreErrorCode, message: string)
}

export type StoredNote = { path: string; folder: string; meta: NoteFileMeta; content: string; mtime: string }
export type NoteListItem = {
  path: string
  id: string | null
  title: string
  created: string | null
  updated: string
  captured: string | null
  type: string | null
  tags: string[]
  pinned: boolean
  preview: string
}
export type NotebookListItem = { name: string; tags: string[]; pinned: boolean; count: number; notes: NoteListItem[] }
export type SearchResult = { path: string; notebook: string; title: string; type: string | null; tags: string[]; updated: string; snippet: string }
export type NewNote = {
  folder?: string
  content: string
  title?: string
  type?: string
  tags?: readonly string[]
  captured?: 'whole_message' | 'excerpt'
  role?: 'user' | 'assistant' | 'tool'
  agent?: string
  project?: string
  id?: string
  now?: number
  allowEmpty?: boolean
}
export type InboxItem = { name: string; agent: string; capturedAt: string; text: string; project?: string }

export function resolveRoot(given?: string, env?: Record<string, string | undefined>): string
export function notesDirOf(root: string): string
export function notePathOf(root: string, rel: unknown): string | undefined
export function touch(root: string): void
export function readNotebookMeta(folderAbs: string): Record<string, unknown>
export function readAllNotes(root: string): StoredNote[]
export function listNotebooks(root: string): NotebookListItem[]
export function readNote(root: string, rel: string): { path: string; meta: NoteFileMeta; content: string } | undefined
export function searchNotes(root: string, query: string, options?: { limit?: number }): SearchResult[]
export function createNote(root: string, input: NewNote): { path: string; meta: NoteFileMeta; content: string }
export function addToInbox(root: string, item: { agent?: string; text: string; project?: string }, options?: { limit?: number; now?: number }): string
export function listInbox(root: string): InboxItem[]
export function readInboxItem(root: string, name: string): InboxItem | undefined
export function removeInboxItem(root: string, name: string): void
export function saveInboxItem(root: string, name: string, options?: { folder?: string; title?: string }): { path: string; meta: NoteFileMeta; content: string }
