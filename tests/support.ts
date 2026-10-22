/**
 * What the hook tests stand on: the engine beneath the plugin, answered from
 * memory. Each call on `$` is an op event a test hook answers with `{ value }`.
 */
import type { On, SessionMessage } from 'claude-code'
import { mock } from 'claude-code/testing'

export const PLUGIN = 'live-notebook'
export const PANE = 'live-notebook'
export const HOME = '/home/t'
export const ROOT = `${HOME}/.claude/live-notebook`
export const NOTES = `${ROOT}/notes`

export const PANE_PROPS = {
  title: 'Live Notebook',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

export const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
} as const

export const START = { cwd: '/tmp/live-notebook-test', surface: 'terminal', isInteractive: true } as const

/** `$.store` answered from a Map the test can read; a write can be made to fail. */
export function fakeStore(on: On, initial: Record<string, unknown> = {}, options: { failSetMatching?: RegExp } = {}) {
  const data = new Map<string, unknown>(Object.entries(initial))
  on('store.get', async (_$, e) => ({ value: data.get(e.key) }))
  on('store.set', async (_$, e) => {
    if (options.failSetMatching?.test(e.key)) throw new Error('disk full')
    data.set(e.key, structuredClone(e.value))
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => {
    data.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', async () => ({ value: [...data.keys()] }))
  return data
}

export type FakeFile = { text: string; mtimeMs: number }

/** `$.fs` over a Map of absolute paths; directories are implied by their files. */
export function fakeFs(on: On, initial: Record<string, string> = {}) {
  let tick = 1_000
  const files = new Map<string, FakeFile>()
  for (const [path, text] of Object.entries(initial)) files.set(path, { text, mtimeMs: (tick += 1) })
  const isDir = (path: string) => [...files.keys()].some(one => one.startsWith(`${path}/`))
  const children = (path: string) => {
    const seen = new Map<string, { kind: 'file' | 'dir'; mtimeMs: number; size: number }>()
    for (const [one, file] of files) {
      if (!one.startsWith(`${path}/`)) continue
      const rest = one.slice(path.length + 1)
      const name = rest.split('/')[0] ?? rest
      if (rest.includes('/')) seen.set(name, { kind: 'dir', mtimeMs: 0, size: 0 })
      else seen.set(name, { kind: 'file', mtimeMs: file.mtimeMs, size: file.text.length })
    }
    return [...seen].map(([name, meta]) => ({ name, ...meta, isLink: false }))
  }
  on('fs.write', async (_$, e) => {
    files.set(e.path, { text: e.text, mtimeMs: (tick += 1) })
    return { value: undefined }
  })
  on('fs.read', async (_$, e) => {
    const file = files.get(e.path)
    if (file === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: file.text }
  })
  on('fs.exists', async (_$, e) => ({ value: files.has(e.path) || isDir(e.path) }))
  on('fs.stat', async (_$, e) => {
    const file = files.get(e.path)
    if (file !== undefined) return { value: { kind: 'file' as const, size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
    if (isDir(e.path)) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false } }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.list', async (_$, e) => {
    const path = e.path ?? ''
    if (!isDir(path)) throw new Error(`ENOENT: ${path}`)
    return { value: children(path) }
  })
  return {
    files,
    /** What the web server does after a write: a later time on the file and the touch mark. */
    writeFromWeb(path: string, text: string) {
      files.set(path, { text, mtimeMs: (tick += 1) })
      files.set(`${NOTES}/.touch`, { text: String(tick), mtimeMs: (tick += 1) })
    },
    read: (path: string) => files.get(path)?.text,
  }
}

/** The rest of the engine beneath the plugin: session, commands, UI, model, processes. */
export function fakeEngine(on: On, messages: SessionMessage[] = [], options: { tags?: string; type?: string } = {}) {
  const registered: string[] = []
  const opened: string[] = []
  const toasts: string[] = []
  const prompts: string[] = []
  const commands: string[][] = []
  mock.env(on, { HOME })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('command.register', async (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.id', async () => ({ value: 'session-test' }))
  on('session.root', async () => ({ value: '/tmp/live-notebook-test' }))
  on('session.messages', async () => ({ value: messages }))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.selection', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('model.complete', async (_$, e) => {
    prompts.push(e.prompt)
    const isClassify = e.prompt.startsWith('Classify')
    return {
      value: {
        isAnswered: true as const,
        text: isClassify ? (options.type ?? 'type: insight\ntags: caching, ttl') : (options.tags ?? 'Live Claude Notebook, caching, TTL'),
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('process.run', async (_$, e) => {
    commands.push([...e.argv])
    const argv = e.argv
    let stdout = ''
    if (argv[0] === 'node' && argv.includes('--launch')) {
      stdout = JSON.stringify({ port: 4321, pid: 999, url: 'http://127.0.0.1:4321', startedAt: 1 })
    } else if (argv[0] === 'node' && argv.includes('--stop')) {
      stdout = JSON.stringify({ stopped: true, pid: 999 })
    }
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { registered, opened, toasts, prompts, commands }
}

export function entryKeys(data: Map<string, unknown>): string[] {
  return [...data.keys()].filter(key => key.startsWith('entry:'))
}

export function firstEntry(data: Map<string, unknown>): Record<string, unknown> {
  return data.get(entryKeys(data)[0] ?? '') as Record<string, unknown>
}
