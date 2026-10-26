#!/usr/bin/env node
/**
 * `live-notebook`: Live Notebook without Claude Code. Opens the web
 * notebook, saves text as a note, searches notes, keeps an agent's replies
 * from its hooks, and serves the notes to any agent over MCP. Everything
 * stays in the notes folder on this computer. No dependencies.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { projectNameOf } from '../src/core/note-format.mjs'
import { NoteStoreError, createNote, resolveRoot, searchNotes } from '../src/core/note-store.mjs'
import { keepReply, readStdin } from '../src/cli/hook.mjs'
import { serveMcp } from '../src/cli/mcp.mjs'
import { openUrl, readClipboard } from '../src/cli/platform.mjs'

const SERVER = fileURLToPath(new URL('../server/notebook-server.mjs', import.meta.url))

const HELP = `live-notebook: your notes from AI coding sessions, as Markdown files on this computer.

Usage:
  live-notebook open                      Start the web notebook and open it in the browser
  live-notebook save [text...]            Save text as a note (or pipe it in on stdin)
      -c, --clipboard                       Save what is on the clipboard
      -f, --file <path>                     Save a file's text
      -n, --notebook <name>                 The notebook to save in (default General)
      -t, --title <title>                   A title (default: the first line)
          --type <type>                     insight, learning, reference or other
          --tag <tag>                       A tag; repeat for more
  live-notebook search <words>            Find notes by title, text or tag
          --limit <n>                       At most n results (default 20)
          --json                            Print JSON
  live-notebook mcp                       Serve the notes to an agent over MCP (stdio)
  live-notebook hook [--agent <name>]     Keep the reply in an agent hook's input in the inbox
  live-notebook path                      Print the notes folder
  live-notebook serve | stop              Run the web notebook in the foreground, or stop it

Every command takes --root <folder>; else LIVE_NOTEBOOK_HOME, else ~/.claude/live-notebook.
`

function version() {
  try {
    return String(JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version)
  } catch {
    return '0.0.0'
  }
}

/** Flags and words: `--name value`, `--flag`, `-x value`, repeated flags collected; the rest in order. */
function parseArgs(argv, { booleans = [], aliases = {} } = {}) {
  const flags = {}
  const words = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      words.push(...argv.slice(i + 1))
      break
    }
    if (!arg.startsWith('-') || arg === '-') {
      words.push(arg)
      continue
    }
    const name = aliases[arg] ?? arg.replace(/^--?/, '')
    let value = true
    if (!booleans.includes(name)) {
      value = argv[i + 1]
      i += 1
      if (value === undefined) throw new Error(`--${name} needs a value.`)
    }
    if (flags[name] === undefined) flags[name] = value
    else flags[name] = [...[flags[name]].flat(), value]
  }
  return { flags, words }
}

function launchServer(root) {
  const run = spawnSync(process.execPath, [SERVER, '--launch', '--root', root], { encoding: 'utf8', timeout: 20_000 })
  const line = run.stdout
    ?.split('\n')
    .map(one => one.trim())
    .filter(one => one.startsWith('{'))
    .pop()
  if (run.status !== 0 || line === undefined) throw new Error(`The web notebook did not start. ${run.stderr?.trim() ?? ''}`.trim())
  return JSON.parse(line)
}

async function save(root, flags, words) {
  let content
  if (flags.clipboard === true) content = readClipboard()
  else if (typeof flags.file === 'string') content = readFileSync(resolve(flags.file), 'utf8')
  else if (words.length > 0 && !(words.length === 1 && words[0] === '-')) content = words.join(' ')
  else if (!process.stdin.isTTY || words[0] === '-') content = await readStdin(60_000)
  else throw new Error('Nothing to save: give the text, --clipboard, --file <path>, or pipe it in.')
  const note = createNote(root, {
    folder: typeof flags.notebook === 'string' ? flags.notebook : undefined,
    title: typeof flags.title === 'string' ? flags.title : undefined,
    type: flags.type,
    tags: flags.tag === undefined ? undefined : [flags.tag].flat(),
    content,
    agent: 'cli',
    project: projectNameOf(process.cwd()),
  })
  if (flags.json === true) console.log(JSON.stringify(note))
  else console.log(`Saved to ${note.meta.folder}: ${note.meta.title}\n${resolve(root, 'notes', note.path)}`)
}

function search(root, flags, words) {
  const query = words.join(' ')
  if (query.trim() === '') throw new Error('Search for what? live-notebook search <words>')
  const limit = flags.limit === undefined ? 20 : Number.parseInt(String(flags.limit), 10)
  const results = searchNotes(root, query, { limit: Number.isFinite(limit) ? limit : 20 })
  if (flags.json === true) {
    console.log(JSON.stringify(results, null, 2))
    return
  }
  if (results.length === 0) {
    console.log(`No notes match "${query}".`)
    return
  }
  for (const found of results) console.log(`${found.notebook} › ${found.title}\n  ${found.snippet}\n  ${resolve(root, 'notes', found.path)}\n`)
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv
  const { flags, words } = parseArgs(rest, {
    booleans: ['clipboard', 'json', 'help'],
    aliases: { '-c': 'clipboard', '-f': 'file', '-n': 'notebook', '-t': 'title', '-h': 'help' },
  })
  const root = resolveRoot(typeof flags.root === 'string' ? flags.root : undefined)
  switch (command) {
    case 'open': {
      const info = launchServer(root)
      if (!openUrl(info.url)) console.log('Could not open a browser.')
      console.log(`Live Notebook: ${info.url}`)
      return
    }
    case 'serve': {
      const run = spawnSync(process.execPath, [SERVER, '--serve', '--root', root, ...(flags.port === undefined ? [] : ['--port', String(flags.port)])], { stdio: 'inherit' })
      process.exitCode = run.status ?? 1
      return
    }
    case 'stop': {
      const run = spawnSync(process.execPath, [SERVER, '--stop', '--root', root], { stdio: 'inherit' })
      process.exitCode = run.status ?? 1
      return
    }
    case 'save':
      return save(root, flags, words)
    case 'search':
      return search(root, flags, words)
    case 'path':
      console.log(root)
      return
    case 'mcp':
      return serveMcp({ root, version: version() })
    case 'hook': {
      // Never fail the agent: a reply that cannot be kept is dropped quietly (stderr says why).
      try {
        keepReply(root, await readStdin(), typeof flags.agent === 'string' ? flags.agent : undefined)
      } catch (error) {
        process.stderr.write(`live-notebook hook: ${error instanceof Error ? error.message : String(error)}\n`)
      }
      return
    }
    case '--version':
    case '-v':
    case 'version':
      console.log(version())
      return
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP)
      return
    default:
      throw new Error(`Unknown command: ${command}. Run live-notebook help.`)
  }
}

main().catch(error => {
  process.stderr.write(`live-notebook: ${error instanceof NoteStoreError || error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
