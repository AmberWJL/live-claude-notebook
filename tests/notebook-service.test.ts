import { describe, expect, test } from 'claude-code/testing'

import type { SourceReference } from '../src/types'
import { NotebookError } from '../src/domain/errors'
import { NotebookService } from '../src/services/notebook-service'
import { InMemoryNotebookRepository } from '../src/storage/notebook-repository'
import { HostStoreNotebookRepository, type HostStore } from '../src/storage/host-store-adapter'
import { STORE_LOCK_HELD, withStoreLock } from '../src/core/store-lock.mjs'

function serviceWith(repository = new InMemoryNotebookRepository()) {
  let clock = 1_000
  let ids = 0
  const service = new NotebookService({
    repository,
    newId: () => `id-${(ids += 1)}`,
    now: () => (clock += 1),
  })
  return { service, repository }
}

const source: SourceReference = {
  captureMode: 'whole_message',
  snapshot: 'Original  text',
  capturedAt: 999,
  role: 'assistant',
  sessionId: 'session-a',
}

describe('NotebookService', () => {
  test('create derives a title, keeps the snapshot, files in the last folder, and reads back', async () => {
    const { service } = serviceWith()
    const entry = await service.create({ content: '# Lesson\n\nUse the store.', source })
    expect(entry.title).toBe('Lesson')
    expect(entry.folder).toBe('General')
    expect(entry.status).toBe('confirmed')
    expect(entry.sources[0]?.snapshot).toBe('Original  text')
    expect(await service.getById(entry.id)).toEqual(entry)
  })

  test('create rejects empty content with a coded error', async () => {
    const { service } = serviceWith()
    await expect(service.create({ content: '  \n ', source })).rejects.toThrow(NotebookError)
  })

  test('update edits content and title but never the source snapshot', async () => {
    const { service } = serviceWith()
    const created = await service.create({ content: 'before', source })
    const updated = await service.update(created.id, { content: 'after', title: 'Renamed', tags: ['x'] })
    expect(updated.content).toBe('after')
    expect(updated.title).toBe('Renamed')
    expect(updated.tags).toEqual(['x'])
    expect(updated.sources[0]?.snapshot).toBe('Original  text')
    expect(updated.updatedAt > created.updatedAt).toBe(true)
  })

  test('update of an unknown id is a not-found error', async () => {
    const { service } = serviceWith()
    await expect(service.update('missing', { title: 'x' })).rejects.toThrow('No entry with id missing')
  })

  test('archive hides from the default list; delete removes everywhere', async () => {
    const { service } = serviceWith()
    const a = await service.create({ content: 'alpha one', source })
    const b = await service.create({ content: 'beta two', source })
    await service.archive(a.id)
    expect((await service.list()).map(e => e.id)).toEqual([b.id])
    expect((await service.list({ includeArchived: true })).map(e => e.id).sort()).toEqual([a.id, b.id].sort())
    expect((await service.search('alpha')).length).toBe(0)
    expect((await service.search('alpha', { includeArchived: true })).length).toBe(1)
    await service.delete(b.id)
    expect((await service.search('beta', { includeArchived: true })).length).toBe(0)
    expect(await service.getById(b.id)).toBeUndefined()
  })

  test('saving the same content twice makes two entries', async () => {
    const { service } = serviceWith()
    const first = await service.create({ content: 'same', source })
    const second = await service.create({ content: 'same', source })
    expect(first.id === second.id).toBe(false)
    expect((await service.list()).length).toBe(2)
  })

  test('a repository write failure surfaces and leaves nothing half-saved', async () => {
    const repository = new InMemoryNotebookRepository()
    repository.write = async () => {
      throw new NotebookError('storage', 'Saving failed: disk full')
    }
    const { service } = serviceWith(repository)
    await expect(service.create({ content: 'x', source })).rejects.toThrow('disk full')
    expect((await service.list()).length).toBe(0)
  })

  test('folders: adding, filing into, and remembering the last used', async () => {
    const { service } = serviceWith()
    expect(await service.folders()).toEqual({ names: ['General'], last: 'General' })
    expect(await service.addFolder('  Work ')).toEqual({ names: ['General', 'Work'], last: 'Work' })
    expect(await service.addFolder('work')).toEqual({ names: ['General', 'Work'], last: 'Work' })
    await expect(service.addFolder('   ')).rejects.toThrow('folder name')
    const filed = await service.create({ content: 'in work', source })
    expect(filed.folder).toBe('Work')
    const fresh = await service.create({ content: 'in a new one', folder: 'Ideas', source })
    expect(fresh.folder).toBe('Ideas')
    expect(await service.folders()).toEqual({ names: ['General', 'Work', 'Ideas'], last: 'Ideas' })
    expect((await service.list({ folder: 'Work' })).map(e => e.id)).toEqual([filed.id])
    const moved = await service.update(filed.id, { folder: 'general' })
    expect(moved.folder).toBe('General')
  })

  test('removeFolder forgets a notebook and keeps a usable last-used one', async () => {
    const { service } = serviceWith()
    await service.addFolder('Work')
    await service.addFolder('Ideas')
    expect(await service.removeFolder('ideas')).toEqual({ names: ['General', 'Work'], last: 'General' })
    expect(await service.removeFolder('Work')).toEqual({ names: ['General'], last: 'General' })
    expect(await service.removeFolder('General')).toEqual({ names: ['General'], last: 'General' })
  })

  test('a content edit re-derives a derived title and keeps a custom one', async () => {
    const { service } = serviceWith()
    const derived = await service.create({ content: 'first line\nmore', source })
    expect((await service.update(derived.id, { content: 'new first line' })).title).toBe('new first line')
    const custom = await service.create({ title: 'Custom', content: 'x', source })
    expect((await service.update(custom.id, { content: 'y' })).title).toBe('Custom')
  })
})

