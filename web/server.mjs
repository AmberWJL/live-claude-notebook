#!/usr/bin/env node
/**
 * Live Notebook's local web server: serves the editor site and reads and
 * writes the markdown note files under `<root>/notes`. Zero dependencies.
 *
 *   node server.mjs --launch --root <dir> --web <dir>
 *       Starts a detached server (or finds the running one) and prints
 *       `{ "port", "pid", "url", "startedAt" }` as one JSON line.
 *   node server.mjs --serve  --root <dir> --web <dir> [--port <n>]
 *       Runs the server in the foreground.
 *   node server.mjs --stop   --root <dir>
 *       Stops the server named in `<root>/server.json`.
 *
 * It binds to 127.0.0.1 only, on the same port every time (remembered in
 * `<root>/port`), so a page left open keeps working when the server is
 * replaced. Every file path a request names is checked to lie under the
 * notes directory. A request must name this server as its Host (so a web
 * page cannot reach it by rebinding a domain to 127.0.0.1), and a browser's
 * request must come from the notebook's own page (so another site cannot
 * write notes through it).
 *
 * Every write takes the notebook's write lock (`--lock`, else
 * `~/.claude/live-notebook/.store-lock`), the one Claude Code sessions take
 * for theirs, so a session and the page never write a note at once. A save
 * from the page names the version of the note it started from; when the
 * file changed since (in Claude Code, say), the page's text is kept as a
 * note of its own instead of replacing the newer one.
 *
 * The root is `--root`, else `LIVE_NOTEBOOK_HOME`, else `~/.claude/live-notebook`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  NOTE_TYPES,
  NOTES_DIR,
  SOURCES_DIR,
  TRASH_DIR,
  isNoteId,
  isNotePath,
  noteMatches,
  parseNoteFile as parseNote,
  safeFolderName as safeFolder,
  serializeNoteFile as serializeNote,
  slugOf,
  sourcePathFor,
  titleOf,
} from '../src/core/note-format.mjs'
import { EXPORT_FORMATS } from '../src/services/export-markdown.mjs'
import { STORE_LOCK_DIR, STORE_LOCK_SCRIPT, StoreLockError, withStoreLock } from '../src/core/store-lock.mjs'

const args = parseArgs(process.argv.slice(2))
const root = resolve(args.root ?? (process.env.LIVE_NOTEBOOK_HOME?.trim() || join(homedir(), '.claude', 'live-notebook')))
const notesDir = join(root, NOTES_DIR)
const webDir = resolve(args.web ?? join(fileURLToPath(new URL('.', import.meta.url)), 'static'))
const serverFile = join(root, 'server.json')
const portFile = join(root, 'port')
const touchFile = join(notesDir, '.touch')
const lockDir = resolve(args.lock ?? process.env.LIVE_NOTEBOOK_LOCK_DIR ?? join(homedir(), '.claude', 'live-notebook', STORE_LOCK_DIR))
const launchLock = join(root, '.launch.lock')
const DEFAULT_PORT = 47231
const version = readVersion()

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else {
      out[key] = true
    }
  }
  return out
}

function readVersion() {
  try {
    const manifest = new URL('../.claude-plugin/plugin.json', import.meta.url)
    return String(JSON.parse(readFileSync(fileURLToPath(manifest), 'utf8')).version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

/** -1, 0 or 1 as version `a` is older than, the same as, or newer than `b`. */
function compareVersions(a, b) {
  const pa = String(a ?? '0').split('.').map(n => Number.parseInt(n, 10) || 0)
  const pb = String(b ?? '0').split('.').map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

function rememberedPort() {
  try {
    const port = Number(readFileSync(portFile, 'utf8').trim())
    if (Number.isInteger(port) && port > 0 && port < 65536) return port
  } catch {
    /* none */
  }
  return DEFAULT_PORT
}

function readServerFile() {
  try {
    const info = JSON.parse(readFileSync(serverFile, 'utf8'))
    if (typeof info.port === 'number' && typeof info.pid === 'number') return info
  } catch {
    /* none */
  }
  return undefined
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Whether a notebook server for this root answers on `port`. */
async function servesThisRoot(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    return response.ok && (await response.json()).root === root
  } catch {
    return false
  }
}

async function isHealthy(info) {
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Notes on disk
// ---------------------------------------------------------------------------

function safeNotePath(rel) {
  if (!isNotePath(rel)) return undefined
  const abs = resolve(notesDir, rel)
  if (!abs.startsWith(notesDir + sep)) return undefined
  return abs
}

function touch() {
  mkdirSync(notesDir, { recursive: true })
  writeFileSync(touchFile, String(Date.now()))
}

function listNotebooks() {
  mkdirSync(notesDir, { recursive: true })
  const notebooks = []
  for (const dir of readdirSync(notesDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue
    const folder = join(notesDir, dir.name)
    const meta = readNotebookMeta(folder)
    const tags = Array.isArray(meta.tags) ? meta.tags.filter(tag => typeof tag === 'string').slice(0, 3) : []
    const notes = []
    for (const file of readdirSync(folder, { withFileTypes: true })) {
      if (!file.isFile() || extname(file.name) !== '.md') continue
      const abs = join(folder, file.name)
      const { meta, content } = parseNote(readFileSync(abs, 'utf8'))
      if (meta.archived === true) continue
      const stat = statSync(abs)
      notes.push({
        path: `${dir.name}/${file.name}`,
        id: meta.id ?? null,
        title: meta.title ?? titleOf(content) ?? file.name.replace(/\.md$/, ''),
        created: meta.created ?? null,
        updated: meta.updated ?? stat.mtime.toISOString(),
        captured: meta.captured ?? null,
        type: meta.type ?? null,
        tags: meta.tags ?? [],
        pinned: meta.pinned === true,
        preview: content.replace(/\s+/g, ' ').trim().slice(0, 140),
      })
    }
    // Pinned notes first, then the newest.
    notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updated).localeCompare(String(a.updated)))
    // An archived notebook stays off the page until a note is saved into it again.
    if (meta.archived === true && notes.length === 0) continue
    notebooks.push({ name: dir.name, tags, pinned: meta.pinned === true, count: notes.length, notes })
  }
  // Pinned notebooks first, then by name.
  notebooks.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name))
  return notebooks
}

