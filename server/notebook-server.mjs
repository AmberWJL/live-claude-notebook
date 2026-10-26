#!/usr/bin/env node
/**
 * Live Notebook's local web server: serves the editor site and reads and
 * writes the markdown note files under `<root>/notes`. Zero dependencies.
 *
 *   node notebook-server.mjs --launch --root <dir> --web <dir>
 *       Starts a detached server (or finds the running one) and prints
 *       `{ "port", "pid", "url", "startedAt" }` as one JSON line.
 *   node notebook-server.mjs --serve  --root <dir> --web <dir> [--port <n>]
 *       Runs the server in the foreground.
 *   node notebook-server.mjs --stop   --root <dir>
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
 * The root is `--root`, else `LIVE_NOTEBOOK_HOME`, else `~/.claude/live-notebook`.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  NOTEBOOK_META_FILE,
  NOTE_TYPES,
  NOTES_DIR,
  SOURCES_DIR,
  TRASH_DIR,
  isNoteId,
  parseNoteFile as parseNote,
  safeFolderName as safeFolder,
  serializeNoteFile as serializeNote,
  slugOf,
  sourcePathFor,
  titleOf,
} from '../src/core/note-format.mjs'
import {
  NoteStoreError,
  createNote,
  listInbox,
  listNotebooks as listNotebooksIn,
  notePathOf,
  readNotebookMeta,
  removeInboxItem,
  resolveRoot,
  saveInboxItem,
  searchNotes,
  touch as touchRoot,
} from '../src/core/note-store.mjs'
import { EXPORT_FORMATS } from '../src/services/export-markdown.mjs'

const args = parseArgs(process.argv.slice(2))
const root = resolveRoot(args.root)
const notesDir = join(root, NOTES_DIR)
const webDir = resolve(args.web ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web'))
const serverFile = join(root, 'server.json')
const portFile = join(root, 'port')
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

/** This copy's version: the plugin's manifest, else the package's (an install from npm or an editor extension). */
function readVersion() {
  for (const manifest of ['../.claude-plugin/plugin.json', '../package.json']) {
    try {
      const found = JSON.parse(readFileSync(fileURLToPath(new URL(manifest, import.meta.url)), 'utf8')).version
      if (typeof found === 'string') return found
    } catch {
      /* the next one */
    }
  }
  return '0.0.0'
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
  return notePathOf(root, rel)
}

function touch() {
  touchRoot(root)
}

function listNotebooks() {
  return listNotebooksIn(root)
}

function writeNotebookMeta(folder, meta) {
  writeFileSync(join(folder, NOTEBOOK_META_FILE), JSON.stringify(meta, null, 2))
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
  writeFileSync(abs, serializeNote(meta, nextContent))
  touch()
  return meta
}

/**
 * Moves a note's file into another notebook's directory (which must exist);
 * its front matter follows. Claude Code matches the moved file by its id.
 */
