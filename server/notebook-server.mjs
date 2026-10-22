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
 * It binds to 127.0.0.1 only. Every file path a request names is checked to
 * lie under the notes directory.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = parseArgs(process.argv.slice(2))
const root = resolve(args.root ?? join(process.env.HOME ?? '.', '.claude', 'live-notebook'))
const notesDir = join(root, 'notes')
const webDir = resolve(args.web ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web'))
const serverFile = join(root, 'server.json')
const touchFile = join(notesDir, '.touch')

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
  if (typeof rel !== 'string' || !/^[^/\\]+\/[^/\\]+\.md$/.test(rel) || rel.includes('..')) return undefined
  const abs = resolve(notesDir, rel)
  if (!abs.startsWith(notesDir + sep)) return undefined
  return abs
}

function safeFolder(name) {
  if (typeof name !== 'string') return undefined
  const folder = name.replace(/\s+/g, ' ').trim()
  if (folder === '' || folder.length > 40 || /[/\\]/.test(folder) || folder.startsWith('.') || folder.includes('..')) {
    return undefined
  }
  return folder
}

function parseNote(text) {
  const normalized = text.replace(/\r\n?/g, '\n')
  const meta = {}
  if (!normalized.startsWith('---\n')) return { meta, content: normalized }
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) return { meta, content: normalized }
  const head = normalized.slice(4, end)
  let content = normalized.slice(end + 4)
  if (content.startsWith('\n')) content = content.slice(1)
  if (content.startsWith('\n')) content = content.slice(1)
  for (const line of head.split('\n')) {
    const match = /^([a-zA-Z_]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    const raw = match[2].trim()
    let value = raw
    if (raw.startsWith('"')) {
      try {
        value = String(JSON.parse(raw))
      } catch {
        value = raw.slice(1, -1)
      }
    }
    if (key === 'archived') meta.archived = value === 'true'
    else if (value !== '') meta[key] = value
  }
  return { meta, content: content.replace(/\n$/, '') }
}

function serializeNote(meta, content) {
  const lines = ['---']
  for (const key of ['id', 'title', 'folder', 'type', 'created', 'updated', 'captured', 'session']) {
    if (meta[key] === undefined) continue
    lines.push(`${key}: ${key === 'title' || key === 'folder' ? JSON.stringify(meta[key]) : meta[key]}`)
  }
  if (meta.archived === true) lines.push('archived: true')
  lines.push('---', '', content, '')
  return lines.join('\n')
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
    let tags = []
    try {
      const meta = JSON.parse(readFileSync(join(folder, '_notebook.json'), 'utf8'))
      if (Array.isArray(meta.tags)) tags = meta.tags.filter(tag => typeof tag === 'string').slice(0, 3)
    } catch {
      /* none */
    }
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
        preview: content.replace(/\s+/g, ' ').trim().slice(0, 140),
      })
    }
    notes.sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
    notebooks.push({ name: dir.name, tags, count: notes.length, notes })
  }
  notebooks.sort((a, b) => a.name.localeCompare(b.name))
  return notebooks
}

