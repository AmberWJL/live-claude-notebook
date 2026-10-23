import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type {
  CaptureDraft,
  EditDraft,
  EntryType,
  FoldersRecord,
  MessageCandidate,
  NotebookEntry,
  NotebookView,
  Notice,
  ServerInfo,
} from '../../types'
import { ENTRY_TYPES, isEntryType } from '../../src/domain/notebook-entry'
import { TYPE_GLYPHS, TYPE_LABELS } from '../../src/services/classify'
import { activeIn } from '../../src/services/notebook-tags'
import { searchEntries } from '../../src/services/search-service'
import { deriveTitle, oneLine } from '../../src/utils/normalize-content'

/** The surfaces whose element table has Input and Select. */
export type FormSurface = 'terminal' | 'desktop' | 'vscode'

/** Plain data the pane draws from; read in the render hook, never here. */
export type PaneModel = {
  view: NotebookView
  entries: readonly NotebookEntry[]
  draft: CaptureDraft | null
  edit: EditDraft | null
  folders: FoldersRecord
  server: ServerInfo | null
  notesRoot: string
  candidates: readonly MessageCandidate[]
  query: string
  typeFilter: string
  notice: Notice
  /** The name field under "+ New notebook", or the editor page's `⋯` menu, is showing. */
  isNamingNotebook: boolean
  isLoading: boolean
  isSaving: boolean
  showSnapshot: boolean
  collapsed: readonly string[]
  /** `e.props.bodyColumns`: the cells across the pane body. */
  width: number
  /** `e.props.scroll.bodyRows`: the rows of the pane body; 0 when unknown. */
  rows: number
  /** Rows the editor may take, from the pane's own height. */
  editorRows: number
  /** The heading level under the editor's cursor (normal, h1, h2, h3), what the heading picker shows. */
  editorHeading: string
  currentSessionId: string
  /**
   * The content editor, a `Client` the hooks module builds (its module path
   * must be a literal there); absent on a surface without `Client`.
   */
  editor?: RenderElement
}

/** What the pane's controls do; closures the render hook builds over `$`. */
export type PaneActions = {
  search: (query: string) => void
  filterType: (type: string) => void
  toggleNewNotebook: () => void
  toggleNotebook: (folder: string) => void
  dismissNotice: () => void
  home: () => void
  newNote: () => void
  openWeb: (folder?: string) => void
  pick: (candidate: MessageCandidate) => void
  setDraftFolder: (folder: string) => void
  addFolder: (name: string) => void
  /** A formatting command for the editor's cursor line or word. */
  format: (kind: string) => void
  save: () => void
  cancel: () => void
  /** Back to the draft or edit the person left with the home icon. */
  resume: () => void
  /** Opens a note in the editor page. */
  open: (entryId: string) => void
  setType: (entryId: string, type: EntryType) => void
  toggleSnapshot: () => void
  viewSource: (entryId: string) => void
  copy: (text: string, surface: RenderSurface) => void
  setEditFolder: (folder: string) => void
  saveEdit: () => void
  cancelEdit: () => void
  archive: (entryId: string) => void
  armDelete: (entryId: string, isArmed: boolean) => void
  remove: (entryId: string) => void
}

/** The filters; each is an EntryType the data model already has. */
const TYPE_FILTERS: ReadonlyArray<{ value: '' | EntryType; label: string; short: string; empty: string }> = [
  { value: '', label: 'All notes', short: 'All', empty: 'No notes match.' },
  { value: 'insight', label: 'Insights', short: 'Insights', empty: 'No insights yet.' },
  { value: 'decision', label: 'Decisions', short: 'Decisions', empty: 'No decisions yet.' },
  { value: 'reference', label: 'References', short: 'Refs', empty: 'No references yet.' },
  { value: 'idea', label: 'Ideas', short: 'Ideas', empty: 'No ideas yet.' },
]