/** A notebook's `_notebook.json`: its tags from Claude Code, and the web's pinned and archived flags; `{}` when none. */
function readNotebookMeta(folder) {
  try {
    const meta = JSON.parse(readFileSync(join(folder, '_notebook.json'), 'utf8'))
    return meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
  } catch {
    return {}
  }
}

function writeNotebookMeta(folder, meta) {
  writeFileSync(join(folder, '_notebook.json'), JSON.stringify(meta, null, 2))
}

function updateNote(abs, body) {
  const { meta, content } = parseNote(readFileSync(abs, 'utf8'))
  const nextContent = typeof body.content === 'string' ? body.content.replace(/\r\n?/g, '\n') : content
  if (typeof body.title === 'string' && body.title.trim() !== '' && body.title.trim() !== 'Untitled') {
    meta.title = body.title.trim()
  } else if (body.title === '' || meta.title === undefined || meta.title === 'Untitled') {
    // No title of the person's own: the first line of the text names the note.
    meta.title = titleOf(nextContent) ?? 'Untitled'
  }
  // The note's type, chosen on the page; Claude Code reads it back from the file.
  if (NOTE_TYPES.includes(body.type)) meta.type = body.type
  // Pinned (kept at the top of its notebook) and archived (gone from the page; Claude Code archives the entry).
  if (body.pinned === true) meta.pinned = true
  else if (body.pinned === false) delete meta.pinned
  if (body.archived === true) meta.archived = true
  // A pin alone is not an edit: the note keeps its place among the others.
  const isEdit = typeof body.content === 'string' || typeof body.title === 'string' || NOTE_TYPES.includes(body.type) || body.archived === true
  if (isEdit) meta.updated = new Date().toISOString()
  const text = serializeNote(meta, nextContent)
  writeFileSync(abs, text)
  touch()
  return { meta, version: versionOf(text) }
}

/**
 * Moves a note's file into another notebook's directory (which must exist);
 * its front matter follows. Claude Code matches the moved file by its id.
 */
