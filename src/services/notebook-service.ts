import type { FoldersRecord, NotebookEntry } from '../types'
import { NotebookError } from '../domain/errors'
import {
  DEFAULT_FOLDER,
  SCHEMA_VERSION,
  normalizeFolderName,
  type CreateNotebookEntryInput,
  type ListNotebookEntriesOptions,
  type UpdateNotebookEntryInput,
} from '../domain/notebook-entry'
import type { NotebookRepository } from '../storage/notebook-repository'
import { deriveTitle, normalizeContent } from '../utils/normalize-content'
import { searchEntries, type SearchOptions } from './search-service'

export type NotebookServiceDeps = {
  repository: NotebookRepository
  newId: () => string
  now: () => Promise<number> | number
}

/**
 * Create, read, update, archive, delete and search, independent of the UI
 * and of the storage mechanism. Every write goes through the repository;
 * every failure is a NotebookError with a code the UI can act on.
 */
export class NotebookService {
  constructor(private readonly deps: NotebookServiceDeps) {}

  async create(input: CreateNotebookEntryInput): Promise<NotebookEntry> {
    const normalized = normalizeContent(input.content)
    if (!normalized.ok) throw new NotebookError(normalized.reason, normalized.message)
    const folder = await this.resolveFolder(input.folder)
    const at = await this.deps.now()
    const title = (input.title ?? '').trim() || deriveTitle(normalized.content)
    const entry: NotebookEntry = {
      schemaVersion: SCHEMA_VERSION,
      id: input.id ?? this.deps.newId(),
      title,
      content: normalized.content,
      folder,
      type: input.type ?? 'other',
      tags: input.tags ?? [],
      sources: [input.source],
      status: 'confirmed',
      createdAt: input.createdAt ?? at,
      updatedAt: at,
    }
    if (input.file !== undefined) entry.file = input.file
    if (input.pinned === true) entry.pinned = true
    await this.deps.repository.write(entry)
    if (input.keepLastFolder !== true) await this.rememberFolder(folder)
    return entry
  }

  async getById(id: string): Promise<NotebookEntry | undefined> {
    return this.deps.repository.read(id)
  }

  async list(options: ListNotebookEntriesOptions = {}): Promise<NotebookEntry[]> {
    const { entries } = await this.deps.repository.readAll()
    return searchEntries(entries, '', { includeArchived: options.includeArchived, folder: options.folder })
  }

  /**
   * Edits the current content, title or folder; the original snapshots in
   * `sources` stay. A content edit with no title edit re-derives the title
   * when the old one was derived from the old content.
   */
  async update(id: string, patch: UpdateNotebookEntryInput): Promise<NotebookEntry> {
    const existing = await this.requireEntry(id)
    const next: NotebookEntry = { ...existing, tags: [...existing.tags], sources: [...existing.sources] }
    if (patch.content !== undefined) {
      const normalized = normalizeContent(patch.content)
      if (!normalized.ok) throw new NotebookError(normalized.reason, normalized.message)
      next.content = normalized.content
      if (patch.title === undefined && existing.title === deriveTitle(existing.content)) {
        next.title = deriveTitle(normalized.content)
      }
    }
    if (patch.title !== undefined) {
      const title = patch.title.trim()
      if (title === '') throw new NotebookError('invalid', 'A title cannot be empty.')
      next.title = title
    }
    if (patch.folder !== undefined) next.folder = await this.resolveFolder(patch.folder)
    if (patch.type !== undefined) next.type = patch.type
    if (patch.tags !== undefined) next.tags = [...patch.tags]
    if (patch.file !== undefined) next.file = patch.file
    if (patch.pinned === true) next.pinned = true
    else if (patch.pinned === false) delete next.pinned
    next.updatedAt = await this.deps.now()
    await this.deps.repository.write(next)
    if (patch.folder !== undefined) await this.rememberFolder(next.folder)
    return next
  }

