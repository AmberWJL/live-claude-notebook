// The `live-notebook` command, its MCP server and its hook, against scratch notes folders. Plain `node --test`.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { replyOf } from '../src/cli/hook.mjs'
import { PROTOCOL_VERSIONS, agentOf, handleMessage } from '../src/cli/mcp.mjs'
import { addToInbox, createNote, listInbox, listNotebooks, saveInboxItem, searchNotes } from '../src/core/note-store.mjs'

const CLI = fileURLToPath(new URL('../bin/live-notebook.mjs', import.meta.url))
const roots = []

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'live-notebook-cli-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function run(args, { input, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8', env: { ...process.env, ...env } })
}

test('save takes words, stdin or a file, into the notebook named; search finds it by text and tag', () => {
  const root = scratch()
  const saved = run(['save', '--root', root, '-n', 'Ops', '-t', 'Deploy rule', '--tag', 'ops', '--tag', 'deploys', 'Switch traffic after health checks.'])
  assert.equal(saved.status, 0, saved.stderr)
  assert.match(saved.stdout, /^Saved to Ops: Deploy rule\n/)
  const piped = run(['save', '--root', root, '--json'], { input: '# From a pipe\n\nkeep this\n' })
  assert.equal(piped.status, 0, piped.stderr)
  assert.equal(JSON.parse(piped.stdout).meta.folder, 'General')
  const file = join(root, 'given.md')
  writeFileSync(file, 'A file note about zeppelins.')
  assert.equal(run(['save', '--root', root, '--file', file]).status, 0)

  const [ops] = readdirSync(join(root, 'notes', 'Ops'))
  const text = readFileSync(join(root, 'notes', 'Ops', ops), 'utf8')
  assert.match(text, /tags: \["ops","deploys"\]/)
  assert.match(text, /agent: cli/)
  assert.match(text, /\n\nSwitch traffic after health checks\.\n$/)

  const found = JSON.parse(run(['search', '--root', root, '--json', 'zeppelin']).stdout)
  assert.deepEqual(found.map(one => one.title), ['A file note about zeppelins.'])
  assert.equal(JSON.parse(run(['search', '--root', root, '--json', 'deploys']).stdout)[0].title, 'Deploy rule')
  assert.match(run(['search', '--root', root, 'absent']).stdout, /No notes match/)
})

test('save refuses empty text and a notebook that leaves the folder, with a message and exit 1', () => {
  const root = scratch()
  const empty = run(['save', '--root', root], { input: '   \n' })
  assert.equal(empty.status, 1)
  assert.match(empty.stderr, /no text to save/)
  const escape = run(['save', '--root', root, '-n', '../outside', 'x'])
  assert.equal(escape.status, 1)
  assert.match(escape.stderr, /notebook name/)
  assert.equal(run(['frobnicate']).status, 1)
})

test('path follows --root, then LIVE_NOTEBOOK_HOME', () => {
  const root = scratch()
  assert.equal(run(['path', '--root', root]).stdout.trim(), root)
  assert.equal(run(['path'], { env: { LIVE_NOTEBOOK_HOME: root } }).stdout.trim(), root)
})

test('the MCP server speaks JSON-RPC: initialize, list tools, save, search, read, list notebooks', () => {
  const root = scratch()
  const session = {}
  const call = (id, method, params) => handleMessage({ jsonrpc: '2.0', id, method, params }, { root, version: '9.9.9' }, session)
  const init = call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Cursor', version: '2' } })
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.deepEqual(init.result.serverInfo, { name: 'live-notebook', title: 'Live Notebook', version: '9.9.9' })
  assert.equal(call(2, 'initialize', { protocolVersion: '1999-01-01' }).result.protocolVersion, PROTOCOL_VERSIONS[0])
  session.agent = 'cursor'
  assert.equal(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, { root, version: '1' }, session), undefined)
  assert.deepEqual(call(3, 'ping').result, {})
  assert.deepEqual(call(4, 'tools/list').result.tools.map(tool => tool.name), ['save_note', 'search_notes', 'read_note', 'list_notebooks'])

  const saved = call(5, 'tools/call', { name: 'save_note', arguments: { content: '```sh\nnpm ci\n```\nUse ci in pipelines.', title: 'CI installs', notebook: 'Build', tags: ['npm'] } })
  assert.equal(saved.result.isError, undefined)
  const path = /\(([^)]+\.md)\)/.exec(saved.result.content[0].text)?.[1]
  assert.match(path, /^Build\/ci-installs--[0-9a-f]{8}\.md$/)
  assert.match(readFileSync(join(root, 'notes', path), 'utf8'), /agent: cursor/)

  assert.match(call(6, 'tools/call', { name: 'search_notes', arguments: { query: 'pipelines' } }).result.content[0].text, /Build › CI installs/)
  assert.match(call(7, 'tools/call', { name: 'read_note', arguments: { path } }).result.content[0].text, /Tags: npm\n[\s\S]*```sh\nnpm ci\n```/)
  assert.match(call(8, 'tools/call', { name: 'list_notebooks', arguments: {} }).result.content[0].text, /Build: 1 note, newest "CI installs"/)

  // Bad input is a tool error the model can read; an unknown tool or method is a protocol error.
  assert.equal(call(9, 'tools/call', { name: 'save_note', arguments: { content: '' } }).result.isError, true)
  assert.equal(call(10, 'tools/call', { name: 'read_note', arguments: { path: '../../etc/passwd' } }).result.isError, true)
  assert.equal(call(11, 'tools/call', { name: 'rm_rf', arguments: {} }).error.code, -32602)
  assert.equal(call(12, 'resources/list').error.code, -32601)
  assert.equal(handleMessage(null, { root, version: '1' }).error.code, -32600)
  assert.equal(agentOf({ name: 'Visual Studio Code' }), 'visual-studio-code')
  assert.equal(agentOf(undefined), 'mcp')
})

