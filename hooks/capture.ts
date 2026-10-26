import type { SessionMessage } from 'claude-code'

import type {
  AppendedRow,
  CaptureContext,
  CaptureDraft,
  MessageCandidate,
  SourceReference,
} from '../types'
import { normalizeContent } from '../src/utils/normalize-content'

/** How many appended rows are fingerprinted for message-id matching. */
export const ROWS_LIMIT = 120
const FINGERPRINT_CHARS = 160

type Message = Pick<SessionMessage, 'role' | 'text'>

export function fingerprint(text: string): Pick<AppendedRow, 'length' | 'head' | 'tail'> {
  return {
    length: text.length,
    head: text.slice(0, FINGERPRINT_CHARS),
    tail: text.slice(-FINGERPRINT_CHARS),
  }
}

/**
 * Best-effort: the row id of a transcript message, matched by role and text
 * fingerprint against the rows seen at `session.append`. Undefined when no
 * single row matches (a reply split across blocks, a resumed session).
 */
export function matchRow(rows: readonly AppendedRow[], role: AppendedRow['role'], text: string): string | undefined {
  const fp = fingerprint(text)
  const found = rows.filter(
    row => row.role === role && row.length === fp.length && row.head === fp.head && row.tail === fp.tail,
  )
  return found.length === 1 ? found[0]?.uuid : undefined
}

/**
 * Which transcript message a captured text came from: the last message whose
 * text is exactly it, else the last whose text contains it; -1 when none.
 */
export function findMessageIndex(messages: readonly Message[], text: string): number {
  const needle = text.trim()
  if (needle === '') return -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.text.trim() === needle) return index
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.text.includes(needle)) return index
  }
  return -1
}

export type DraftResult = { ok: true; draft: CaptureDraft } | { ok: false; message: string }

export type CaptureMeta = {
  draftId: string
  capturedAt: number
  sessionId: string
  folder: string
  context?: CaptureContext
}

/**
 * A draft from raw text and what is known of its source. The snapshot keeps
 * the raw text; the editable content is the normalized text.
 */
export function draftFrom(
  raw: string,
  source: Omit<SourceReference, 'snapshot' | 'capturedAt' | 'sessionId' | 'context'>,
  meta: CaptureMeta,
): DraftResult {
  const normalized = normalizeContent(raw)
  if (!normalized.ok) return { ok: false, message: normalized.message }
  const reference: SourceReference = {
    ...source,
    sessionId: meta.sessionId,
    snapshot: raw,
    capturedAt: meta.capturedAt,
  }
  if (meta.context !== undefined) reference.context = meta.context
  return {
    ok: true,
    draft: { id: meta.draftId, content: normalized.content, folder: meta.folder, source: reference },
  }
}

export function draftFromCandidate(candidate: MessageCandidate, meta: CaptureMeta): DraftResult {
  const source: Omit<SourceReference, 'snapshot' | 'capturedAt' | 'sessionId' | 'context'> = {
    captureMode: 'whole_message',
    role: candidate.role,
  }
  if (candidate.messageId !== undefined) source.messageId = candidate.messageId
  return draftFrom(candidate.text, source, meta)
}

export function draftFromExcerpt(
  text: string,
  origin: { messageId?: string; role?: SourceReference['role'] },
  meta: CaptureMeta,
): DraftResult {
  const source: Omit<SourceReference, 'snapshot' | 'capturedAt' | 'sessionId' | 'context'> = { captureMode: 'excerpt' }
  if (origin.messageId !== undefined) source.messageId = origin.messageId
  if (origin.role !== undefined) source.role = origin.role
  return draftFrom(text, source, meta)
}
