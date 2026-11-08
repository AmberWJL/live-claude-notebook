import type { FoldersRecord, NotebookEntry, NotebookTags } from '../types'
import { defaultFolders } from '../domain/notebook-entry'

export type MalformedRecord = { key: string; reason: string }

export type ReadAllResult = {
  entries: NotebookEntry[]
  /** Records that exist in storage but did not validate; left untouched. */
  malformed: MalformedRecord[]
}

/**
 * The storage boundary. Implementations serialize and validate; the service
 * above never sees raw stored data.
 */
export interface NotebookRepository {
  readAll(): Promise<ReadAllResult>
  read(id: string): Promise<NotebookEntry | undefined>
  write(entry: NotebookEntry): Promise<void>
  /**
   * Writes `entry` only while the stored one still equals `expected` (what
   * the caller read); false, writing nothing, when it has changed since.
   */
  writeIf(entry: NotebookEntry, expected: NotebookEntry | undefined): Promise<boolean>
  remove(id: string): Promise<void>
  readFolders(): Promise<FoldersRecord>
  writeFolders(record: FoldersRecord): Promise<void>
  /** `writeIf` for the folders record. */
  writeFoldersIf(record: FoldersRecord, expected: FoldersRecord): Promise<boolean>
  readTags(): Promise<Record<string, NotebookTags>>
  writeTags(folder: string, tags: NotebookTags): Promise<void>
}

/** Whether two stored records hold the same data, whatever the order of their keys. */
export function sameRecord(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  )
}

/** For tests and for a session where the host store is unavailable. */
export class InMemoryNotebookRepository implements NotebookRepository {
  private readonly entries = new Map<string, NotebookEntry>()
  private folders: FoldersRecord = defaultFolders()
  private readonly tags = new Map<string, NotebookTags>()

  constructor(initial: readonly NotebookEntry[] = []) {
    for (const entry of initial) this.entries.set(entry.id, structuredClone(entry))
  }

  async readAll(): Promise<ReadAllResult> {
    return { entries: [...this.entries.values()].map(e => structuredClone(e)), malformed: [] }
  }

  async read(id: string): Promise<NotebookEntry | undefined> {
    const found = this.entries.get(id)
    return found === undefined ? undefined : structuredClone(found)
  }

  async write(entry: NotebookEntry): Promise<void> {
    this.entries.set(entry.id, structuredClone(entry))
  }

  async writeIf(entry: NotebookEntry, expected: NotebookEntry | undefined): Promise<boolean> {
    if (!sameRecord(this.entries.get(entry.id), expected)) return false
    this.entries.set(entry.id, structuredClone(entry))
    return true
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id)
  }

  async readFolders(): Promise<FoldersRecord> {
    return structuredClone(this.folders)
  }

  async writeFolders(record: FoldersRecord): Promise<void> {
    this.folders = structuredClone(record)
  }

  async writeFoldersIf(record: FoldersRecord, expected: FoldersRecord): Promise<boolean> {
    if (!sameRecord(this.folders, expected)) return false
    this.folders = structuredClone(record)
    return true
  }

  async readTags(): Promise<Record<string, NotebookTags>> {
    return Object.fromEntries([...this.tags].map(([folder, tags]) => [folder, structuredClone(tags)]))
  }

  async writeTags(folder: string, tags: NotebookTags): Promise<void> {
    this.tags.set(folder, structuredClone(tags))
  }
}