test('live-notebook mcp answers over stdio, one JSON message a line', async () => {
  const root = scratch()
  const child = spawn(process.execPath, [CLI, 'mcp', '--root', root], { stdio: ['pipe', 'pipe', 'inherit'] })
  const replies = []
  let buffer = ''
  child.stdout.on('data', chunk => {
    buffer += chunk
    let at
    while ((at = buffer.indexOf('\n')) >= 0) {
      replies.push(JSON.parse(buffer.slice(0, at)))
      buffer = buffer.slice(at + 1)
    }
  })
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`)
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test' } } })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'save_note', arguments: { content: 'over stdio' } } })
  child.stdin.write('not json\n')
  child.stdin.end()
  await new Promise(resolve => child.on('close', resolve))
  assert.deepEqual(replies.map(reply => reply.id), [1, 2, null])
  assert.equal(replies[0].result.serverInfo.name, 'live-notebook')
  assert.match(replies[1].result.content[0].text, /^Saved to General/)
  assert.equal(replies[2].error.code, -32700)
})

test('the hook keeps the reply from Claude Code, Cursor, Codex and Gemini inputs, and never fails the agent', () => {
  assert.deepEqual(replyOf({ hook_event_name: 'Stop', last_assistant_message: 'Done.', cwd: '/w/shop' }), { agent: 'claude-code', text: 'Done.', project: 'shop' })
  assert.deepEqual(replyOf({ hook_event_name: 'Stop', last_assistant_message: 'Done.' }, 'codex'), { agent: 'codex', text: 'Done.' })
  assert.deepEqual(replyOf({ hook_event_name: 'afterAgentResponse', text: 'Hi', workspace_roots: ['/w/app'] }), { agent: 'cursor', text: 'Hi', project: 'app' })
  assert.deepEqual(replyOf({ hook_event_name: 'AfterAgent', prompt_response: 'Yes' }), { agent: 'gemini', text: 'Yes' })
  assert.equal(replyOf({ hook_event_name: 'Stop' }), undefined)
  assert.equal(replyOf({ hook_event_name: 'Stop', last_assistant_message: '  ' }), undefined)

  const root = scratch()
  const kept = run(['hook', '--root', root], { input: JSON.stringify({ hook_event_name: 'afterAgentResponse', text: '## Reply\n\nword for word' }) })
  assert.equal(kept.status, 0)
  assert.equal(kept.stdout, '')
  assert.equal(listInbox(root)[0].text, '## Reply\n\nword for word')
  // Garbage in: still exit 0, nothing on stdout, nothing kept.
  const junk = run(['hook', '--root', root], { input: 'not json' })
  assert.equal(junk.status, 0)
  assert.equal(junk.stdout, '')
  assert.equal(listInbox(root).length, 1)
})

test('the inbox keeps the newest replies, and saving one files it word for word without a session', () => {
  const root = scratch()
  for (let i = 0; i < 5; i += 1) addToInbox(root, { agent: 'cursor', text: `reply ${i}`, project: 'app' }, { limit: 3, now: Date.UTC(2026, 0, 1, 0, 0, i) })
  const items = listInbox(root)
  assert.deepEqual(items.map(item => item.text), ['reply 4', 'reply 3', 'reply 2'])
  const note = saveInboxItem(root, items[0].name, { folder: 'Kept' })
  assert.equal(note.content, 'reply 4')
  assert.deepEqual(
    { captured: note.meta.captured, role: note.meta.role, agent: note.meta.agent, project: note.meta.project, session: note.meta.session },
    { captured: 'whole_message', role: 'assistant', agent: 'cursor', project: 'app', session: undefined },
  )
  assert.equal(listInbox(root).length, 2)
  assert.throws(() => saveInboxItem(root, items[0].name), /no longer in the inbox/)
  assert.throws(() => saveInboxItem(root, '../notes/x.json'), /Not an inbox item/)
})

test('the store lists notebooks newest first and searches title, text and tags', () => {
  const root = scratch()
  createNote(root, { folder: 'A', content: 'older', now: Date.UTC(2026, 0, 1) })
  createNote(root, { folder: 'A', content: 'newer', tags: ['zeta'], now: Date.UTC(2026, 0, 2) })
  createNote(root, { folder: 'B', content: 'other' })
  const [a, b] = listNotebooks(root)
  assert.deepEqual([a.name, a.notes.map(note => note.title), b.name], ['A', ['newer', 'older'], 'B'])
  assert.deepEqual(searchNotes(root, 'ZETA').map(found => found.title), ['newer'])
  assert.throws(() => createNote(root, { folder: 'A', content: 'x'.repeat(200_001) }), /at most/)
})
