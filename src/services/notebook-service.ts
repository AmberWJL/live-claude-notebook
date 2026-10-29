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
  /**
   * Runs `work` while no other session writes the notebook, or throws without
   * running it when that cannot be had. Every public write takes it once. A
   * service given none (a test, one session alone) relies on the re-check.
   */
  lock?: <T>(work: () => Promise<T>) => Promise<T>
}

/** What `updateWith` asks for: a patch for the entry as it is now, or undefined to leave it. */
export type DecidePatch = (current: NotebookEntry) => UpdateNotebookEntryInput | undefined

export type UpdateOptions = {
  /** The entry's file path, given the entry as patched: set in the same write (a note moved to another notebook). */
  fileFor?: (entry: NotebookEntry) => string
}

export type CreateOptions = {
  /**
   * When an entry already has `input.file`, that entry comes back and
   * nothing is written: two sessions importing one new file make one note.
   */
  unlessFiled?: boolean
}

/** How often a read-modify-write starts over when another writer got there first. */
const WRITE_ATTEMPTS = 5

/**
 * Create, read, update, archive, delete and search, independent of the UI
 * and of the storage mechanism. Every write goes through the repository;
 * every failure is a NotebookError with a code the UI can act on.
 *
 * Several sessions write one store. A change to a stored record is applied
 * to the record as it is at the moment of writing, never to an older copy:
 * the write goes through only if the record is still the one that was read,
 * and otherwise the change is made again on the newer one.
 */
export class NotebookService {
  constructor(private readonly deps: NotebookServiceDeps) {}