  async archive(id: string): Promise<void> {
    await this.setStatus(id, 'archived')
  }

  async restore(id: string): Promise<void> {
    await this.setStatus(id, 'confirmed')
  }

  async delete(id: string): Promise<void> {
    await this.requireEntry(id)
    await this.deps.repository.remove(id)
  }

  async search(query: string, options: SearchOptions = {}): Promise<NotebookEntry[]> {
    const { entries } = await this.deps.repository.readAll()
    return searchEntries(entries, query, options)
  }

  async folders(): Promise<FoldersRecord> {
    return this.deps.repository.readFolders()
  }

  /** Adds a folder if it is new, without changing which one was last used. */
  async ensureFolder(raw: string): Promise<FoldersRecord> {
    const name = normalizeFolderName(raw)
    const record = await this.deps.repository.readFolders()
    if (name === undefined || record.names.some(one => one.toLowerCase() === name.toLowerCase())) return record
    const next: FoldersRecord = { names: [...record.names, name], last: record.last }
    await this.deps.repository.writeFolders(next)
    return next
  }

  /** Forgets a notebook; its entries, if any, keep their folder field until moved. */
  async removeFolder(name: string): Promise<FoldersRecord> {
    const record = await this.deps.repository.readFolders()
    const names = record.names.filter(one => one.toLowerCase() !== name.toLowerCase())
    if (names.length === record.names.length) return record
    if (names.length === 0) names.push(DEFAULT_FOLDER)
    const next: FoldersRecord = { names, last: names.includes(record.last) ? record.last : (names[0] ?? DEFAULT_FOLDER) }
    await this.deps.repository.writeFolders(next)
    return next
  }

  /** Sets an entry's file path without touching its content or timestamps. */
  async setFile(id: string, file: string): Promise<NotebookEntry> {
    const existing = await this.requireEntry(id)
    if (existing.file === file) return existing
    const next = { ...existing, file }
    await this.deps.repository.write(next)
    return next
  }

  /** Adds a folder (or finds the existing one, case-insensitively) and makes it the last used. */
  async addFolder(raw: string): Promise<FoldersRecord> {
    const name = normalizeFolderName(raw)
    if (name === undefined) throw new NotebookError('invalid', 'A folder name must be 1 to 40 characters.')
    const record = await this.deps.repository.readFolders()
    const existing = record.names.find(one => one.toLowerCase() === name.toLowerCase())
    const next: FoldersRecord = {
      names: existing === undefined ? [...record.names, name] : record.names,
      last: existing ?? name,
    }
    await this.deps.repository.writeFolders(next)
    return next
  }

  private async resolveFolder(raw: string | undefined): Promise<string> {
    const name = raw === undefined ? undefined : normalizeFolderName(raw)
    if (name === undefined) return raw === undefined ? (await this.deps.repository.readFolders()).last : DEFAULT_FOLDER
    const record = await this.deps.repository.readFolders()
    const existing = record.names.find(one => one.toLowerCase() === name.toLowerCase())
    if (existing !== undefined) return existing
    await this.deps.repository.writeFolders({ names: [...record.names, name], last: record.last })
    return name
  }

  private async rememberFolder(folder: string): Promise<void> {
    const record = await this.deps.repository.readFolders()
    if (record.last === folder && record.names.includes(folder)) return
    await this.deps.repository.writeFolders({
      names: record.names.includes(folder) ? record.names : [...record.names, folder],
      last: folder,
    })
  }

  private async setStatus(id: string, status: NotebookEntry['status']): Promise<void> {
    const existing = await this.requireEntry(id)
    if (existing.status === status) return
    await this.deps.repository.write({ ...existing, status, updatedAt: await this.deps.now() })
  }

  private async requireEntry(id: string): Promise<NotebookEntry> {
    const found = await this.deps.repository.read(id)
    if (found === undefined) throw new NotebookError('not-found', `No entry with id ${id}.`)
    return found
  }
}