/** The editor toolbar's heading picker; each value is an editor command. */
const HEADING_OPTIONS = [
  { value: 'normal', label: 'Normal text' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
]

/** Below this many columns the pane stacks its controls and shortens labels. */
const NARROW = 40
/** From this many columns an open note keeps the home page beside it. */
const WIDE = 104
/** The widest a line of text is laid out, so long panes stay readable. */
const MEASURE = 88

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(ms: number): string {
  const date = new Date(ms)
  return `${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCDate()}`
}

function longDate(ms: number): string {
  const date = new Date(ms)
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  return `${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${hh}:${mm}`
}

function hashTags(tags: readonly string[]): string {
  return tags.map(tag => `#${tag}`).join('  ')
}

/** The left column's width on a wide pane, and the editor page's width beside it (or the whole pane). */
function leftWidthOf(width: number): number {
  return Math.min(56, Math.max(40, Math.floor(width * 0.42)))
}
function pageWidthOf(width: number): number {
  return width >= WIDE ? width - leftWidthOf(width) - 3 : width
}

/** The cells the editor's text has across: the page less the editor box's border and padding. */
export function editorColumns(width: number): number {
  return Math.max(10, pageWidthOf(Math.max(24, width)) - 4)
}

/** Whether a notebook is drawn closed: empty ones are, unless toggled; others are open unless toggled. */
export function isCollapsed(folder: string, count: number, collapsed: readonly string[]): boolean {
  return (count === 0) !== collapsed.includes(folder)
}

/** One line on where a note came from: who wrote it, how much was taken, when, and whether it has changed since. */
function sourceLine(entry: NotebookEntry): string {
  const source = entry.sources[0]
  if (source === undefined) return 'No source recorded'
  if (source.snapshot === '') return `Written in the notebook · ${longDate(source.capturedAt)}`
  const who = source.role === 'assistant' ? 'Claude' : source.role === 'user' ? 'You' : 'Unknown'
  const mode = source.captureMode === 'whole_message' ? 'whole message' : 'excerpt'
  const edited = source.snapshot !== entry.content ? ' · edited since' : ''
  return `${who} · ${mode} · ${longDate(source.capturedAt)}${edited}`
}

export function renderNotebookPane(
  els: ElementTable<FormSurface>,
  model: PaneModel,
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button, Input, Select, Markdown } = els
  const width = Math.max(24, model.width)
  const measure = Math.min(width, MEASURE)
  const isNarrow = width < NARROW
  // On a wide pane an open note shares the width with the home page: the left column, a gap, a rule, a gap, the page.
  const leftWidth = leftWidthOf(width)
  const pageMeasure = Math.min(pageWidthOf(width), MEASURE)
  const { notice, folders, query } = model
  const folderOptions = folders.names.map(name => ({ value: name, label: name }))
  const typeOptions = ENTRY_TYPES.map(type => ({ value: type, label: TYPE_LABELS[type] }))

  // A short status line: one phrase, an optional Open, and a way to dismiss it.
  const noticeRow = notice ? (
    <Box gap={1} flexWrap="wrap" marginTop={1}>
      <Text color={notice.tone === 'error' ? 'error' : 'success'}>{notice.text}</Text>
      {notice.open !== undefined && (
        <Button key="open-saved" plain onPress={() => actions.open(notice.open ?? '')}>
          Open
        </Button>
      )}
      {notice.resume === true && (
        <Button key="resume-draft" plain onPress={() => actions.resume()}>
          Resume
        </Button>
      )}
      <Button key="dismiss-notice" plain dimColor onPress={() => actions.dismissNotice()}>
        ×
      </Button>
    </Box>
  ) : null

  /** A dim rule across a column: under the filters and between notebooks. */
  function rule(columnWidth: number): RenderElement {
    return <Text dimColor>{'─'.repeat(Math.max(8, Math.min(columnWidth, width)))}</Text>
  }
  /** Rows of `│`, the rule between the home column and an open note. */
  function verticalRule(): RenderElement {
    return <Text dimColor>{Array.from({ length: Math.max(12, model.rows) }, () => '│').join('\n')}</Text>
  }

  /**
   * One line per note: the type mark, the title, the date. The open note is
   * marked with a bar and drawn in the accent colour instead of as a button.
   */
  function entryRow(
    entry: NotebookEntry,
    options: { withFolder: boolean; isSelected?: boolean; columnWidth?: number },
  ): RenderElement {
    const textWidth = Math.max(12, Math.min(options.columnWidth ?? measure, MEASURE) - 14)
    const folder = options.withFolder ? ` · ${entry.folder}` : ''
    const isSelected = options.isSelected === true
    return (
      <Box key={`row:${entry.id}`} flexDirection="row" gap={1}>
        <Text color="claude">{isSelected ? '▌' : ' '}</Text>
        <Text color="claude">{TYPE_GLYPHS[entry.type]}</Text>
        <Box flexGrow={1}>
          {isSelected ? (
            <Text bold color="claude">
              {oneLine(entry.title, textWidth)}
            </Text>
          ) : (
            <Button key={`entry:${entry.id}`} plain onPress={() => actions.open(entry.id)}>
              {oneLine(entry.title, textWidth)}
            </Button>
          )}
        </Box>
        <Text dimColor>{`${shortDate(entry.updatedAt)}${folder}`}</Text>
      </Box>
    )
  }

  function rows(list: readonly NotebookEntry[], withFolder: boolean, columnWidth?: number, selectedId?: string): RenderElement[] {
    return list.map(entry =>
      entryRow(entry, {
        withFolder,
        isSelected: entry.id === selectedId,
        ...(columnWidth === undefined ? {} : { columnWidth }),
      }),
    )
  }

  function searchField(): RenderElement {
    return (
      <Box flexGrow={1} gap={1} alignItems="center">
        <Text dimColor>⌕</Text>
        <Box flexGrow={1}>
          <Input
            key="search"
            placeholder="Search notes…"
            value={query}
            submitLabel="Search"
            onInput={value => actions.search(value)}
            onSubmit={value => actions.search(value)}
          />
        </Box>
        {query !== '' && (
          <Button key="clear" plain dimColor onPress={() => actions.search('')}>
            ×
          </Button>
        )}
      </Box>
    )
  }

  function newNotebookField(): RenderElement {
    return (
      <Box gap={1} marginTop={1}>
        <Box flexGrow={1}>
          <Input
            key="new-notebook"
            placeholder="Notebook name"
            submitLabel="create"
            onSubmit={name => {
              if (name.trim() !== '') actions.addFolder(name)
            }}
          />
        </Box>
        <Button key="new-notebook-cancel" plain dimColor onPress={() => actions.toggleNewNotebook()}>
          ×
        </Button>
      </Box>
    )
  }

  /** The buttons across the top of the home page; each is asked to fill its column. */
  function toolbar(withNotebookField: boolean): RenderElement {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" alignItems="stretch">
          <Button key="web" onPress={() => actions.openWeb()}>
            ⧉ Open Live Notebook in Browser
          </Button>
        </Box>
        <Box gap={1} marginTop={1} flexDirection="row" flexWrap="wrap">
          <Box flexGrow={1} flexDirection="column" alignItems="stretch">
            <Button key="new-note" variant="primary" onPress={() => actions.newNote()}>
              + Add New Note
            </Button>
          </Box>
          <Box flexGrow={1} flexDirection="column" alignItems="stretch">
            <Button key="new-notebook-start" onPress={() => actions.toggleNewNotebook()}>
              + Add New Notebook
            </Button>
          </Box>
        </Box>
        {withNotebookField && model.isNamingNotebook && newNotebookField()}
        <Box marginTop={1}>{searchField()}</Box>
      </Box>
    )
  }

  function filterRow(active: '' | EntryType): RenderElement {
    return (
      <Box gap={1} flexWrap="wrap" marginTop={1}>
        {TYPE_FILTERS.map(one =>
          one.value === active ? (
            <Button key={`filter:${one.value || 'all'}`} variant="primary" onPress={() => actions.filterType(one.value)}>
              {isNarrow ? one.short : one.label}
            </Button>
          ) : (
            <Button key={`filter:${one.value || 'all'}`} plain dimColor onPress={() => actions.filterType(one.value)}>
              {isNarrow ? one.short : one.label}
            </Button>
          ),
        )}
      </Box>
    )
  }

  function emptyState(): RenderElement {
    return (
      <Box flexDirection="column" alignItems="center" marginTop={2}>
        <Text color="claude">▤</Text>
        <Text bold>No notes yet</Text>
        <Text dimColor>Save useful insights, decisions, and references from your conversations.</Text>
        <Box marginTop={1}>
          <Button key="new-note-empty" variant="primary" onPress={() => actions.newNote()}>
            + Add New Note
          </Button>
        </Box>
      </Box>
    )
  }

  // ------------------------------------------------------------ views --

  if (model.view.kind === 'pick') {
    const { candidates } = model
    return (
      <Box flexDirection="column">
        <Text bold>Save which message?</Text>
        <Text dimColor>
          {candidates.length === 0
            ? 'No messages with text in this session yet. Type /save followed by the text to save an excerpt.'
            : `The newest ${candidates.length} messages of this session, newest first.`}
        </Text>
        {noticeRow}
        {candidates.map(candidate => (
          <Button key={`pick:${candidate.index}`} plain onPress={() => actions.pick(candidate)}>
            {`${candidate.role === 'assistant' ? 'Claude' : 'You'}: ${oneLine(candidate.text, measure - 10)}`}
          </Button>
        ))}
        <Box marginTop={1}>
          <Button key="cancel" role="dismiss" onPress={() => actions.home()}>
            Cancel
          </Button>
        </Box>
      </Box>
    )
  }

  /**
   * The editor page, for a new capture and for an existing note alike: the
   * breadcrumb and date, `⋯` and Save, a formatting toolbar (heading picker,
   * then glyph buttons), then the editor filling the pane. Behind `⋯`: the
   * notebook picker and a new-notebook field; for a saved note also its type
   * and tags, Archive and Delete, then its source (one line on who, how much
   * and when, what it answered, the original behind a toggle); and Discard.
   */
  function editorPage(options: {
    folder: string
    content: string
    date: number
    meta: string
    onFolder: (folder: string) => void
    onSave: () => void
    onCancel: () => void
    saveKey: string
    cancelKey: string
    folderKey: string
    saveLabel: string
    /** The saved note being edited; absent for a capture not yet saved. */
    entry?: NotebookEntry
    isDeleteArmed?: boolean
  }): RenderElement {
    const { entry } = options
    const title = entry?.title ?? (options.content.trim() === '' ? 'Untitled' : deriveTitle(options.content))
    const source = entry?.sources[0]
    const hasSnapshot = source !== undefined && source.snapshot !== ''
    const canView = source?.messageId !== undefined && source.sessionId === model.currentSessionId
    const asked = source?.context?.before.filter(one => one.role === 'user').at(-1)
    const isArmed = options.isDeleteArmed === true
    const tool = (key: string, label: string, kind: string) => (
      <Button key={key} plain onPress={() => actions.format(kind)}>
        {label}
      </Button>
    )
    const sep = () => <Text dimColor>│</Text>
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between" gap={1}>
          <Box gap={1}>
            <Button key="home-icon" plain dimColor onPress={() => actions.home()}>
              ⌂
            </Button>
            <Box flexDirection="column">
              <Box gap={1}>
                <Text dimColor>{options.folder}</Text>
                <Text dimColor>/</Text>
                <Text bold>{oneLine(title, Math.max(12, pageMeasure - options.folder.length - 20))}</Text>
              </Box>
              <Text dimColor>{longDate(options.date).replace(/, \d\d:\d\d$/, '')}</Text>
            </Box>
          </Box>
          <Box gap={1}>
            <Button key="editor-more" plain dimColor onPress={() => actions.toggleNewNotebook()}>
              ⋯
            </Button>
            <Button key={options.saveKey} variant="primary" onPress={() => options.onSave()}>
              {model.isSaving ? 'Saving…' : options.saveLabel}
            </Button>
          </Box>
        </Box>
        {model.isNamingNotebook && (
          <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderDimColor>
            <Select key={options.folderKey} label="Notebook" options={folderOptions} value={options.folder} onSelect={options.onFolder} />
            <Input
              key={`${options.folderKey}-new`}
              placeholder="new notebook"
              submitLabel="add"
              onSubmit={name => {
                if (name.trim() !== '') actions.addFolder(name)
              }}
            />
            {entry !== undefined && (
              <Select
                key="type"
                label="Type"
                options={typeOptions}
                value={entry.type}
                onSelect={value => actions.setType(entry.id, isEntryType(value) ? value : 'other')}
              />
            )}
            {entry !== undefined && entry.tags.length > 0 && <Text dimColor>{hashTags(entry.tags)}</Text>}
            {entry !== undefined && (
              <Box gap={1} flexWrap="wrap" marginTop={1}>
                {entry.status !== 'archived' && (
                  <Button key="archive" plain dimColor onPress={() => actions.archive(entry.id)}>
                    Archive
                  </Button>
                )}
                {isArmed ? (
                  <Button key="delete-confirm" variant="primary" onPress={() => actions.remove(entry.id)}>
                    Confirm delete
                  </Button>
                ) : (
                  <Button key="delete" plain dimColor onPress={() => actions.armDelete(entry.id, true)}>
                    Delete
                  </Button>
                )}
                {isArmed && (
                  <Button key="delete-keep" plain onPress={() => actions.armDelete(entry.id, false)}>
                    Keep
                  </Button>
                )}
              </Box>
            )}
            {entry !== undefined && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>Source</Text>
                <Text dimColor>{sourceLine(entry)}</Text>
                {asked !== undefined && (
                  <Text dimColor>{`In reply to "${oneLine(asked.text, Math.max(20, pageMeasure - 18))}"`}</Text>
                )}
                {hasSnapshot && source !== undefined && (
                  <Box gap={2} flexWrap="wrap">
                    <Button key="snapshot" plain dimColor onPress={() => actions.toggleSnapshot()}>
                      {model.showSnapshot ? '▾ Hide original' : '▸ Show original'}
                    </Button>
                    <Button key="copy-snapshot" plain dimColor onPress={press => actions.copy(source.snapshot, press.surface)}>
                      Copy
                    </Button>
                    {canView && (
                      <Button key="view-source" plain onPress={() => actions.viewSource(entry.id)}>
                        View in conversation ↗
                      </Button>
                    )}
                  </Box>
                )}
                {hasSnapshot && source !== undefined && model.showSnapshot && (
                  <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
                    <Markdown text={source.snapshot} dimColor />
                  </Box>
                )}
              </Box>
            )}
            <Box marginTop={1}>
              <Button key={options.cancelKey} plain dimColor onPress={() => options.onCancel()}>
                {entry === undefined ? 'Discard this note' : 'Discard changes'}
              </Button>
            </Box>
          </Box>
        )}
        <Box gap={1} flexWrap="wrap" marginTop={1} alignItems="center">
          <Select key="fmt-heading" options={HEADING_OPTIONS} value={model.editorHeading} onSelect={value => actions.format(value)} />
          {sep()}
          {tool('fmt-bold', 'B', 'bold')}
          {tool('fmt-italic', 'I', 'italic')}
          {tool('fmt-code', '</>', 'code')}
          {sep()}
          {tool('fmt-link', '🔗', 'link')}
          {sep()}
          {tool('fmt-bullet', '•', 'bullet')}
          {tool('fmt-number', '1.', 'number')}
          {sep()}
          {tool('fmt-quote', '❝', 'quote')}
          {sep()}
          {tool('fmt-undo', '↶', 'undo')}
          {tool('fmt-redo', '↷', 'redo')}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
          {model.editor ?? (
            <Box flexDirection="column">
              <Markdown text={options.content} />
              <Text dimColor>Editing needs the terminal or the desktop app.</Text>
            </Box>
          )}
        </Box>
        <Text dimColor>{options.meta}</Text>
        {noticeRow}
      </Box>
    )
  }

  /** A page beside the home page, a rule between them, when the pane is wide enough for both. */
  function withOverview(page: RenderElement, selectedId?: string): RenderElement {
    if (width < WIDE) return page
    return (
      <Box flexDirection="row" gap={1}>
        <Box flexDirection="column" width={leftWidth} flexShrink={0}>
          {homeView(leftWidth, selectedId, false)}
        </Box>
        <Box flexDirection="column" width={1} flexShrink={0}>
          {verticalRule()}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {page}
        </Box>
      </Box>
    )
  }

  if (model.view.kind === 'confirm' && model.draft) {
    const draft = model.draft
    const isBlank = draft.source.snapshot === ''
    return withOverview(editorPage({
      folder: draft.folder,
      content: draft.content,
      date: draft.source.capturedAt,
      meta: isBlank
        ? `${draft.content.length.toLocaleString()} characters · written here`
        : `${draft.source.captureMode === 'whole_message' ? 'whole message' : 'excerpt'} · ${draft.source.role ?? 'unknown role'} · ${draft.content.length.toLocaleString()} characters`,
      onFolder: folder => actions.setDraftFolder(folder),
      onSave: () => actions.save(),
      onCancel: () => actions.cancel(),
      saveKey: 'save',
      cancelKey: 'cancel',
      folderKey: 'folder',
      saveLabel: 'Save',
    }))
  }

  if (model.view.kind === 'edit' && model.edit) {
    const edit = model.edit
    const entry = model.entries.find(one => one.id === edit.entryId)
    const about = entry === undefined ? '' : ` · ${TYPE_LABELS[entry.type]}${entry.status === 'archived' ? ' · archived' : ''}`
    return withOverview(editorPage({
      folder: edit.folder,
      content: edit.content,
      date: entry?.updatedAt ?? Date.now(),
      meta: `${edit.content.length.toLocaleString()} characters${about}`,
      onFolder: folder => actions.setEditFolder(folder),
      onSave: () => actions.saveEdit(),
      onCancel: () => actions.cancelEdit(),
      saveKey: 'save-edit',
      cancelKey: 'cancel-edit',
      folderKey: 'edit-folder',
      saveLabel: 'Save',
      ...(entry === undefined ? {} : { entry }),
      ...(model.view.isDeleteArmed === undefined ? {} : { isDeleteArmed: model.view.isDeleteArmed }),
    }), edit.entryId)
  }

  return homeView(width, undefined, true)

  /**
   * The home page: toolbar, filters, then the notebooks as collapsible groups
   * with a rule between them, laid out to `columnWidth`. `isStandalone` is
   * false when it is the column beside an open note.
   */
  function homeView(columnWidth: number, selectedId: string | undefined, isStandalone: boolean): RenderElement {
    const typeFilter = isEntryType(model.typeFilter) ? model.typeFilter : ''
    const filter = TYPE_FILTERS.find(one => one.value === typeFilter) ?? TYPE_FILTERS[0]
    const isFiltering = query.trim() !== '' || typeFilter !== ''
    const active = model.entries.filter(one => one.status !== 'archived')
    const results = isFiltering ? searchEntries(model.entries, query).filter(one => typeFilter === '' || one.type === typeFilter) : []

    let body: RenderElement
    if (model.isLoading) {
      body = (
        <Box marginTop={1}>
          <Text dimColor>Loading your notes…</Text>
        </Box>
      )
    } else if (active.length === 0) {
      body = emptyState()
    } else if (isFiltering) {
      body = (
        <Box flexDirection="column" marginTop={1}>
          {rule(columnWidth)}
          <Text dimColor>
            {results.length === 0
              ? query.trim() !== ''
                ? `No notes match "${query.trim()}".`
                : filter?.empty ?? 'No notes match.'
              : `${results.length} ${results.length === 1 ? 'note' : 'notes'}`}
          </Text>
          {rows(results, true, columnWidth, selectedId)}
        </Box>
      )
    } else {
      body = (
        <Box flexDirection="column">
          {folders.names.map(name => {
            const notes = activeIn(model.entries, name)
            const closed = isCollapsed(name, notes.length, model.collapsed)
            return (
              <Box key={`nb-row:${name}`} flexDirection="column" marginTop={1}>
                {rule(columnWidth)}
                <Box justifyContent="space-between" gap={1}>
                  <Box gap={1}>
                    <Button key={`nb:${name}`} plain onPress={() => actions.toggleNotebook(name)}>
                      {closed ? '›' : '⌄'}
                    </Button>
                    <Text bold>{name}</Text>
                  </Box>
                  <Text dimColor>{String(notes.length)}</Text>
                </Box>
                {!closed && notes.length === 0 && <Text dimColor>No notes yet.</Text>}
                {!closed && <Box flexDirection="column">{rows(notes, false, columnWidth, selectedId)}</Box>}
              </Box>
            )
          })}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {toolbar(isStandalone)}
        {filterRow(typeFilter)}
        {isStandalone && noticeRow}
        {body}
      </Box>
    )
  }
}

/** A read-only list for a surface without Input or Select. */
export function renderReadOnlyPane(
  els: Pick<ElementTable<'mobile'>, 'Box' | 'Text'>,
  entries: readonly NotebookEntry[],
): RenderElement {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      <Text bold>Live Notebook</Text>
      <Text dimColor>Capture and search need a terminal or desktop surface.</Text>
      {searchEntries(entries, '').map(entry => (
        <Text>{`• ${entry.title}`}</Text>
      ))}
    </Box>
  )
}