  async create(input: CreateNotebookEntryInput, options: CreateOptions = {}): Promise<NotebookEntry> {
    const normalized = normalizeContent(input.content)
    if (!normalized.ok) throw new NotebookError(normalized.reason, normalized.message)
    return this.locked(async () => {
      if (options.unlessFiled === true && input.file !== undefined) {
        const { entries } = await this.deps.repository.readAll()
        const filed = entries.find(entry => entry.file === input.file)
        if (filed !== undefined) return filed
      }
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
    })
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
   * when the old one was derived from the old content. Fields the patch
   * leaves out keep what is stored now, even if another session changed
   * them after this one last read the entry.
   */
  async update(id: string, patch: UpdateNotebookEntryInput, options: UpdateOptions = {}): Promise<NotebookEntry> {
    const updated = await this.locked(() => this.edit(id, () => patch, options))
    if (updated === undefined) throw notFound(id)
    return updated
  }

  /**
   * `update` with a patch decided from the entry as it is at the moment of
   * writing, for a change that depends on it (fill the tags only while they
   * are empty, say). Undefined when the entry is gone or `decide` leaves it.
   */
  async updateWith(id: string, decide: DecidePatch, options: UpdateOptions = {}): Promise<NotebookEntry | undefined> {
    return this.locked(() => this.edit(id, decide, options))
  }

  /**
   * Runs `work` under one hold of the lock, with a service that does not take
   * it again: for a change made of several steps that must not interleave
   * with another session's (read a file, merge it, write the store and the file).
   */
  async exclusive<T>(work: (service: NotebookService) => Promise<T>): Promise<T> {
    return this.locked(() => work(new NotebookService({ ...this.deps, lock: undefined })))
  }

  async archive(id: string): Promise<void> {
    await this.locked(() => this.setStatus(id, 'archived'))
  }

  async restore(id: string): Promise<void> {
    await this.locked(() => this.setStatus(id, 'confirmed'))
  }

  async delete(id: string): Promise<void> {
    await this.locked(async () => {
      await this.requireEntry(id)
      await this.deps.repository.remove(id)
    })
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
    if (name === undefined) return this.deps.repository.readFolders()
    return this.locked(() =>
      this.modifyFolders(record =>
        record.names.some(one => one.toLowerCase() === name.toLowerCase())
          ? record
          : { names: [...record.names, name], last: record.last },
      ),
    )
  }

  /** Forgets a notebook; its entries, if any, keep their folder field until moved. */
  async removeFolder(name: string): Promise<FoldersRecord> {
    return this.locked(() =>
      this.modifyFolders(record => {
        const names = record.names.filter(one => one.toLowerCase() !== name.toLowerCase())
        if (names.length === record.names.length) return record
        if (names.length === 0) names.push(DEFAULT_FOLDER)
        return { names, last: names.includes(record.last) ? record.last : (names[0] ?? DEFAULT_FOLDER) }
      }),
    )
  }

  /** Sets an entry's file path without touching its content or timestamps. */
  async setFile(id: string, file: string): Promise<NotebookEntry> {
    const updated = await this.locked(() =>
      this.modifyEntry(id, current => (current.file === file ? current : { ...current, file })),
    )
    if (updated === undefined) throw notFound(id)
    return updated
  }

  /** Adds a folder (or finds the existing one, case-insensitively) and makes it the last used. */
  async addFolder(raw: string): Promise<FoldersRecord> {
    const name = normalizeFolderName(raw)
    if (name === undefined) throw new NotebookError('invalid', 'A folder name must be 1 to 40 characters.')
    return this.locked(() =>
      this.modifyFolders(record => {
        const existing = record.names.find(one => one.toLowerCase() === name.toLowerCase())
        if (existing !== undefined && record.last === existing) return record
        return { names: existing === undefined ? [...record.names, name] : record.names, last: existing ?? name }
      }),
    )
  }

  // -------------------------------------------------------------------------
  // Below here every method expects the caller to hold the lock, if any.
  // -------------------------------------------------------------------------

  private locked<T>(work: () => Promise<T>): Promise<T> {
    return this.deps.lock === undefined ? work() : this.deps.lock(work)
  }

  /** The body of `update` and `updateWith`: undefined when the entry is gone or `decide` leaves it. */
  private async edit(id: string, decide: DecidePatch, options: UpdateOptions = {}): Promise<NotebookEntry | undefined> {
    let moved: string | undefined
    let isLeft = false
    const next = await this.modifyEntry(id, async current => {
      const patch = decide(current)
      isLeft = patch === undefined
      if (patch === undefined) return current
      const entry = await this.patched(current, patch)
      if (options.fileFor !== undefined) entry.file = options.fileFor(entry)
      moved = patch.folder !== undefined ? entry.folder : undefined
      return entry
    })
    if (next === undefined || isLeft) return undefined
    if (moved !== undefined) await this.rememberFolder(moved)
    return next
  }

  private async patched(existing: NotebookEntry, patch: UpdateNotebookEntryInput): Promise<NotebookEntry> {
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
    return next
  }

  /**
   * Reads the entry, asks `change` for its next state and writes it only if
   * the stored entry is still the one read; otherwise starts over on the
   * newer one. `change` returning the entry it was given writes nothing.
   * Undefined when the entry is gone.
   */
  private async modifyEntry(
    id: string,
    change: (current: NotebookEntry) => NotebookEntry | Promise<NotebookEntry>,
  ): Promise<NotebookEntry | undefined> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const current = await this.deps.repository.read(id)
      if (current === undefined) return undefined
      const next = await change(current)
      if (next === current) return current
      if (await this.deps.repository.writeIf(next, current)) return next
    }
    throw conflict()
  }

  /** `modifyEntry` for the folders record. */
  private async modifyFolders(change: (current: FoldersRecord) => FoldersRecord): Promise<FoldersRecord> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const current = await this.deps.repository.readFolders()
      const next = change(current)
      if (next === current) return current
      if (await this.deps.repository.writeFoldersIf(next, current)) return next
    }
    throw conflict()
  }

  private async resolveFolder(raw: string | undefined): Promise<string> {
    const name = raw === undefined ? undefined : normalizeFolderName(raw)
    if (name === undefined) return raw === undefined ? (await this.deps.repository.readFolders()).last : DEFAULT_FOLDER
    let resolved = name
    await this.modifyFolders(record => {
      const existing = record.names.find(one => one.toLowerCase() === name.toLowerCase())
      resolved = existing ?? name
      return existing !== undefined ? record : { names: [...record.names, name], last: record.last }
    })
    return resolved
  }

  private async rememberFolder(folder: string): Promise<void> {
    await this.modifyFolders(record =>
      record.last === folder && record.names.includes(folder)
        ? record
        : { names: record.names.includes(folder) ? record.names : [...record.names, folder], last: folder },
    )
  }

  private async setStatus(id: string, status: NotebookEntry['status']): Promise<void> {
    const updated = await this.modifyEntry(id, async current =>
      current.status === status ? current : { ...current, status, updatedAt: await this.deps.now() },
    )
    if (updated === undefined) throw notFound(id)
  }

  private async requireEntry(id: string): Promise<NotebookEntry> {
    const found = await this.deps.repository.read(id)
    if (found === undefined) throw notFound(id)
    return found
  }
}

function notFound(id: string): NotebookError {
  return new NotebookError('not-found', `No entry with id ${id}.`)
}

function conflict(): NotebookError {
  return new NotebookError('conflict', 'Another session kept changing this note while it was being saved. Try again.')
}