function moveNote(abs, rel, folderName) {
  const folder = safeFolder(folderName)
  if (folder === undefined) return { status: 400, error: 'bad folder' }
  const { meta, content } = parseNote(readFileSync(abs, 'utf8'))
  if (folder === rel.split('/')[0]) return { status: 200, path: rel, meta, version: versionOf(readFileSync(abs, 'utf8')) }
  if (!existsSync(join(notesDir, folder))) return { status: 404, error: 'notebook not found' }
  const next = `${folder}/${basename(abs)}`
  const nextAbs = safeNotePath(next)
  if (nextAbs === undefined) return { status: 400, error: 'bad path' }
  if (existsSync(nextAbs)) return { status: 409, error: 'a note with that file name is already there' }
  meta.folder = folder
  meta.updated = new Date().toISOString()
  const text = serializeNote(meta, content)
  writeFileSync(nextAbs, text)
  unlinkSync(abs)
  touch()
  return { status: 200, path: next, meta, version: versionOf(text) }
}

// ---------------------------------------------------------------------------
// The write lock and note versions
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

function runLock(lockArgs) {
  const run = spawnSync(process.execPath, ['-e', STORE_LOCK_SCRIPT, ...lockArgs], { encoding: 'utf8', timeout: 5000 })
  if (run.error) throw run.error
  return { exitCode: run.status ?? 1, stdout: run.stdout ?? '' }
}

/**
 * Runs `work` holding the notebook's write lock. The lock is renewed right
 * before `work`, which reads and writes files synchronously, well inside the
 * lock's stale time. Throws a StoreLockError when a session keeps the lock.
 */
function withNotebookLock(work) {
  return withStoreLock(
    {
      dir: lockDir,
      run: async lockArgs => runLock(lockArgs),
      sleep,
      every: (ms, beat) => {
        const timer = setInterval(() => void beat(), ms)
        return () => clearInterval(timer)
      },
      newToken: () => randomUUID(),
    },
    async check => {
      await check()
      return work()
    },
  )
}

/**
 * A note file's version: what a save from the page names to say which text
 * it started from. Only the title and the text count, the two things a save
 * from the page writes; a new type, pin or notebook is not a conflict.
 */
function versionOf(text) {
  const { meta, content } = parseNote(text)
  return createHash('sha256').update(`${meta.title ?? ''}\u0000${content}`).digest('hex').slice(0, 16)
}

/** A new note file in a notebook, with a fresh id; the folder must be a safe name. */
function createNoteFile(folder, title, content, extra = {}) {
  const id = randomUUID()
  const now = new Date().toISOString()
  const rel = `${folder}/${slugOf(title)}--${id.slice(0, 8)}.md`
  const abs = safeNotePath(rel)
  if (abs === undefined) return undefined
  mkdirSync(join(notesDir, folder), { recursive: true })
  const meta = { id, title, folder, created: now, updated: now, captured: 'excerpt', ...extra }
  const text = serializeNote(meta, content)
  writeFileSync(abs, text)
  return { path: rel, meta, content, version: versionOf(text) }
}

/**
 * The page's text, saved from a version older than the file's: it becomes a
 * note of its own in the same notebook, so neither text is lost.
 */
function keepOtherVersion(rel, body) {
  const folder = rel.split('/')[0]
  const { meta } = parseNote(readFileSync(safeNotePath(rel), 'utf8'))
  const title = `${(typeof body.title === 'string' && body.title.trim()) || meta.title || 'Untitled'} (other version)`
  return createNoteFile(folder, title, String(body.content ?? '').replace(/\r\n?/g, '\n'))
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.gif': 'image/gif',
}

/**
 * The scripts Vditor reads and runs as inline text (its icon set and
 * strings), allowed by their hashes and nothing else inline.
 */
function inlineScriptHashes() {
  const hashes = []
  for (const dir of ['icons', 'i18n']) {
    const folder = join(webDir, 'vendor', 'vditor', 'dist', 'js', dir)
    if (!existsSync(folder)) continue
    for (const file of readdirSync(folder)) {
      if (extname(file) !== '.js') continue
      hashes.push(`'sha256-${createHash('sha256').update(readFileSync(join(folder, file))).digest('base64')}'`)
    }
  }
  return hashes
}

/**
 * The page may run only its own scripts and talk only to this server; it may
 * show pictures a note links to anywhere. No other site may frame it.
 */
