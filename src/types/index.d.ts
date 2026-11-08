/**
 * Live Notebook: the data model and the plugin's state contract.
 *
 * Self-contained on purpose: `claude plugin validate` reads this file as the
 * contract for every `$.state` key the hooks module names. The domain types
 * live here so that the hooks module, the services and the tests share one
 * definition.
 */

export type EntryType = 'insight' | 'learning' | 'reference' | 'other'

export type CaptureMode = 'whole_message' | 'excerpt'

export type SourceRole = 'user' | 'assistant' | 'tool' | 'unknown'

/** One neighbouring transcript message, kept beside a capture as context. */
export type ContextMessage = {
  role: 'user' | 'assistant'
  text: string
}

/**
 * Where a capture was made. Captures record only the project's name; earlier
 * versions also kept the messages just before and after (each cut to a
 * bounded length) and the project's full directory, and those stay readable.
 * Recorded automatically; never edited.
 */
export type CaptureContext = {
  before: ContextMessage[]
  after: ContextMessage[]
  /** The project directory's full path (earlier versions' captures). */
  cwd?: string
  /** The project directory's name, not its path. */
  project?: string
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
  /** True when the note is pinned on the web notebook, where it stays at the top of its notebook. */
  pinned?: boolean
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

/** A capture the person has not saved yet. */
export type CaptureDraft = {
  /** Changes with every new draft. */
  id: string
  content: string
  folder: string
  source: SourceReference
  /** A title the person typed before saving; empty or absent, the note is titled for them. */
  title?: string
  /** A type the person picked before saving; absent, a model gives the note one. */
  type?: EntryType
}

/** A saved note being edited in the pane. */
export type EditDraft = {
  /** Changes with every new edit, so the editor knows to reset. */
  id: string
  entryId: string
  content: string
  /** The title as edited; saved only when it differs from the note's. */
  title: string
  /** The type as picked on the edit page; saved only when it differs from the note's. Absent in an edit kept before it was a field. */
  type?: EntryType
  /** The notebook as picked on the edit page; saved, and the file moved, only when it differs from the note's. */
  folder?: string
  /**
   * The note as the editor opened it: a save sends only the fields edited
   * since, and refuses to write over text changed elsewhere meanwhile.
   * Absent in an edit kept before it was a field.
   */
  base?: { content: string; title: string; type: EntryType; folder: string }
}

/** One transcript message, as the save control under a reply hands it to a whole-message draft. */
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
  | { kind: 'confirm' }
  | { kind: 'note'; entryId: string; isDeleteArmed?: boolean }
  | { kind: 'edit'; entryId: string }

/** A short status line; `open` names an entry the line offers to open, `copy` a text (a path) it offers to copy. */
export type Notice = { tone: 'ok' | 'error'; text: string; open?: string; resume?: true; copy?: string; at?: number } | null

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
      rows: AppendedRow[]
      query: string
      /** Grows when the query is set from outside the desktop's search editor (cleared, or typed to /notebook), so the editor takes the new text. */
      searchSeed: number
      /** '' for every type, else one EntryType. */
      typeFilter: string
      notice: Notice
      /** The name field under "+ New notebook" is showing. */
      namingNotebook: boolean
      /** A saved note's `⋯` menu is open. */
      menuOpen: boolean
      /** A capture or edit page's breadcrumb title has been pressed: a field holds it until Enter. */
      titleEditing: boolean
      /** True until the store has been read once this session. */
      isLoading: boolean
      /** True while a save is in flight. */
      isSaving: boolean
      /** Notebooks the person toggled away from their default open or closed state. */
      collapsed: string[]
      /** The toolbar's latest formatting command for the capture editor; `id` grows so the editor applies each once. */
      editorCommand: { id: number; kind: string } | null
      /** The heading level under the capture editor's cursor (normal, h1, h2, h3); its toolbar button takes it off again. */
      editorHeading: string
      /** The person hid the rendered preview under the capture editor; it stays hidden for later notes this session. */
      previewHidden: boolean
      /** Wheel rows routed to the capture editor so far, summed; the editor scrolls by what it has not applied. */
      editorScroll: number
      /** The capture editor's window as it last reported it: first row shown, rows in all, rows shown. */
      editorView: { draftId: string; top: number; total: number; height: number } | null
    }
  }
}
