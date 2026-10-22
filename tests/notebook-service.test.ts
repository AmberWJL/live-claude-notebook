import { describe, expect, test } from 'claude-code/testing'

import type { SourceReference } from '../types'
import { NotebookError } from '../src/domain/errors'
import { NotebookService } from '../src/services/notebook-service'
import { InMemoryNotebookRepository } from '../src/storage/notebook-repository'

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