const PAGE_POLICY = [
  "default-src 'self'",
  ["script-src 'self'", ...inlineScriptHashes()].join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

function headersFor(type) {
  const headers = {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
  if (type.startsWith('text/html')) {
    headers['content-security-policy'] = PAGE_POLICY
    headers['x-frame-options'] = 'DENY'
  }
  return headers
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, headersFor(type))
  res.end(text)
}

/** The port this server listens on, once it does. */
let listeningPort = 0
const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '[::1]']

/**
 * Why a request is refused, or undefined to serve it. The Host must be this
 * server: a page on a domain rebound to 127.0.0.1 sends its own name. A
 * browser marks a request from another site (`Sec-Fetch-Site`, `Origin`);
 * only a navigation to the page itself may come from one, as a link to the
 * notebook does. A write must be JSON, which a page elsewhere cannot send
 * here without a preflight this server never answers.
 */
function refusalOf(req, pathname) {
  const host = req.headers.host
  if (!LOOPBACK_NAMES.some(name => host === `${name}:${listeningPort}`)) return 'unknown host'
  const isApi = pathname.startsWith('/api/')
  const site = req.headers['sec-fetch-site']
  const isNavigation = !isApi && req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate'
  if (site !== undefined && site !== 'same-origin' && site !== 'none' && !isNavigation) return 'request from another site'
  const origin = req.headers.origin
  if (origin !== undefined && !LOOPBACK_NAMES.some(name => origin === `http://${name}:${listeningPort}`) && !isNavigation) {
    return 'request from another origin'
  }
  if (isApi && (req.method === 'POST' || req.method === 'PUT') && !/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    return 'expected application/json'
  }
  return undefined
}