function titleOf(content) {
  const line = content
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !l.startsWith('```'))
  if (line === undefined) return undefined
  const cleaned = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*>]\s+/, '')
    .replace(/[`*_]/g, '')
    .trim()
  return cleaned === '' ? undefined : cleaned.slice(0, 80)
}

function slugOf(text) {
  const slug = String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug === '' ? 'note' : slug
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
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > 4_000_000) reject(new Error('body too large'))
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
  res.writeHead(200, { 'content-type': TYPES[extname(abs)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(readFileSync(abs))
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const { pathname } = url
  try {
    if (pathname === '/api/health') return send(res, 200, { ok: true, root, web: webDir })
    if (pathname === '/api/tree' && req.method === 'GET') return send(res, 200, { notebooks: listNotebooks() })

    if (pathname === '/api/note') {
      if (req.method === 'POST') {
        const body = await readBody(req)
        const folder = safeFolder(body.folder)
        if (folder === undefined) return send(res, 400, { error: 'bad folder' })
        const content = typeof body.content === 'string' ? body.content : ''
        const given = typeof body.title === 'string' && body.title.trim() !== '' && body.title.trim() !== 'Untitled'
        const title = given ? body.title.trim() : (titleOf(content) ?? 'Untitled')
        const id = randomUUID()
        const now = new Date().toISOString()
        const rel = `${folder}/${slugOf(title)}--${id.slice(0, 8)}.md`
        const abs = safeNotePath(rel)
        if (abs === undefined) return send(res, 400, { error: 'bad path' })
        mkdirSync(join(notesDir, folder), { recursive: true })
        const meta = { id, title, folder, created: now, updated: now, captured: 'excerpt' }
        writeFileSync(abs, serializeNote(meta, content))
        touch()
        return send(res, 201, { path: rel, meta, content })
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
        const { meta, content } = parseNote(readFileSync(abs, 'utf8'))
        const nextContent = typeof body.content === 'string' ? body.content.replace(/\r\n?/g, '\n') : content
        if (typeof body.title === 'string' && body.title.trim() !== '' && body.title.trim() !== 'Untitled') {
          meta.title = body.title.trim()
        } else if (body.title === '' || meta.title === undefined || meta.title === 'Untitled') {
          // No title of the person's own: the first line of the text names the note.
          meta.title = titleOf(nextContent) ?? 'Untitled'
        }
        meta.updated = new Date().toISOString()
        writeFileSync(abs, serializeNote(meta, nextContent))
        touch()
        return send(res, 200, { ok: true, meta })
      }
      if (req.method === 'DELETE') {
        if (!existsSync(abs)) return send(res, 404, { error: 'not found' })
        const { meta, content } = parseNote(readFileSync(abs, 'utf8'))
        meta.archived = true
        meta.updated = new Date().toISOString()
        writeFileSync(abs, serializeNote(meta, content))
        touch()
        return send(res, 200, { ok: true })
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
      // Rename: the directory moves and every note's front matter follows.
      const body = await readBody(req)
      const from = safeFolder(body.name)
      const to = safeFolder(body.newName)
      if (from === undefined || to === undefined) return send(res, 400, { error: 'bad folder' })
      const fromDir = join(notesDir, from)
      const toDir = join(notesDir, to)
      if (!existsSync(fromDir)) return send(res, 404, { error: 'not found' })
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
        const metaFile = join(toDir, '_notebook.json')
        const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {}
        writeFileSync(metaFile, JSON.stringify({ ...meta, name: to }, null, 2))
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
      const trash = join(root, 'trash')
      mkdirSync(trash, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(dir, join(trash, `${folder}--${stamp}`))
      touch()
      return send(res, 200, { ok: true, trashed: `trash/${folder}--${stamp}` })
    }

    if (pathname === '/api/export' && req.method === 'GET') {
      const folder = safeFolder(url.searchParams.get('name'))
      if (folder === undefined) return send(res, 400, { error: 'bad folder' })
      const notebook = listNotebooks().find(one => one.name === folder)
      if (!notebook) return send(res, 404, { error: 'not found' })
      const parts = [`# ${folder}`, '']
      if (notebook.tags.length > 0) parts.push(notebook.tags.map(tag => `#${tag}`).join(' '), '')
      parts.push(`_Exported from Live Notebook on ${new Date().toISOString().slice(0, 10)} · ${notebook.count} ${notebook.count === 1 ? 'note' : 'notes'}_`, '')
      for (const note of notebook.notes) {
        const { meta, content } = parseNote(readFileSync(join(notesDir, note.path), 'utf8'))
        const facts = [meta.type, meta.created ? `created ${meta.created.slice(0, 10)}` : null, meta.captured === 'whole_message' ? 'from a message' : null]
          .filter(Boolean)
          .join(' · ')
        parts.push('---', '', `## ${note.title}`, '')
        if (facts) parts.push(`_${facts}_`, '')
        parts.push(content, '')
      }
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${slugOf(folder)}.md"`,
        'cache-control': 'no-store',
      })
      return res.end(parts.join('\n'))
    }

    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' })
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' })
    return serveStatic(res, pathname)
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

function serve() {
  mkdirSync(notesDir, { recursive: true })
  const server = createServer((req, res) => void handle(req, res))
  const port = Number(args.port ?? 0)
  server.listen(port, '127.0.0.1', () => {
    const address = server.address()
    const info = {
      port: address.port,
      pid: process.pid,
      url: `http://127.0.0.1:${address.port}`,
      startedAt: Date.now(),
      root,
      web: webDir,
    }
    writeFileSync(serverFile, JSON.stringify(info))
    console.log(JSON.stringify(info))
  })
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

/** Whether the running server serves this site from these folders; an older one is replaced. */
async function isCurrent(info) {
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return false
    const health = await response.json()
    return health.root === root && health.web === webDir && existsSync(join(webDir, 'index.html'))
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
    // A server from an earlier install, or one whose site folder moved: replace it.
    try {
      process.kill(current.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    await new Promise(r => setTimeout(r, 300))
  }
  mkdirSync(root, { recursive: true })
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), '--serve', '--root', root, '--web', webDir],
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