function moveNote(abs, rel, folderName) {
  const folder = safeFolder(folderName)
  if (folder === undefined) return { status: 400, error: 'bad folder' }
  const { meta, content } = parseNote(readFileSync(abs, 'utf8'))
  if (folder === rel.split('/')[0]) return { status: 200, path: rel, meta }
  if (!existsSync(join(notesDir, folder))) return { status: 404, error: 'notebook not found' }
  const next = `${folder}/${basename(abs)}`
  const nextAbs = safeNotePath(next)
  if (nextAbs === undefined) return { status: 400, error: 'bad path' }
  if (existsSync(nextAbs)) return { status: 409, error: 'a note with that file name is already there' }
  meta.folder = folder
  meta.updated = new Date().toISOString()
  writeFileSync(nextAbs, serializeNote(meta, content))
  unlinkSync(abs)
  touch()
  return { status: 200, path: next, meta }
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
    if (pathname === '/api/health') return send(res, 200, { ok: true, root, web: webDir, version })
    if (pathname === '/api/tree' && req.method === 'GET') return send(res, 200, { notebooks: listNotebooks() })
    if (pathname === '/api/search' && req.method === 'GET') {
      // Every word of every active note, its title and its tags; the tree's previews hold only the opening.
      const query = url.searchParams.get('q') ?? ''
      return send(res, 200, { query, paths: searchNotes(root, query, { limit: 100_000 }).map(found => found.path) })
    }

    // Replies an agent's hook kept (`live-notebook hook`), until filed as a note or dropped.
    if (pathname === '/api/inbox' && req.method === 'GET') return send(res, 200, { items: listInbox(root) })
    if (pathname === '/api/inbox' && req.method === 'POST') {
      const body = await readBody(req)
      return send(res, 201, saveInboxItem(root, body.name, { folder: body.folder, title: body.title }))
    }
    if (pathname === '/api/inbox' && req.method === 'DELETE') {
      removeInboxItem(root, url.searchParams.get('name'))
      return send(res, 200, { ok: true })
    }

    if (pathname === '/api/note') {
      if (req.method === 'POST' && url.searchParams.has('path')) {
        // The page's last save as it closes: sendBeacon can only POST.
        const abs = safeNotePath(url.searchParams.get('path'))
        if (abs === undefined) return send(res, 400, { error: 'bad path' })
        if (!existsSync(abs)) return send(res, 404, { error: 'not found' })
        return send(res, 200, { ok: true, meta: updateNote(abs, await readBody(req)) })
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        if (safeFolder(body.folder) === undefined) return send(res, 400, { error: 'bad folder' })
        const content = typeof body.content === 'string' ? body.content : ''
        // A blank note the page opens to write in, or one made from pasted or dropped text.
        return send(res, 201, createNote(root, { folder: body.folder, content, title: body.title, allowEmpty: true }))
      }
      const abs = safeNotePath(url.searchParams.get('path'))
      if (abs === undefined) return send(res, 400, { error: 'bad path' })
      if (req.method === 'GET') {
        if (!existsSync(abs)) return send(res, 404, { error: 'not found' })
        const { meta, content } = parseNote(readFileSync(abs, 'utf8'))
        return send(res, 200, { path: url.searchParams.get('path'), meta, content })
      }
      if (req.method === 'PUT') {
        if (!existsSync(abs)) return send(res, 404, { error: 'not found' })
        const body = await readBody(req)
        const rel = url.searchParams.get('path')
        let meta = updateNote(abs, body)
        let path = rel
        if (typeof body.folder === 'string') {
          // Moved to another notebook: the file changes directory.
          const moved = moveNote(abs, rel, body.folder)
          if (moved.status !== 200) return send(res, moved.status, { error: moved.error })
          path = moved.path
          meta = moved.meta
        }
        return send(res, 200, { ok: true, path, meta })
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
      const body = await readBody(req)
      const folder = safeFolder(body.name)
      if (folder === undefined) return send(res, 400, { error: 'bad folder' })
      mkdirSync(join(notesDir, folder), { recursive: true })
      touch()
      return send(res, 201, { name: folder })
    }

    if (pathname === '/api/notebook' && req.method === 'PUT') {
      const body = await readBody(req)
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
      if (from !== to && existsSync(toDir)) return send(res, 409, { error: 'a notebook with that name exists' })
      if (from !== to) renameSync(fromDir, toDir)
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
  } catch (error) {
    if (error instanceof NoteStoreError) {
      return send(res, error.code === 'not-found' ? 404 : 400, { error: error.message, code: error.code })
    }
    return send(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

function serve() {
  mkdirSync(notesDir, { recursive: true })
  const server = createServer((req, res) => void handle(req, res))
  const wanted = args.port !== undefined ? Number(args.port) : rememberedPort()
  let attempts = 0
  server.on('error', error => {
    if (error.code !== 'EADDRINUSE' || wanted === 0) throw error
    // A server being replaced may hold the port a moment longer; past that, any free port.
    attempts += 1
    setTimeout(() => server.listen(attempts < 15 ? wanted : 0, '127.0.0.1'), 200)
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

async function launch() {
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
    if (info && info.pid === child.pid && (await isHealthy(info))) {
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