/**
 * One `$.store` shared by several sessions, held in a Map. `pauseAfterRead`
 * stops the next read of a key after it has read the value, until released:
 * the moment another session's write can land between a read and a write.
 */
function sharedStore() {
  const data = new Map<string, unknown>()
  let armed: { key: string; skip: number; reached: () => void; gate: Promise<void> } | undefined
  /** The lock directory every session shares: who holds it, if anyone. */
  let lockOwner: string | undefined
  let tokens = 0
  const store: HostStore = {
    get: async key => {
      const value = structuredClone(data.get(key))
      if (armed?.key === key && armed.skip > 0) armed.skip -= 1
      else if (armed?.key === key) {
        const pause = armed
        armed = undefined
        pause.reached()
        await pause.gate
      }
      return value
    },
    set: async (key, value) => {
      data.set(key, structuredClone(value))
    },
    delete: async key => {
      data.delete(key)
    },
    keys: async () => [...data.keys()],
  }
  return {
    data,
    /**
     * A service of its own over the shared store, as another session has;
     * with `isLocked`, it takes the shared store lock through `withStoreLock`,
     * its script answered by `lockOwner`.
     */
    session(options: { isLocked?: boolean } = {}) {
      let clock = 1_000
      return new NotebookService({
        repository: new HostStoreNotebookRepository(store),
        newId: () => crypto.randomUUID(),
        now: () => (clock += 1),
        ...(options.isLocked === true
          ? {
              lock: <T>(work: () => Promise<T>) =>
                withStoreLock(
                  {
                    dir: '/home/t/.claude/live-notebook/.store.lock',
                    run: async ([verb, , token]) => {
                      if (verb === 'take' && lockOwner !== undefined) return { exitCode: STORE_LOCK_HELD }
                      if (verb === 'take') lockOwner = token
                      if (verb === 'give' && lockOwner === token) lockOwner = undefined
                      return { exitCode: 0 }
                    },
                    sleep: async () => {},
                    every: () => () => {},
                    newToken: () => `token-${(tokens += 1)}`,
                    waitMs: 200,
                    retryMs: 50,
                  },
                  work,
                ),
            }
          : {}),
      })
    },
    /** Pauses the read of `key` after `skip` reads of it go by. */
    pauseAfterRead(key: string, options: { skip?: number } = {}) {
      let reached = () => {}
      let release = () => {}
      const isReached = new Promise<void>(resolve => (reached = resolve))
      const gate = new Promise<void>(resolve => (release = resolve))
      armed = { key, skip: options.skip ?? 0, reached, gate }
      return { isReached, release }
    },
  }
}

