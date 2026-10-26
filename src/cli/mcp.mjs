/**
 * `live-notebook mcp`: a Model Context Protocol server over stdio, so any
 * agent that speaks MCP (Claude Code, Cursor, VS Code, Codex, Gemini CLI)
 * can save a note to the notes folder and find notes again. JSON-RPC 2.0,
 * one message a line; no dependencies. Nothing leaves the machine: the
 * tools read and write local files only.
 */
import { createInterface } from 'node:readline'

import { NOTE_TYPES } from '../core/note-format.mjs'
import { NoteStoreError, createNote, listNotebooks, readNote, searchNotes } from '../core/note-store.mjs'

/** The protocol revisions this server speaks, newest first; a client asking for another gets the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = [
  "Live Notebook keeps the user's notes from AI coding sessions as Markdown files on their own computer.",
  'Use save_note when the user asks to save, keep or note something; pass the text verbatim unless they ask for a summary.',
  'Use search_notes, then read_note, when they ask what they saved before or when an earlier note would help.',
].join(' ')

export const TOOLS = [
  {
    name: 'save_note',
    title: 'Save a note',
    description:
      "Saves text to the user's Live Notebook as a Markdown note. When the user asks to save a reply, or part of one, pass that text exactly as written (code blocks included), not a summary, unless they ask for one.",
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The note text, in Markdown.' },
        title: { type: 'string', description: 'A short title. Omit it to use the first line.' },
        notebook: { type: 'string', description: 'The notebook (folder) to save in, 1 to 40 characters. Omit it for "General".' },
        type: { type: 'string', enum: NOTE_TYPES, description: 'insight, learning, reference or other.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'A few short tags.' },
      },
      required: ['content'],
      additionalProperties: false,
    },
    annotations: { title: 'Save a note', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'search_notes',
    title: 'Search notes',
    description: "Finds the user's notes whose title, text or tags contain the query (case-insensitive), newest first.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for; one word or a short phrase works best.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many results, 10 by default.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { title: 'Search notes', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_note',
    title: 'Read a note',
    description: 'Reads one note in full, by the path search_notes or list_notebooks gave.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'The note path, as <Notebook>/<file>.md.' } },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { title: 'Read a note', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_notebooks',
    title: 'List notebooks',
    description: "Lists the user's notebooks with their note counts and newest note titles.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List notebooks', readOnlyHint: true, openWorldHint: false },
  },
]

/** A client's name as a note's `agent`: `Cursor` → `cursor`, `claude-code`, `visual-studio-code`. */
export function agentOf(clientInfo) {
  const name = String(clientInfo?.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return name === '' ? 'mcp' : name
}

function text(value, isError = false) {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) }
}

