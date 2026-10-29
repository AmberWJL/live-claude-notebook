// The web notebook server over HTTP, against a scratch notes folder: the file API, search, the trash, and the
// guards that keep other sites and rebound domains out. Plain `node --test`, no Claude Code.
import assert from 'node:assert/strict'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { request } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { STORE_LOCK_HELD, STORE_LOCK_SCRIPT } from '../../src/core/store-lock.mjs'

const SERVER = fileURLToPath(new URL('../../web/server.mjs', import.meta.url))
const WEB = fileURLToPath(new URL('../../web/static', import.meta.url))

/** Starts a server on a free port; resolves with its address once it says it listens. */
function start(args, env = {}) {
  // A scratch lock folder of its own, so a test never takes the lock real Claude Code sessions use.
  const lock = mkdtempSync(join(tmpdir(), 'live-notebook-lock-'))
  const child = spawn(process.execPath, [SERVER, '--serve', '--web', WEB, '--port', '0', '--lock', join(lock, '.store-lock'), ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', chunk => {
      out += chunk
      const line = out.split('\n').find(one => one.startsWith('{'))
      if (line !== undefined) resolve({ child, lockDir: join(lock, '.store-lock'), ...JSON.parse(line) })
    })
    child.on('exit', code => reject(new Error(`server exited (${code})`)))
  })
}

let root
let server
let base

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'live-notebook-'))
  server = await start(['--root', root])
  base = `http://127.0.0.1:${server.port}`
})

after(() => {
  server?.child.kill()
  rmSync(root, { recursive: true, force: true })
})

