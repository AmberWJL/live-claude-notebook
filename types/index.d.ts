/**
 * Live Notebook: the data model and the plugin's state contract.
 *
 * Self-contained on purpose: `claude plugin validate` reads this file as the
 * contract for every `$.state` key the hooks module names. The domain types
 * live here so that the hooks module, the services and the tests share one
 * definition.
 */

export type EntryType = 'insight' | 'learning' | 'idea' | 'decision' | 'reference' | 'other'

export type CaptureMode = 'whole_message' | 'excerpt'

export type SourceRole = 'user' | 'assistant' | 'tool' | 'unknown'

/** One neighbouring transcript message, kept beside a capture as context. */
export type ContextMessage = {
  role: 'user' | 'assistant'
  text: string
}

/**
 * What surrounded the captured message when it was saved: the messages just
 * before and after it (each cut to a bounded length) and the project the
 * session ran in. Recorded automatically; never edited.
 */
export type CaptureContext = {
  before: ContextMessage[]
  after: ContextMessage[]
  cwd?: string
}

export type SourceReference = {
  sessionId?: string
  messageId?: string
  role?: SourceRole
  captureMode: CaptureMode
  /** The unmodified text as captured. Never edited after capture. */
  snapshot: string
  capturedAt: number
  startOffset?: number
  endOffset?: number
  context?: CaptureContext
}

export type EntryStatus = 'confirmed' | 'archived'

export type NotebookEntry = {
  schemaVersion: 1
  id: string
  title: string
  content: string
  /** The notebook the entry files under. */
  folder: string
  type: EntryType
  tags: string[]
  sources: SourceReference[]
  status: EntryStatus
  createdAt: number
  updatedAt: number
  /** The entry's markdown file, relative to the notes root (`<Notebook>/<name>.md`). */
  file?: string
}

/** The notebooks a person has made, and the one they last saved into. */
export type FoldersRecord = {
  names: string[]
  last: string
}

/**
 * Up to three tags for a notebook: which project its notes come from and
 * what they are about. `basis` records which entries they were made from,
 * so a changed notebook gets fresh ones; `by` says whether a model chose
 * them or they were drawn from the notes' project directories while a
 * model answer was pending.
 */
export type NotebookTags = {
  tags: string[]
  basis: string
  generatedAt: number
  by: 'model' | 'heuristic'
}

/** The local web notebook server, while one is known to run. */
export type ServerInfo = {
  port: number
  pid: number
  url: string
  startedAt: number
}

/** The capture form's working copy before the person confirms. */
export type CaptureDraft = {
  /** Changes with every new draft, so the editor knows to reset. */
  id: string
  content: string
  folder: string
  source: SourceReference
}

/** An existing entry open in the editor. */
export type EditDraft = {
  id: string
  entryId: string
  content: string
  folder: string
}

/** One recent transcript message offered for whole-message capture. */
export type MessageCandidate = {
  index: number
  role: 'user' | 'assistant'
  text: string
  messageId?: string
}

/**
 * A best-effort fingerprint of one transcript row seen at `session.append`,
 * kept so a captured message can be matched back to its row id.
 */
export type AppendedRow = {
  uuid: string
  role: 'user' | 'assistant'
  length: number
  head: string
  tail: string
  /**
   * For an assistant text block: `pending` while its turn runs, `intermediate`
   * once a tool call followed it (narration between steps), `final` when the
   * turn ended with it (the reply). Absent for user rows and older sessions.
   */
  kind?: 'pending' | 'intermediate' | 'final'
}

export type NotebookView =
  | { kind: 'home' }
  | { kind: 'notebook'; folder: string }
  | { kind: 'pick' }
  | { kind: 'confirm' }
  | { kind: 'detail'; entryId: string; isDeleteArmed?: boolean }
  | { kind: 'edit'; entryId: string }

/** A short status line; `open` names an entry the line offers to open. */
export type Notice = { tone: 'ok' | 'error'; text: string; open?: string; at?: number } | null

declare module 'claude-code' {
  interface PluginState {
    'live-notebook': {
      view: NotebookView
      entries: NotebookEntry[]
      draft: CaptureDraft | null
      edit: EditDraft | null
      folders: FoldersRecord
      tags: Record<string, NotebookTags>
      /** The directory the markdown files and the web server live under; '' until known. */
      notesRoot: string
      server: ServerInfo | null
      /** Each note file's modification time as last imported, by relative path. */
      known: Record<string, number>
      /** The notes directory's touch mark as last seen; a change means the web app wrote. */
      touch: number
      candidates: MessageCandidate[]
      rows: AppendedRow[]
      query: string
      /** '' for every type, else one EntryType. */
      typeFilter: string
      notice: Notice
      /** The secondary menu (web notebook, new notebook, status) is open. */
      menuOpen: boolean
      /** True until the store has been read once this session. */
      isLoading: boolean
      /** True while a save is in flight. */
      isSaving: boolean
      /** The detail view shows the original snapshot beside the content. */
      showSnapshot: boolean
      /** Notebooks the person toggled away from their default open or closed state. */
      collapsed: string[]
    }
  }
}
