// The web notebook server over HTTP, against a scratch notes folder: the file API, search, the trash, and the
// guards that keep other sites and rebound domains out. Plain `node --test`, no Claude Code.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = fileURLToPath(new URL('../../web/server.mjs', import.meta.url))
const WEB = fileURLToPath(new URL('../../web/static', import.meta.url))

/** Starts a server on a free port; resolves with its address once it says it listens. */
function start(args, env = {}) {
  const child = spawn(process.execPath, [SERVER, '--serve', '--web', WEB, '--port', '0', ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', chunk => {
      out += chunk
      const line = out.split('\n').find(one => one.startsWith('{'))
      if (line !== undefined) resolve({ child, ...JSON.parse(line) })
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
