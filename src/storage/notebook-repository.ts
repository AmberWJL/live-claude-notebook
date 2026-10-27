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
  remove(id: string): Promise<void>
  readFolders(): Promise<FoldersRecord>
  writeFolders(record: FoldersRecord): Promise<void>
  readTags(): Promise<Record<string, NotebookTags>>
  writeTags(folder: string, tags: NotebookTags): Promise<void>
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

  async remove(id: string): Promise<void> {
    this.entries.delete(id)
  }

  async readFolders(): Promise<FoldersRecord> {
    return structuredClone(this.folders)
  }

  async writeFolders(record: FoldersRecord): Promise<void> {
    this.folders = structuredClone(record)
  }

  async readTags(): Promise<Record<string, NotebookTags>> {
    return Object.fromEntries([...this.tags].map(([folder, tags]) => [folder, structuredClone(tags)]))
  }

  async writeTags(folder: string, tags: NotebookTags): Promise<void> {
    this.tags.set(folder, structuredClone(tags))
  }
}