/** Moves a note's sidecar, if it has one, to `<root>/trash/sources/` beside its file in the trash. */
function trashSidecar(id) {
  if (!isNoteId(id)) return
  const from = join(root, sourcePathFor(id))
  if (!existsSync(from)) return
  mkdirSync(join(root, TRASH_DIR, SOURCES_DIR), { recursive: true })
  renameSync(from, join(root, TRASH_DIR, sourcePathFor(id)))
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > 4_000_000) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolveBody(data === '' ? {} : JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const abs = resolve(webDir, rel)
  if (!abs.startsWith(webDir + sep) && abs !== webDir) return send(res, 404, { error: 'not found' })
  if (!existsSync(abs) || statSync(abs).isDirectory()) {
    const index = join(webDir, 'index.html')
    if (existsSync(index)) return send(res, 200, readFileSync(index, 'utf8'), TYPES['.html'])
    return send(res, 404, { error: 'not found' })
  }
  res.writeHead(200, headersFor(TYPES[extname(abs)] ?? 'application/octet-stream'))
  res.end(readFileSync(abs))
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const { pathname } = url
  const refusal = refusalOf(req, pathname)
  if (refusal !== undefined) return send(res, 403, { error: refusal })
  try {
    const isApi = pathname.startsWith('/api/')
    const isWrite = isApi && req.method !== 'GET'
    const body = isApi && (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {}
    // A write holds the notebook's lock, as a Claude Code session's does, so the two never write a note at once.
    if (isWrite) return await withNotebookLock(() => route(req, res, url, body))
    return route(req, res, url, body)
  } catch (error) {
    if (error instanceof StoreLockError) return send(res, 503, { error: error.message })
    return send(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * A save of a note's text from the page. When it names the version it
 * started from and the file has changed since, the file stays as it is and
 * the page's text becomes a note of its own.
 */
function saveFromPage(abs, rel, body, isClosing = false) {
  if (typeof body.base === 'string' && typeof body.content === 'string') {
    const current = readFileSync(abs, 'utf8')
    if (versionOf(current) !== body.base) {
      const copy = keepOtherVersion(rel, body)
      touch()
      const { meta, content } = parseNote(current)
      return { conflict: true, copy: copy === undefined ? null : { path: copy.path, title: copy.meta.title }, note: { path: rel, meta, content, version: versionOf(current) }, isClosing }
    }
  }
  return updateNote(abs, body)
}

function route(req, res, url, body) {
  const { pathname } = url
    if (pathname === '/api/health') return send(res, 200, { ok: true, root, web: webDir, version })
    if (pathname === '/api/tree' && req.method === 'GET') return send(res, 200, { notebooks: listNotebooks() })
    if (pathname === '/api/search' && req.method === 'GET') {
      // Every word of every active note, its title and its tags; the tree's previews hold only the opening.
      const query = url.searchParams.get('q') ?? ''
      const paths = []
      for (const notebook of listNotebooks()) {
        for (const note of notebook.notes) {
          const { meta, content } = parseNote(readFileSync(join(notesDir, note.path), 'utf8'))
          if (noteMatches({ title: note.title, content, tags: meta.tags }, query)) paths.push(note.path)
        }
      }
      return send(res, 200, { query, paths })
    }

    if (pathname === '/api/note') {
      if (req.method === 'POST' && url.searchParams.has('path')) {
        // The page's last save as it closes: sendBeacon can only POST.
        const abs = safeNotePath(url.searchParams.get('path'))
        if (abs === undefined) return send(res, 400, { error: 'bad path' })
        if (!existsSync(abs)) return send(res, 404, { error: 'not found' })
        return send(res, 200, { ok: true, ...saveFromPage(abs, url.searchParams.get('path'), body, true) })
      }
      if (req.method === 'POST') {
        const folder = safeFolder(body.folder)
        if (folder === undefined) return send(res, 400, { error: 'bad folder' })
        const content = typeof body.content === 'string' ? body.content : ''
        const given = typeof body.title === 'string' && body.title.trim() !== '' && body.title.trim() !== 'Untitled'
        const title = given ? body.title.trim() : (titleOf(content) ?? 'Untitled')
        const created = createNoteFile(folder, title, content)
        if (created === undefined) return send(res, 400, { error: 'bad path' })
        touch()
        return send(res, 201, created)
      }
      const abs = safeNotePath(url.searchParams.get('path'))
      if (abs === undefined) return send(res, 400, { error: 'bad path' })
      if (req.method === 'GET') {
        if (!existsSync(abs)) return send(res, 404, { error: 'not found' })
        const text = readFileSync(abs, 'utf8')
        const { meta, content } = parseNote(text)
        return send(res, 200, { path: url.searchParams.get('path'), meta, content, version: versionOf(text) })
      }
      if (req.method === 'PUT') {
        if (!existsSync(abs)) return send(res, 404, { error: 'not found' })
        const rel = url.searchParams.get('path')
        const saved = saveFromPage(abs, rel, body)
        if (saved.conflict) return send(res, 409, { error: 'This note changed since the page opened it.', ...saved })
        let { meta, version } = saved
        let path = rel
        if (typeof body.folder === 'string') {
          // Moved to another notebook: the file changes directory.
          const moved = moveNote(abs, rel, body.folder)
          if (moved.status !== 200) return send(res, moved.status, { error: moved.error })
          path = moved.path
          meta = moved.meta
          version = moved.version
        }
        return send(res, 200, { ok: true, path, meta, version })
      }
      if (req.method === 'DELETE') {
        // Delete: the file goes to <root>/trash/<Notebook>, so nothing is lost;
        // Claude Code keeps the note as an archived entry.
        if (!existsSync(abs)) return send(res, 404, { error: 'not found' })
        const rel = url.searchParams.get('path')
        const folder = rel.split('/')[0]
        const trash = join(root, TRASH_DIR, folder)
        mkdirSync(trash, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const name = `${basename(abs, '.md')}--${stamp}.md`
        const { meta } = parseNote(readFileSync(abs, 'utf8'))
        renameSync(abs, join(trash, name))
        trashSidecar(meta.id)
        touch()
        return send(res, 200, { ok: true, trashed: `trash/${folder}/${name}` })
      }
    }

    if (pathname === '/api/notebook' && req.method === 'POST') {
      const folder = safeFolder(body.name)
      if (folder === undefined) return send(res, 400, { error: 'bad folder' })
      mkdirSync(join(notesDir, folder), { recursive: true })
      touch()
      return send(res, 201, { name: folder })
    }

    if (pathname === '/api/notebook' && req.method === 'PUT') {
      const from = safeFolder(body.name)
      if (from === undefined) return send(res, 400, { error: 'bad folder' })
      const fromDir = join(notesDir, from)
      if (!existsSync(fromDir)) return send(res, 404, { error: 'not found' })
      if (body.newName === undefined) {
        // Pinned (kept at the top of the list) or archived (off the page with every note in it: the files stay,
        // marked archived; Claude Code archives the entries and drops the notebook from its pane). The flags
        // live in the notebook's meta file, which Claude Code keeps when it writes the tags.
        if (body.archived === true) {
          for (const file of readdirSync(fromDir)) {
            if (extname(file) === '.md') updateNote(join(fromDir, file), { archived: true })
          }
        }
        const meta = readNotebookMeta(fromDir)
        if (body.pinned === true) meta.pinned = true
        else if (body.pinned === false) delete meta.pinned
        if (body.archived === true) meta.archived = true
        writeNotebookMeta(fromDir, { ...meta, name: from })
        touch()
        return send(res, 200, { name: from, pinned: meta.pinned === true, archived: meta.archived === true })
      }
      // Rename: the directory moves and every note's front matter follows.
      const to = safeFolder(body.newName)
      if (to === undefined) return send(res, 400, { error: 'bad folder' })
      const toDir = join(notesDir, to)
      // Only the letter case changes: on macOS and Windows that is the same directory, so it goes through a spare name.
      const isCaseOnly = from !== to && from.toLowerCase() === to.toLowerCase()
      if (from !== to && !isCaseOnly && existsSync(toDir)) return send(res, 409, { error: 'a notebook with that name exists' })
      if (isCaseOnly) {
        const spare = join(notesDir, `.rename-${randomUUID()}`)
        renameSync(fromDir, spare)
        renameSync(spare, toDir)
      } else if (from !== to) renameSync(fromDir, toDir)
      for (const file of readdirSync(toDir)) {
        if (extname(file) !== '.md') continue
        const abs = join(toDir, file)
        const { meta, content } = parseNote(readFileSync(abs, 'utf8'))
        meta.folder = to
        writeFileSync(abs, serializeNote(meta, content))
      }
      try {
        writeNotebookMeta(toDir, { ...readNotebookMeta(toDir), name: to })
      } catch {
        /* the mod rewrites it */
      }
      touch()
      return send(res, 200, { name: to })
    }

    if (pathname === '/api/notebook' && req.method === 'DELETE') {
      // Delete: the directory goes to <root>/trash, so nothing is lost.
      const folder = safeFolder(url.searchParams.get('name'))
      if (folder === undefined) return send(res, 400, { error: 'bad folder' })
      const dir = join(notesDir, folder)
      if (!existsSync(dir)) return send(res, 404, { error: 'not found' })
      const trash = join(root, TRASH_DIR)
      mkdirSync(trash, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const ids = readdirSync(dir)
        .filter(file => extname(file) === '.md')
        .map(file => parseNote(readFileSync(join(dir, file), 'utf8')).meta.id)
      renameSync(dir, join(trash, `${folder}--${stamp}`))
      for (const id of ids) trashSidecar(id)
      touch()
      return send(res, 200, { ok: true, trashed: `trash/${folder}--${stamp}` })
    }

    if (pathname === '/api/export' && req.method === 'GET') {
      const folder = safeFolder(url.searchParams.get('name'))
      if (folder === undefined) return send(res, 400, { error: 'bad folder' })
      const notebook = listNotebooks().find(one => one.name === folder)
      if (!notebook) return send(res, 404, { error: 'not found' })
      // The same file the pane's Export writes: one module makes both. `format=txt` is plain text; else markdown.
      const format = EXPORT_FORMATS[url.searchParams.get('format') === 'txt' ? 'txt' : 'md']
      const notes = notebook.notes.map(note => {
        const { meta, content } = parseNote(readFileSync(join(notesDir, note.path), 'utf8'))
        return { title: note.title, type: meta.type ?? null, created: meta.created ?? null, fromMessage: meta.captured === 'whole_message', content }
      })
      res.writeHead(200, {
        'content-type': `${format.mime}; charset=utf-8`,
        'content-disposition': `attachment; filename="${slugOf(folder)}${format.extension}"`,
        'cache-control': 'no-store',
      })
      return res.end(format.render({ name: folder, tags: notebook.tags, notes }, new Date().toISOString().slice(0, 10)))
    }

    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' })
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' })
    return serveStatic(res, pathname)
}

function serve() {
  mkdirSync(notesDir, { recursive: true })
  const server = createServer((req, res) => void handle(req, res))
  const wanted = args.port !== undefined ? Number(args.port) : rememberedPort()
  let attempts = 0
  server.on('error', error => {
    if (error.code !== 'EADDRINUSE' || wanted === 0) throw error
    attempts += 1
    void (async () => {
      // A notebook server for these notes already has the port: this one would only be a second copy.
      if (await servesThisRoot(wanted)) process.exit(0)
      // A server being replaced may hold the port a moment longer; past that, any free port.
      setTimeout(() => server.listen(attempts < 15 ? wanted : 0, '127.0.0.1'), 200)
    })()
  })
  server.on('listening', () => {
    const address = server.address()
    listeningPort = address.port
    const info = {
      port: address.port,
      pid: process.pid,
      url: `http://127.0.0.1:${address.port}`,
      startedAt: Date.now(),
      root,
      web: webDir,
      version,
    }
    writeFileSync(serverFile, JSON.stringify(info))
    writeFileSync(portFile, String(address.port))
    console.log(JSON.stringify(info))
  })
  server.listen(wanted, '127.0.0.1')
  const shutdown = () => {
    try {
      const current = readServerFile()
      if (current?.pid === process.pid) unlinkSync(serverFile)
    } catch {
      /* none */
    }
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

/**
 * Whether the running server can stay: it serves these notes, its site is
 * still on disk, and it is this copy or one at least as new. Another copy of
 * the same version (the installed one beside a dev folder) is kept, so two
 * sessions do not take turns replacing each other's server.
 */
async function isCurrent(info) {
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return false
    const health = await response.json()
    if (health.root !== root || typeof health.web !== 'string' || !existsSync(join(health.web, 'index.html'))) return false
    return health.web === webDir || compareVersions(health.version, version) >= 0
  } catch {
    return false
  }
}

/**
 * Holds `<root>/.launch.lock` while `work` runs, so two sessions starting at
 * once start one server; a lock older than 30 s was left by a launcher that died.
 */
async function withLaunchLock(work) {
  mkdirSync(root, { recursive: true })
  for (let waited = 0; ; waited += 100) {
    try {
      mkdirSync(launchLock)
      break
    } catch (error) {
      if (error.code !== 'EEXIST' || waited > 20_000) throw error
      try {
        if (Date.now() - statSync(launchLock).mtimeMs > 30_000) rmSync(launchLock, { recursive: true, force: true })
      } catch {
        /* gone already */
      }
      await sleep(100)
    }
  }
  try {
    return await work()
  } finally {
    rmSync(launchLock, { recursive: true, force: true })
  }
}

async function launch() {
  await withLaunchLock(launchServer)
}

async function launchServer() {
  const current = readServerFile()
  if (current && isAlive(current.pid)) {
    if (await isCurrent(current)) {
      console.log(JSON.stringify(current))
      return
    }
    // A server from an earlier install, or one whose site folder moved: replace it on the same port.
    try {
      process.kill(current.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    for (let waited = 0; waited < 3000 && isAlive(current.pid); waited += 100) {
      await new Promise(r => setTimeout(r, 100))
    }
  }
  mkdirSync(root, { recursive: true })
  const port = current?.port ?? rememberedPort()
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), '--serve', '--root', root, '--web', webDir, '--port', String(port)],
    { detached: true, stdio: 'ignore' },
  )
  child.unref()
  for (let waited = 0; waited < 8000; waited += 100) {
    await new Promise(r => setTimeout(r, 100))
    const info = readServerFile()
    // This child, or a server for these notes that already had the port (the child then left).
    if (info && (info.pid === child.pid || (isAlive(info.pid) && info.root === root)) && (await isHealthy(info))) {
      console.log(JSON.stringify(info))
      return
    }
  }
  console.error('The web notebook server did not start within 8 seconds.')
  process.exit(1)
}

function stop() {
  const current = readServerFile()
  if (!current) {
    console.log(JSON.stringify({ stopped: false, reason: 'not running' }))
    return
  }
  try {
    process.kill(current.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
  try {
    unlinkSync(serverFile)
  } catch {
    /* none */
  }
  console.log(JSON.stringify({ stopped: true, pid: current.pid }))
}

if (args.serve) serve()
else if (args.stop) stop()
else void launch()
