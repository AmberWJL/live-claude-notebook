// The note file format, as every reader and writer of the notes folder sees it. Plain `node --test`, no Claude Code.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  aiModeOf,
  isNoteId,
  isNotePath,
  noteMatches,
  parseNoteFile,
  parseSourceFile,
  projectNameOf,
  safeFolderName,
  serializeNoteFile,
  slugOf,
  titleOf,
} from '../src/core/note-format.mjs'

test('a note file round-trips every front matter field and its body', () => {
  const meta = {
    id: 'e-1',
    title: 'A "quoted": title',
    folder: 'Ops',
    type: 'learning',
    tags: ['ops', 'blue green'],
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-02T00:00:00.000Z',
    captured: 'whole_message',
    role: 'assistant',
    session: 's-1',
    project: 'shop: api',
    pinned: true,
    archived: true,
  }
  const content = '# Head\n\n---\n\n```ts\nx\n```'
  const text = serializeNoteFile(meta, content)
  assert.ok(text.startsWith('---\nid: e-1\ntitle: "A \\"quoted\\": title"\nfolder: "Ops"\ntype: learning\ntags: ["ops","blue green"]\n'))
  assert.deepEqual(parseNoteFile(text), { meta, content })
})

test('empty and false fields are left out; a file with no front matter is all body', () => {
  assert.equal(serializeNoteFile({ id: 'e', tags: [], pinned: false, type: '' }, 'x'), '---\nid: e\n---\n\nx\n')
  assert.deepEqual(parseNoteFile('just text\r\n'), { meta: {}, content: 'just text' })
  assert.deepEqual(parseNoteFile('---\nno end'), { meta: {}, content: '---\nno end' })
})

test('unknown keys and unreadable tags are ignored, not fatal', () => {
  const { meta } = parseNoteFile('---\nid: e\naliases: [a]\ntags: not a list\n---\n\nbody\n')
  assert.deepEqual(meta, { id: 'e' })
})

test('paths, folders and ids stay inside the notes folder', () => {
  assert.equal(isNotePath('Ops/a.md'), true)
  for (const bad of ['../a.md', 'Ops/../a.md', 'a.md', 'Ops/sub/a.md', 'Ops\\a.md', '.hidden/a.md', 'Ops/a.txt', 42]) {
    assert.equal(isNotePath(bad), false, String(bad))
  }
  assert.equal(safeFolderName('  My   Notes '), 'My Notes')
  for (const bad of ['', '..', '.git', 'a/b', 'a\\b', 'x'.repeat(41), null]) assert.equal(safeFolderName(bad), undefined, String(bad))
  assert.equal(isNoteId('abcd-1234'), true)
  assert.equal(isNoteId('../x'), false)
})

test('slugs, titles and project names', () => {
  assert.equal(slugOf('Héllo, World!'), 'hello-world')
  assert.equal(slugOf('***'), 'note')
  assert.equal(titleOf('```\ncode\n```\n## **Cache** rule'), 'code')
  assert.equal(titleOf('\n\n# Cache \\- rule'), 'Cache - rule')
  assert.equal(titleOf('   '), undefined)
  assert.equal(projectNameOf('/Users/x/work/shop/'), 'shop')
  assert.equal(projectNameOf('C:\\Users\\x\\shop'), 'shop')
  assert.equal(projectNameOf(undefined), undefined)
})

test('sidecars, settings and search', () => {
  assert.deepEqual(parseSourceFile('{"id":"e","snapshot":"s"}'), { id: 'e', snapshot: 's' })
  assert.equal(parseSourceFile('{"id":"e"}'), undefined)
  assert.equal(parseSourceFile('nope'), undefined)
  assert.equal(aiModeOf('{"ai":"off"}'), 'off')
  assert.equal(aiModeOf('{"ai":"sometimes"}'), 'chat-only')
  assert.equal(aiModeOf(''), 'chat-only')
  const note = { title: 'Deploys', content: 'Deep down: Zeppelin', tags: ['ops'] }
  assert.equal(noteMatches(note, 'zeppelin'), true)
  assert.equal(noteMatches(note, 'OPS'), true)
  assert.equal(noteMatches(note, 'canary'), false)
  assert.equal(noteMatches(note, '  '), true)
})
