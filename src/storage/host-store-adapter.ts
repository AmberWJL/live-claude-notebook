import type { FoldersRecord, NotebookEntry, NotebookTags } from '../types'
import { NotebookError, messageOf } from '../domain/errors'
import { SCHEMA_VERSION, validateEntry, validateFolders } from '../domain/notebook-entry'
import { sameRecord, type NotebookRepository, type ReadAllResult } from './notebook-repository'

/**
 * The shape of `$.store`: the plugin's own JSON key-value store, kept by the
 * host between sessions. Structural, so the adapter takes `$.store` directly
 * and a test can hand it any object with these four methods.
 */
export type HostStore = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
}

export const META_KEY = 'meta'
export const FOLDERS_KEY = 'folders'
export const ENTRY_PREFIX = 'entry:'
export const TAGS_PREFIX = 'tags:'

export type StoreMeta = { schemaVersion: typeof SCHEMA_VERSION }

const keyOf = (id: string) => `${ENTRY_PREFIX}${id}`

/**
 * One store key per entry (`entry:<id>`), a `folders` record and a `meta`
 * record. A malformed entry is reported and skipped; it never blocks the
 * rest, and it is never overwritten or deleted by a read.
 */
export type HostStoreOptions = {
  /**
   * Runs right before each write to the store, and throws to stop it: the
   * mod renews its store lock there, so a writer that lost the lock to
   * another session writes nothing more.
   */
  beforeWrite?: () => Promise<void> | void
}

export class HostStoreNotebookRepository implements NotebookRepository {
  constructor(
    private readonly store: HostStore,
    private readonly options: HostStoreOptions = {},
  ) {}

  private async beforeWrite(): Promise<void> {
    await this.options.beforeWrite?.()
  }

  /** Writes the meta record when the store is new. Safe to call every start. */
  async ensureMeta(): Promise<StoreMeta> {
    const raw = await this.store.get(META_KEY)
    if (
      typeof raw === 'object' &&
      raw !== null &&
      (raw as Record<string, unknown>).schemaVersion === SCHEMA_VERSION
    ) {
      return raw as StoreMeta
    }
    if (raw !== undefined) {
      throw new NotebookError(
        'malformed',
        `The Notebook store reports schema ${String((raw as Record<string, unknown>)?.schemaVersion)}, which this version cannot read.`,
      )
    }
    const meta: StoreMeta = { schemaVersion: SCHEMA_VERSION }
    await this.store.set(META_KEY, meta)
    return meta
  }

  async readAll(): Promise<ReadAllResult> {
    const result: ReadAllResult = { entries: [], malformed: [] }
    let keys: string[]
    try {
      keys = await this.store.keys()
    } catch (error) {
      throw new NotebookError('storage', `Reading the Notebook failed: ${messageOf(error)}`)
    }
    for (const key of keys) {
      if (!key.startsWith(ENTRY_PREFIX)) continue
      let raw: unknown
      try {
        raw = await this.store.get(key)
      } catch (error) {
        result.malformed.push({ key, reason: `read failed: ${messageOf(error)}` })
        continue
      }
      const checked = validateEntry(raw)
      if (checked.ok) result.entries.push(checked.value)
      else result.malformed.push({ key, reason: checked.reason })
    }
    return result
  }

  async read(id: string): Promise<NotebookEntry | undefined> {
    let raw: unknown
    try {
      raw = await this.store.get(keyOf(id))
    } catch (error) {
      throw new NotebookError('storage', `Reading the entry failed: ${messageOf(error)}`)
    }
    if (raw === undefined) return undefined
    const checked = validateEntry(raw)
    if (!checked.ok) throw new NotebookError('malformed', `Stored entry ${id} is unreadable: ${checked.reason}`)
    return checked.value
  }

  async write(entry: NotebookEntry): Promise<void> {
    await this.beforeWrite()
    try {
      await this.store.set(keyOf(entry.id), entry)
    } catch (error) {
      throw new NotebookError('storage', `Saving failed: ${messageOf(error)}`)
    }
  }

  /**
   * Re-reads the entry just before the write and writes only if it is still
   * the one the caller read. Each `$.store.set` is atomic across sessions;
   * the read and the set together are not, so a session also holds the
   * store lock around the whole read-modify-write (see `store-lock.mjs`).
   */
  async writeIf(entry: NotebookEntry, expected: NotebookEntry | undefined): Promise<boolean> {
    if (!sameRecord(await this.read(entry.id), expected)) return false
    await this.write(entry)
    return true
  }

  async remove(id: string): Promise<void> {
    await this.beforeWrite()
    try {
      await this.store.delete(keyOf(id))
    } catch (error) {
      throw new NotebookError('storage', `Deleting failed: ${messageOf(error)}`)
    }
  }

  async readFolders(): Promise<FoldersRecord> {
    try {
      return validateFolders(await this.store.get(FOLDERS_KEY))
    } catch (error) {
      throw new NotebookError('storage', `Reading the folders failed: ${messageOf(error)}`)
    }
  }

  async writeFolders(record: FoldersRecord): Promise<void> {
    await this.beforeWrite()
    try {
      await this.store.set(FOLDERS_KEY, record)
    } catch (error) {
      throw new NotebookError('storage', `Saving the folders failed: ${messageOf(error)}`)
    }
  }

  async writeFoldersIf(record: FoldersRecord, expected: FoldersRecord): Promise<boolean> {
    if (!sameRecord(await this.readFolders(), expected)) return false
    await this.writeFolders(record)
    return true
  }

  async readTags(): Promise<Record<string, NotebookTags>> {
    const all: Record<string, NotebookTags> = {}
    let keys: string[]
    try {
      keys = await this.store.keys()
    } catch (error) {
      throw new NotebookError('storage', `Reading the tags failed: ${messageOf(error)}`)
    }
    for (const key of keys) {
      if (!key.startsWith(TAGS_PREFIX)) continue
      const record = (await this.store.get(key)) as Record<string, unknown> | null
      if (
        typeof record === 'object' &&
        record !== null &&
        Array.isArray(record.tags) &&
        record.tags.every(tag => typeof tag === 'string') &&
        typeof record.basis === 'string' &&
        typeof record.generatedAt === 'number'
      ) {
        all[key.slice(TAGS_PREFIX.length)] = {
          tags: record.tags as string[],
          basis: record.basis,
          generatedAt: record.generatedAt,
          by: record.by === 'model' ? 'model' : 'heuristic',
        }
      }
    }
    return all
  }

  async writeTags(folder: string, tags: NotebookTags): Promise<void> {
    await this.beforeWrite()
    try {
      await this.store.set(`${TAGS_PREFIX}${folder}`, tags)
    } catch (error) {
      throw new NotebookError('storage', `Saving the tags failed: ${messageOf(error)}`)
    }
  }
}