/** Runs one tool; a bad argument or a refused write is a tool error the model can read, not a protocol error. */
export function callTool(root, name, args = {}, context = {}) {
  try {
    if (name === 'save_note') {
      if (typeof args.content !== 'string') return text('content must be a string.', true)
      const note = createNote(root, {
        folder: typeof args.notebook === 'string' && args.notebook.trim() !== '' ? args.notebook : undefined,
        content: args.content,
        title: typeof args.title === 'string' ? args.title : undefined,
        type: args.type,
        tags: Array.isArray(args.tags) ? args.tags : undefined,
        agent: context.agent ?? 'mcp',
      })
      return text(`Saved to ${note.meta.folder}: "${note.meta.title}" (${note.path}).`)
    }
    if (name === 'search_notes') {
      if (typeof args.query !== 'string' || args.query.trim() === '') return text('query must be a non-empty string.', true)
      const limit = Number.isInteger(args.limit) ? Math.min(50, Math.max(1, args.limit)) : 10
      const results = searchNotes(root, args.query, { limit })
      if (results.length === 0) return text(`No notes match "${args.query}".`)
      const lines = results.map(found => `- ${found.notebook} › ${found.title} (${found.path})${found.tags.length > 0 ? ` [${found.tags.join(', ')}]` : ''}\n  ${found.snippet}`)
      return text(`${results.length} note${results.length === 1 ? '' : 's'} match "${args.query}":\n${lines.join('\n')}`)
    }
    if (name === 'read_note') {
      const note = readNote(root, args.path)
      if (note === undefined || note.meta.archived === true) return text(`No note at ${String(args.path)}.`, true)
      const facts = [
        `Title: ${note.meta.title ?? note.path}`,
        `Notebook: ${note.path.split('/')[0]}`,
        ...(note.meta.type !== undefined ? [`Type: ${note.meta.type}`] : []),
        ...(note.meta.tags !== undefined ? [`Tags: ${note.meta.tags.join(', ')}`] : []),
        ...(note.meta.updated !== undefined ? [`Updated: ${note.meta.updated}`] : []),
      ]
      return text(`${facts.join('\n')}\n\n${note.content}`)
    }
    if (name === 'list_notebooks') {
      const notebooks = listNotebooks(root)
      if (notebooks.length === 0) return text('There are no notebooks yet.')
      const lines = notebooks.map(notebook => {
        const newest = notebook.notes.slice(0, 3).map(note => `"${note.title}"`).join(', ')
        return `- ${notebook.name}: ${notebook.count} note${notebook.count === 1 ? '' : 's'}${newest === '' ? '' : `, newest ${newest}`}`
      })
      return text(lines.join('\n'))
    }
    return undefined
  } catch (error) {
    if (error instanceof NoteStoreError) return text(error.message, true)
    throw error
  }
}

/**
 * Answers one JSON-RPC message; undefined for a notification. `session`
 * carries what initialize learned (the client, for notes' `agent`).
 */
export function handleMessage(message, { root, version }, session = {}) {
  const isObject = message !== null && typeof message === 'object' && !Array.isArray(message)
  const isRequest = isObject && message.id !== undefined && message.id !== null
  const reply = result => (isRequest ? { jsonrpc: '2.0', id: message.id, result } : undefined)
  const fail = (code, errorMessage) => (isRequest ? { jsonrpc: '2.0', id: message.id, error: { code, message: errorMessage } } : undefined)
  if (!isObject || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { jsonrpc: '2.0', id: isRequest ? message.id : null, error: { code: -32600, message: 'Invalid request' } }
  }
  const params = message.params ?? {}
  switch (message.method) {
    case 'initialize': {
      session.agent = agentOf(params.clientInfo)
      const asked = params.protocolVersion
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'live-notebook', title: 'Live Notebook', version },
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'tools/call': {
      const result = callTool(root, params.name, params.arguments ?? {}, session)
      return result === undefined ? fail(-32602, `Unknown tool: ${String(params.name)}`) : reply(result)
    }
    default:
      if (message.method.startsWith('notifications/')) return undefined
      return fail(-32601, `Method not found: ${message.method}`)
  }
}

/** Serves MCP on stdin and stdout until stdin closes. Logs go to stderr; stdout carries only messages. */
export function serveMcp({ root, version, input = process.stdin, output = process.stdout }) {
  const session = {}
  const write = message => output.write(`${JSON.stringify(message)}\n`)
  const lines = createInterface({ input, crlfDelay: Infinity })
  lines.on('line', line => {
    if (line.trim() === '') return
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed]
    const replies = []
    for (const one of messages) {
      try {
        const answer = handleMessage(one, { root, version }, session)
        if (answer !== undefined) replies.push(answer)
      } catch (error) {
        process.stderr.write(`live-notebook mcp: ${error instanceof Error ? error.stack : String(error)}\n`)
        if (one?.id !== undefined && one?.id !== null) replies.push({ jsonrpc: '2.0', id: one.id, error: { code: -32603, message: 'Internal error' } })
      }
    }
    if (Array.isArray(parsed)) {
      if (replies.length > 0) write(replies)
    } else if (replies[0] !== undefined) write(replies[0])
  })
  return new Promise(resolveClosed => lines.on('close', resolveClosed))
}