/** A request with exactly these headers, which `fetch` would add to (it sets its own `Sec-Fetch-*`). */
function raw(path, headers, method = 'GET', body = undefined) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, path, method, headers: { host: `127.0.0.1:${server.port}`, ...headers } }, res => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** A request as the notebook's own page makes it. */
function call(method, path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: { origin: base, 'sec-fetch-site': 'same-origin', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

test('create, read, edit, move, search and delete a note through the file API', async () => {
  assert.equal((await call('POST', '/api/notebook', { name: 'Ops' })).status, 201)
  assert.equal((await call('POST', '/api/notebook', { name: 'Archive' })).status, 201)
  const created = await (await call('POST', '/api/note', { folder: 'Ops', content: '# Deploys\n\nWatch the health checks.' })).json()
  assert.match(created.path, /^Ops\/deploys--[0-9a-f]{8}\.md$/)
  assert.equal(created.meta.title, 'Deploys')

  // Front matter the server does not set itself (a capture's tags, role, project) survives its edits.
  const file = join(root, 'notes', created.path)
  writeFileSync(file, readFileSync(file, 'utf8').replace('captured: excerpt', 'tags: ["ops"]\ncaptured: excerpt\nrole: assistant\nproject: "shop"'))
  const edited = await call('PUT', `/api/note?path=${encodeURIComponent(created.path)}`, { content: 'Deep down: zeppelin.', title: 'Deploys' })
  assert.equal(edited.status, 200)
  const text = readFileSync(file, 'utf8')
  assert.match(text, /tags: \["ops"\]/)
  assert.match(text, /role: assistant/)
  assert.match(text, /project: "shop"/)
  assert.match(text, /\n\nDeep down: zeppelin\.\n$/)

  const found = await (await call('GET', '/api/search?q=ZEPPELIN')).json()
  assert.deepEqual(found.paths, [created.path])
  assert.deepEqual((await (await call('GET', '/api/search?q=ops')).json()).paths, [created.path])
  assert.deepEqual((await (await call('GET', '/api/search?q=absent')).json()).paths, [])

  const moved = await (await call('PUT', `/api/note?path=${encodeURIComponent(created.path)}`, { folder: 'Archive' })).json()
  assert.match(moved.path, /^Archive\//)
  assert.equal(existsSync(file), false)

  // Delete moves the file, and the capture's sidecar, to the trash.
  mkdirSync(join(root, 'sources'), { recursive: true })
  writeFileSync(join(root, 'sources', `${created.meta.id}.json`), JSON.stringify({ id: created.meta.id, snapshot: 'orig' }))
  assert.equal((await call('DELETE', `/api/note?path=${encodeURIComponent(moved.path)}`)).status, 200)
  assert.equal(readdirSync(join(root, 'trash', 'Archive')).length, 1)
  assert.equal(existsSync(join(root, 'sources', `${created.meta.id}.json`)), false)
  assert.equal(existsSync(join(root, 'trash', 'sources', `${created.meta.id}.json`)), true)
})

test('paths that leave the notes folder are refused', async () => {
  for (const path of ['../server.json', 'Ops/../../server.json', '..%2Fport', 'Ops/sub/x.md']) {
    assert.equal((await call('GET', `/api/note?path=${encodeURIComponent(path)}`)).status, 400, path)
  }
  assert.equal((await call('POST', '/api/notebook', { name: '../outside' })).status, 400)
  const page = await fetch(`${base}/..%2f..%2fserver.json`)
  assert.match(await page.text(), /^<!doctype html>/)
})

test('another site cannot write or read notes, nor reach the server through a rebound domain', async () => {
  // A form or no-cors fetch from another site: a simple request, so no preflight protects it.
  const plant = JSON.stringify({ folder: 'Planted', content: 'x' })
  assert.equal(await raw('/api/note', { origin: 'https://evil.example', 'content-type': 'text/plain' }, 'POST', plant), 403)
  // Not JSON, even with no Origin: a write needs the content type a page elsewhere cannot send without a preflight.
  assert.equal(await raw('/api/notebook', { 'content-type': 'text/plain' }, 'POST', '{"name":"Planted"}'), 403)
  assert.equal(await raw('/api/tree', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' }), 403)
  assert.equal(await raw('/api/tree', { origin: 'null' }), 403)
  assert.equal(existsSync(join(root, 'notes', 'Planted')), false)

  // DNS rebinding: the browser sends the attacker's host name.
  assert.equal(await raw('/api/tree', { host: `attacker.example:${server.port}` }), 403)
  assert.equal(await raw('/api/tree', { host: `localhost:${server.port}` }), 200)

  // A link to the notebook from another site still opens the page, but cannot make it read notes for that site.
  assert.equal(await raw('/', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }), 200)
  assert.equal(await raw('/api/tree', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }), 403)
  // Typed in the address bar.
  assert.equal(await raw('/api/tree', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }), 200)
})

test('the page is served with a policy that runs only its own scripts', async () => {
  const page = await fetch(`${base}/`)
  const policy = page.headers.get('content-security-policy') ?? ''
  assert.match(policy, /script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+;/)
  assert.match(policy, /frame-ancestors 'none'/)
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  const html = await page.text()
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)[^"']+\.(js|css)/)
})

test('the root comes from LIVE_NOTEBOOK_HOME when no --root is given', async () => {
  const other = mkdtempSync(join(tmpdir(), 'live-notebook-env-'))
  const second = await start([], { LIVE_NOTEBOOK_HOME: other })
  try {
    const health = await (await fetch(`http://127.0.0.1:${second.port}/api/health`)).json()
    assert.equal(health.root, other)
    assert.equal(existsSync(join(other, 'notes')), true)
  } finally {
    second.child.kill()
    rmSync(other, { recursive: true, force: true })
  }
})

/** The lock script, as a Claude Code session runs it, against a server's lock folder. */
function lockStep(lockArgs) {
  const run = spawnSync(process.execPath, ['-e', STORE_LOCK_SCRIPT, ...lockArgs], { encoding: 'utf8' })
  return { exitCode: run.status, stdout: run.stdout.trim() }
}

test('a page save from an older version keeps the newer file and keeps the page text as a note of its own', async () => {
  const created = await (await call('POST', '/api/note', { folder: 'Versions', content: 'First text.' })).json()
  const path = encodeURIComponent(created.path)
  const opened = await (await call('GET', `/api/note?path=${path}`)).json()
  assert.equal(opened.version, created.version)

  // Claude Code rewrites the file while the page still holds the version it opened.
  const file = join(root, 'notes', created.path)
  writeFileSync(file, readFileSync(file, 'utf8').replace(/First text\.\n$/, 'Edited in Claude Code.\n'))
  const stale = await call('PUT', `/api/note?path=${path}`, { content: 'Typed on the page.', title: 'First text.', base: opened.version })
  assert.equal(stale.status, 409)
  const conflict = await stale.json()
  assert.match(readFileSync(file, 'utf8'), /Edited in Claude Code\.\n$/, 'the newer file stays')
  assert.equal(conflict.note.content, 'Edited in Claude Code.')
  assert.match(conflict.copy.title, /\(other version\)$/)
  assert.match(readFileSync(join(root, 'notes', conflict.copy.path), 'utf8'), /Typed on the page\.\n$/, "the page's text is kept")

  // From the version it now has, the page's save goes through.
  const fresh = await call('PUT', `/api/note?path=${path}`, { content: 'Typed again.', title: 'First text.', base: conflict.note.version })
  assert.equal(fresh.status, 200)
  const saved = await fresh.json()
  assert.equal(saved.version, (await (await call('GET', `/api/note?path=${path}`)).json()).version)
  assert.match(readFileSync(file, 'utf8'), /Typed again\.\n$/)
})

test('a notebook renamed to the same name in other letter case is renamed', async () => {
  assert.equal((await call('POST', '/api/notebook', { name: 'ideas' })).status, 201)
  await call('POST', '/api/note', { folder: 'ideas', content: 'Try canaries.' })
  const renamed = await call('PUT', '/api/notebook', { name: 'ideas', newName: 'Ideas' })
  assert.equal(renamed.status, 200)
  assert.ok(readdirSync(join(root, 'notes')).includes('Ideas'))
  assert.ok(!readdirSync(join(root, 'notes')).includes('ideas'))
})

test('a write waits while a Claude Code session holds the notebook lock, and is refused if it keeps it', async () => {
  const held = lockStep(['take', server.lockDir, 'session', '15000'])
  assert.equal(held.exitCode, 0)
  try {
    const refused = await call('POST', '/api/notebook', { name: 'Locked' })
    assert.equal(refused.status, 503)
    assert.match((await refused.json()).error, /saving to the notebook/)
    assert.equal(existsSync(join(root, 'notes', 'Locked')), false)
  } finally {
    lockStep(['give', server.lockDir, held.stdout, 'session'])
  }
  assert.equal((await call('POST', '/api/notebook', { name: 'Locked' })).status, 201)
  assert.equal(lockStep(['take', server.lockDir, 'after', '15000']).exitCode, 0, 'the server gave the lock back')
})

test('two sessions launching the server at once start one server', async () => {
  const notes = mkdtempSync(join(tmpdir(), 'live-notebook-launch-'))
  const lock = join(notes, '.store-lock')
  const launch = () =>
    new Promise((resolve, reject) => {
      execFile(process.execPath, [SERVER, '--launch', '--root', notes, '--web', WEB, '--lock', lock], { timeout: 20_000 }, (error, stdout) =>
        error ? reject(error) : resolve(JSON.parse(stdout.trim().split('\n').at(-1))),
      )
    })
  const [first, second] = await Promise.all([launch(), launch()])
  try {
    assert.equal(first.pid, second.pid)
    assert.equal(first.port, second.port)
  } finally {
    for (const pid of new Set([first.pid, second.pid])) {
      try {
        process.kill(pid)
      } catch {
        /* gone */
      }
    }
    rmSync(notes, { recursive: true, force: true })
  }
})