describe('NotebookService across sessions', () => {
  test('a tag update that read the note before another session saved a new body keeps that body', async () => {
    const shared = sharedStore()
    const tagger = shared.session()
    const editor = shared.session()
    const entry = await tagger.create({ content: 'First body.', source })

    const pause = shared.pauseAfterRead(`entry:${entry.id}`)
    const tagging = tagger.update(entry.id, { tags: ['caching'] })
    await pause.isReached
    await editor.update(entry.id, { content: 'Second body, saved in another session.' })
    pause.release()
    const tagged = await tagging

    expect(tagged.content).toBe('Second body, saved in another session.')
    expect(tagged.tags).toEqual(['caching'])
    const stored = await editor.getById(entry.id)
    expect(stored?.content).toBe('Second body, saved in another session.')
    expect(stored?.tags).toEqual(['caching'])
  })

  test('a session that cannot get the lock saves nothing, so a writer held after its last read cannot undo its save', async () => {
    const shared = sharedStore()
    const tagger = shared.session({ isLocked: true })
    const editor = shared.session({ isLocked: true })
    const entry = await tagger.create({ content: 'First body.', source })

    // The tagger's update reads the note, then reads it again just before its write: hold it there.
    const pause = shared.pauseAfterRead(`entry:${entry.id}`, { skip: 1 })
    const tagging = tagger.update(entry.id, { tags: ['caching'] })
    await pause.isReached
    await expect(editor.update(entry.id, { content: 'Second body, saved in another session.' })).rejects.toThrow('nothing was saved')
    expect((shared.data.get(`entry:${entry.id}`) as { content: string }).content).toBe('First body.')
    pause.release()
    await tagging

    // The refused session tries again once the lock is free, and both changes stand.
    await editor.update(entry.id, { content: 'Second body, saved in another session.' })
    const stored = await editor.getById(entry.id)
    expect(stored?.content).toBe('Second body, saved in another session.')
    expect(stored?.tags).toEqual(['caching'])
  })

  test('two sessions adding notebooks at once both keep theirs', async () => {
    const shared = sharedStore()
    const first = shared.session()
    const second = shared.session()

    const pause = shared.pauseAfterRead('folders')
    const adding = first.addFolder('Alpha')
    await pause.isReached
    await second.addFolder('Beta')
    pause.release()
    await adding

    const folders = await second.folders()
    expect(folders.names).toEqual(['General', 'Beta', 'Alpha'])
    expect(folders.last).toBe('Alpha')
  })

  test('filing a note into a new notebook keeps a notebook another session added meanwhile', async () => {
    const shared = sharedStore()
    const first = shared.session()
    const second = shared.session()
    const entry = await first.create({ content: 'Roll out to 5% first.', source })

    const pause = shared.pauseAfterRead('folders')
    const moving = first.update(entry.id, { folder: 'Ops' })
    await pause.isReached
    await second.addFolder('Ideas')
    pause.release()
    expect((await moving).folder).toBe('Ops')

    const folders = await second.folders()
    expect(folders.names).toEqual(['General', 'Ideas', 'Ops'])
    expect(folders.last).toBe('Ops')
  })

  test('a classification decided before the person set tags leaves their tags', async () => {
    const shared = sharedStore()
    const classifier = shared.session()
    const person = shared.session()
    const entry = await classifier.create({ content: 'Keep the TTL under one minute.', source })

    const pause = shared.pauseAfterRead(`entry:${entry.id}`)
    const classifying = classifier.updateWith(entry.id, current =>
      current.tags.length === 0 ? { tags: ['from-model'], type: 'insight' } : undefined,
    )
    await pause.isReached
    await person.update(entry.id, { tags: ['mine'] })
    pause.release()

    expect(await classifying).toBeUndefined()
    const stored = await person.getById(entry.id)
    expect(stored?.tags).toEqual(['mine'])
    expect(stored?.type).toBe('other')
  })

  test('updateWith applies its patch when the note is as it expects, and is undefined for a missing note', async () => {
    const { service } = serviceWith()
    const entry = await service.create({ content: 'A note.', source })
    const classified = await service.updateWith(entry.id, current => (current.tags.length === 0 ? { tags: ['ttl'] } : undefined))
    expect(classified?.tags).toEqual(['ttl'])
    expect(await service.updateWith('missing', () => ({ tags: ['x'] }))).toBeUndefined()
  })

  test('a note that keeps changing under every try ends in a conflict error, not a lost edit', async () => {
    class AlwaysMoved extends InMemoryNotebookRepository {
      override async writeIf(): Promise<boolean> {
        return false
      }
    }
    const repository = new AlwaysMoved()
    const { service } = serviceWith(repository)
    const entry = await service.create({ content: 'A note.', source })
    await expect(service.update(entry.id, { title: 'Renamed' })).rejects.toThrow('Another session kept changing this note')
    expect((await repository.read(entry.id))?.title).toBe('A note.')
  })

  test('every public write takes the lock once, never nested', async () => {
    let holds = 0
    let depth = 0
    let deepest = 0
    let clock = 1_000
    const service = new NotebookService({
      repository: new InMemoryNotebookRepository(),
      newId: () => crypto.randomUUID(),
      now: () => (clock += 1),
      lock: async work => {
        holds += 1
        depth += 1
        deepest = Math.max(deepest, depth)
        try {
          return await work()
        } finally {
          depth -= 1
        }
      },
    })
    const entry = await service.create({ content: 'A note.', folder: 'Ops', source })
    await service.update(entry.id, { content: 'Edited.', folder: 'Ideas' })
    await service.setFile(entry.id, 'Ideas/a-note.md')
    await service.archive(entry.id)
    await service.addFolder('Later')
    await service.removeFolder('Later')
    expect(holds).toBe(6)
    expect(deepest).toBe(1)
    expect(await service.getById('missing')).toBeUndefined()
    expect(holds).toBe(6)
  })
})
