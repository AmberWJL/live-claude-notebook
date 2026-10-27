import { describe, expect, test } from 'claude-code/testing'

import type { NotebookEntry } from '../src/types'
import { changedFiles, parseNote, planImport, relPathFor, serializeNote, slugOf } from '../src/services/note-files'

function entry(partial: Partial<NotebookEntry> & { id: string }): NotebookEntry {
  return {
    schemaVersion: 1,
    title: partial.id,
    content: 'body',
    folder: 'General',
    type: 'other',
    tags: [],
    sources: [{ captureMode: 'whole_message', snapshot: 'body', capturedAt: 1, sessionId: 's-1', role: 'assistant' }],
    status: 'confirmed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    ...partial,
  }
}

describe('note files', () => {
  test('slug and path are safe and readable', async () => {
    expect(slugOf('Cache TTL: under one minute!')).toBe('cache-ttl-under-one-minute')
    expect(slugOf('   ')).toBe('note')
    expect(relPathFor(entry({ id: 'abcdef12-3456', title: 'Hello World', folder: 'Ops' }))).toBe('Ops/hello-world--abcdef12.md')
  })

  test('serialize then parse round-trips the front matter and body', async () => {
    const one = entry({ id: 'e-1', title: 'A "quoted" title', content: '# Head\n\nline one\n\n```ts\nx\n```' })
    const text = serializeNote(one)
    expect(text.startsWith('---\nid: e-1\ntitle: "A \\"quoted\\" title"\nfolder: "General"\n')).toBe(true)
    const parsed = parseNote(text)
    expect(parsed.meta).toEqual({
      id: 'e-1',
      title: 'A "quoted" title',
      folder: 'General',
      created: '2023-11-14T22:13:20.000Z',
      updated: '2023-11-14T22:15:00.000Z',
      captured: 'whole_message',
      role: 'assistant',
      session: 's-1',
    })
    expect(parsed.content).toBe(one.content)
    expect(parseNote(serializeNote({ ...one, status: 'archived' })).meta.archived).toBe(true)
    expect(parseNote(serializeNote({ ...one, type: 'reference' })).meta.type).toBe('reference')
    expect(serializeNote(one)).not.toContain('type:')
  })

  test('a file without front matter is all body', async () => {
    expect(parseNote('just text\n')).toEqual({ meta: {}, content: 'just text' })
  })

  test('changedFiles reports unknown and newer files only', async () => {
    const files = [
      { path: 'General/a.md', folder: 'General', mtimeMs: 10 },
      { path: 'General/b.md', folder: 'General', mtimeMs: 20 },
    ]
    expect(changedFiles(files, { 'General/a.md': 10 }).map(f => f.path)).toEqual(['General/b.md'])
  })

  test('planImport: edits, renames, new notes, new notebooks, archived and missing files', async () => {
    const kept = entry({ id: 'kept', file: 'General/kept.md', content: 'same' })
    const edited = entry({ id: 'edited', file: 'General/edited.md', content: 'old', title: 'Old title' })
    const gone = entry({ id: 'gone', file: 'General/gone.md' })
    const archivedOnWeb = entry({ id: 'arch', file: 'General/arch.md' })
    const files = [
      { path: 'General/kept.md', folder: 'General', mtimeMs: 1 },
      { path: 'General/edited.md', folder: 'General', mtimeMs: 2 },
      { path: 'General/arch.md', folder: 'General', mtimeMs: 3 },
      { path: 'Ideas/new--12345678.md', folder: 'Ideas', mtimeMs: 4 },
    ]
    const texts = {
      'General/kept.md': serializeNote(kept),
      'General/edited.md': '---\nid: edited\ntitle: "New title"\n---\n\nnew text\n',
      'General/arch.md': '---\nid: arch\narchived: true\n---\n\nwhatever\n',
      'Ideas/new--12345678.md': '---\nid: 12345678-aaaa\ntitle: "Fresh"\ncreated: 2024-01-02T03:04:05.000Z\n---\n\nmade on the web\n',
    }
    const actions = planImport({
      files,
      texts,
      entries: [kept, edited, gone, archivedOnWeb],
      folders: ['General'],
      dirs: ['General', 'Ideas'],
    })
    expect(actions).toEqual([
      { kind: 'folder', name: 'Ideas' },
      { kind: 'update', entryId: 'edited', content: 'new text', title: 'New title' },
      { kind: 'archive', entryId: 'arch' },
      {
        kind: 'create',
        path: 'Ideas/new--12345678.md',
        folder: 'Ideas',
        content: 'made on the web',
        title: 'Fresh',
        id: '12345678-aaaa',
        createdAt: Date.parse('2024-01-02T03:04:05.000Z'),
      },
      { kind: 'archive', entryId: 'gone' },
    ])
  })

  test('planImport picks up a type set in the front matter', async () => {
    const one = entry({ id: 't', file: 'General/t.md', content: 'x' })
    const actions = planImport({
      files: [{ path: 'General/t.md', folder: 'General', mtimeMs: 2 }],
      texts: { 'General/t.md': '---\nid: t\ntype: reference\n---\n\nx\n' },
      entries: [one],
      folders: ['General'],
      dirs: ['General'],
    })
    expect(actions).toEqual([{ kind: 'update', entryId: 't', type: 'reference' }])
  })

  test('planImport forgets a notebook whose directory is gone, never the default one', async () => {
    const actions = planImport({
      files: [],
      texts: {},
      entries: [],
      folders: ['General', 'Ops', 'Ideas'],
      dirs: ['General', 'Ideas'],
    })
    expect(actions).toEqual([{ kind: 'folder-gone', name: 'Ops' }])
    expect(planImport({ files: [], texts: {}, entries: [], folders: ['General', 'Ops'], dirs: [] })).toEqual([])
    expect(planImport({ files: [], texts: {}, entries: [], folders: ['General'], dirs: ['Ideas'] })).toEqual([
      { kind: 'folder', name: 'Ideas' },
    ])
  })

  test('planImport matches a moved file by its id and records the move', async () => {
    const moved = entry({ id: 'm-1', file: 'General/m.md', content: 'x' })
    const actions = planImport({
      files: [{ path: 'Ops/m.md', folder: 'Ops', mtimeMs: 1 }],
      texts: { 'Ops/m.md': '---\nid: m-1\n---\n\nx\n' },
      entries: [moved],
      folders: ['General', 'Ops'],
      dirs: ['General', 'Ops'],
    })
    expect(actions).toEqual([{ kind: 'update', entryId: 'm-1', file: 'Ops/m.md', folder: 'Ops' }])
  })

  test('a pin round-trips through the file, and planImport records one set or cleared on the web', async () => {
    const pinned = entry({ id: 'p-1', file: 'General/p.md', content: 'x', pinned: true })
    expect(serializeNote(pinned).includes('\npinned: true\n---\n')).toBe(true)
    expect(parseNote(serializeNote(pinned)).meta.pinned).toBe(true)
    const plain = entry({ id: 'p-2', file: 'General/q.md', content: 'y' })
    const actions = planImport({
      files: [
        { path: 'General/p.md', folder: 'General', mtimeMs: 1 },
        { path: 'General/q.md', folder: 'General', mtimeMs: 1 },
      ],
      texts: { 'General/p.md': '---\nid: p-1\n---\n\nx\n', 'General/q.md': '---\nid: p-2\npinned: true\n---\n\ny\n' },
      entries: [pinned, plain],
      folders: ['General'],
      dirs: ['General'],
    })
    expect(actions).toEqual([
      { kind: 'update', entryId: 'p-1', pinned: false },
      { kind: 'update', entryId: 'p-2', pinned: true },
    ])
  })

  test('planImport treats "Untitled" as no title, so the first line names the note', async () => {
    const actions = planImport({
      files: [{ path: 'General/u.md', folder: 'General', mtimeMs: 1 }],
      texts: { 'General/u.md': '---\nid: u-1\ntitle: "Untitled"\n---\n\n# Real heading\n\nbody\n' },
      entries: [],
      folders: ['General'],
      dirs: ['General'],
    })
    expect(actions).toEqual([{ kind: 'create', path: 'General/u.md', folder: 'General', content: '# Real heading\n\nbody', id: 'u-1' }])
  })

  test('planImport never wipes an entry from an empty file', async () => {
    const one = entry({ id: 'e', file: 'General/e.md', content: 'keep me' })
    const actions = planImport({
      files: [{ path: 'General/e.md', folder: 'General', mtimeMs: 9 }],
      texts: { 'General/e.md': '---\nid: e\n---\n\n\n' },
      entries: [one],
      folders: ['General'],
      dirs: ['General'],
    })
    expect(actions).toEqual([])
  })
})
