/**
 * `live-notebook hook`: the command an agent's hook runs after each reply,
 * which keeps the reply's text in the inbox (`<root>/inbox/`, the newest 50)
 * for the person to file as a note from the web notebook, word for word.
 * Opt-in: it runs only where the person added it to an agent's hooks.
 * It never fails the agent: whatever goes wrong, it exits 0 and prints
 * nothing on stdout.
 */
import { projectNameOf } from '../core/note-format.mjs'
import { addToInbox } from '../core/note-store.mjs'

/**
 * The reply in a hook's input, and which agent sent it:
 * Cursor's `afterAgentResponse` (`text`), Gemini CLI's `AfterAgent`
 * (`prompt_response`), and a `Stop` hook's `last_assistant_message`
 * (Claude Code, Codex). Undefined when the input holds no reply.
 */
export function replyOf(input, agentFlag) {
  if (input === null || typeof input !== 'object') return undefined
  const event = String(input.hook_event_name ?? '')
  let text
  let agent
  if (typeof input.last_assistant_message === 'string') {
    text = input.last_assistant_message
    agent = 'claude-code'
  } else if (event === 'afterAgentResponse' || (typeof input.text === 'string' && event === '')) {
    text = input.text
    agent = 'cursor'
  } else if (typeof input.prompt_response === 'string') {
    text = input.prompt_response
    agent = 'gemini'
  }
  if (typeof text !== 'string' || text.trim() === '') return undefined
  const named = typeof agentFlag === 'string' && /^[a-z0-9-]{1,32}$/.test(agentFlag) ? agentFlag : agent
  const cwd = typeof input.cwd === 'string' ? input.cwd : Array.isArray(input.workspace_roots) ? input.workspace_roots[0] : undefined
  const reply = { agent: named, text }
  const project = projectNameOf(cwd)
  if (project !== undefined) reply.project = project
  return reply
}

/** Reads stdin to its end, or gives up after `ms` (a hook that sent nothing). */
export function readStdin(ms = 3_000, input = process.stdin) {
  return new Promise(resolveRead => {
    let data = ''
    const timer = setTimeout(() => resolveRead(data), ms)
    input.setEncoding('utf8')
    input.on('data', chunk => {
      data += chunk
    })
    input.on('end', () => {
      clearTimeout(timer)
      resolveRead(data)
    })
    input.on('error', () => {
      clearTimeout(timer)
      resolveRead(data)
    })
  })
}

/** Keeps the reply a hook's input carries; returns the inbox item's name, or undefined when there was none. */
export function keepReply(root, raw, agentFlag) {
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    return undefined
  }
  const reply = replyOf(input, agentFlag)
  return reply === undefined ? undefined : addToInbox(root, reply)
}
