import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type {
  CaptureDraft,
  EditDraft,
  EntryType,
  FoldersRecord,
  MessageCandidate,
  NotebookEntry,
  NotebookTags,
  NotebookView,
  Notice,
  ServerInfo,
} from '../../types'
import { ENTRY_TYPES, isEntryType } from '../../src/domain/notebook-entry'
import { TYPE_GLYPHS, TYPE_LABELS } from '../../src/services/classify'
import { activeIn } from '../../src/services/notebook-tags'
import { searchEntries } from '../../src/services/search-service'
import { deriveTitle, oneLine, previewOf } from '../../src/utils/normalize-content'

/** The surfaces whose element table has Input and Select. */
export type FormSurface = 'terminal' | 'desktop' | 'vscode'

/** Plain data the pane draws from; read in the render hook, never here. */
export type PaneModel = {
  view: NotebookView
  entries: readonly NotebookEntry[]
  draft: CaptureDraft | null
  edit: EditDraft | null
  folders: FoldersRecord
  tags: Readonly<Record<string, NotebookTags>>
  server: ServerInfo | null
  notesRoot: string
  candidates: readonly MessageCandidate[]
  query: string
  typeFilter: string
  notice: Notice
  menuOpen: boolean
  isLoading: boolean
  isSaving: boolean
  showSnapshot: boolean
  collapsed: readonly string[]
  /** `e.props.bodyColumns`: the cells across the pane body. */
  width: number
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
  toggleMenu: () => void
  toggleNotebook: (folder: string) => void
  dismissNotice: () => void
  home: () => void
  newNote: () => void
  openWeb: (folder?: string) => void
  pick: (candidate: MessageCandidate) => void
  setDraftFolder: (folder: string) => void
  addFolder: (name: string) => void
  save: () => void
  cancel: () => void
  open: (entryId: string) => void
  edit: (entryId: string) => void
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

/** Below this many columns the pane stacks its controls and shortens labels. */
const NARROW = 56
/** From this many columns the detail view keeps the list beside it. */
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

/** Whether a notebook is drawn closed: empty ones are, unless toggled; others are open unless toggled. */
export function isCollapsed(folder: string, count: number, collapsed: readonly string[]): boolean {
  return (count === 0) !== collapsed.includes(folder)
}

function capturedFrom(entry: NotebookEntry): string {
  const source = entry.sources[0]
  if (source === undefined) return 'No source recorded'
  if (source.snapshot === '') return 'Written in the notebook'
  const who = source.role === 'assistant' ? 'assistant' : source.role === 'user' ? 'your' : 'a'
  return `Captured from ${who} message${source.captureMode === 'excerpt' ? ' (excerpt)' : ''}`
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
      <Button key="dismiss-notice" plain dimColor onPress={() => actions.dismissNotice()}>
        ×
      </Button>
    </Box>
  ) : null

  function folderRow(key: string, value: string, onSelect: (folder: string) => void): RenderElement {
    return (
      <Box flexDirection={isNarrow ? 'column' : 'row'} gap={1}>
        <Select key={key} label="Notebook" options={folderOptions} value={value} onSelect={onSelect} />
        <Input
          key={`${key}-new`}
          placeholder="new notebook"
          submitLabel="add"
          onSubmit={name => {
            if (name.trim() !== '') actions.addFolder(name)
          }}
        />
      </Box>
    )
  }

  function editorBlock(content: string): RenderElement {
    return (
      <Box flexDirection="column" marginTop={1}>
        {model.editor ?? (
          <Box flexDirection="column">
            <Markdown text={content} />
            <Text dimColor>Editing needs the terminal or the desktop app.</Text>
          </Box>
        )}
      </Box>
    )
  }

  /** Icon, title and date on one line; a one-line preview and the tags under it. */
  function entryRow(
    entry: NotebookEntry,
    options: { withFolder: boolean; isSelected?: boolean; compact?: boolean; isFirst: boolean },
  ): RenderElement {
    const textWidth = Math.max(14, measure - 12)
    const tags = entry.tags.slice(0, 3)
    const trail = options.withFolder ? [entry.folder, ...tags.map(tag => `#${tag}`)].join('  ') : hashTags(tags)
    return (
      <Box key={`row:${entry.id}`} flexDirection="column" marginTop={options.isFirst ? 0 : 1}>
        <Box flexDirection="row" gap={1}>
          <Text color="claude">{options.isSelected === true ? '▍' : TYPE_GLYPHS[entry.type]}</Text>
          <Box flexGrow={1}>
            <Button key={`entry:${entry.id}`} plain onPress={() => actions.open(entry.id)}>
              {oneLine(entry.title, textWidth)}
            </Button>
          </Box>
          <Text dimColor>{shortDate(entry.updatedAt)}</Text>
        </Box>
        {options.compact !== true && (
          <Box paddingLeft={2}>
            <Text dimColor wrap="truncate-end">
              {previewOf(entry, isNarrow ? textWidth : measure - 4)}
            </Text>
          </Box>
        )}
        {trail !== '' && options.compact !== true && (
          <Box paddingLeft={2}>
            <Text dimColor>{trail}</Text>
          </Box>
        )}
      </Box>
    )
  }

  function rows(list: readonly NotebookEntry[], withFolder: boolean): RenderElement[] {
    return list.map((entry, index) => entryRow(entry, { withFolder, isFirst: index === 0 }))
  }

  function searchField(): RenderElement {
    return (
      <Box flexGrow={1} gap={1}>
        <Box flexGrow={1}>
          <Input
            key="search"
            placeholder="Search notes…"
            value={query}
            submitLabel="search"
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

  function toolbar(): RenderElement {
    const openWeb = (
      <Button key="web" variant="primary" onPress={() => actions.openWeb()}>
        {isNarrow ? 'Open' : 'Open Live Notebook'}
      </Button>
    )
    const newNote = (
      <Button key="new-note" onPress={() => actions.newNote()}>
        {isNarrow ? '+' : '+ New note'}
      </Button>
    )
    const more = (
      <Button key="more" plain dimColor onPress={() => actions.toggleMenu()}>
        {model.menuOpen ? 'close' : '⋯'}
      </Button>
    )
    if (isNarrow) {
      return (
        <Box flexDirection="column">
          <Box gap={1}>
            {openWeb}
            {newNote}
            {more}
          </Box>
          {searchField()}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          {openWeb}
          {newNote}
          {more}
        </Box>
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

  function secondaryMenu(): RenderElement {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Input
          key="new-notebook"
          placeholder="New notebook"
          submitLabel="add"
          onSubmit={name => {
            if (name.trim() !== '') actions.addFolder(name)
          }}
        />
        {model.notesRoot !== '' && <Text dimColor>{`Notes are markdown files in ${model.notesRoot}/notes`}</Text>}
        <Text dimColor>Rename, export or delete a notebook in the web notebook.</Text>
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
            + New note
          </Button>
        </Box>
      </Box>
    )
  }

  function detailView(entry: NotebookEntry, isArmed: boolean): RenderElement {
    const source = entry.sources[0]
    const hasSnapshot = source !== undefined && source.snapshot !== ''
    const canView = source?.messageId !== undefined && source.sessionId === model.currentSessionId
    const context = source?.context
    const asked = context?.before.filter(one => one.role === 'user').at(-1)
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between" gap={1}>
          <Button key="back" plain dimColor onPress={() => actions.home()}>
            ← Back to notes
          </Button>
          <Box gap={1}>
            <Button key="edit" plain onPress={() => actions.edit(entry.id)}>
              Edit
            </Button>
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
        </Box>
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text color="claude">{TYPE_GLYPHS[entry.type]}</Text>
          <Text bold>{entry.title}</Text>
        </Box>
        <Text dimColor>{`${longDate(entry.updatedAt).replace(/, \d\d:\d\d$/, '')} · ${entry.folder}${entry.status === 'archived' ? ' · archived' : ''}`}</Text>
        {entry.tags.length > 0 && <Text dimColor>{hashTags(entry.tags)}</Text>}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Text dimColor>Type</Text>
          <Select
            key="type"
            options={typeOptions}
            value={entry.type}
            onSelect={value => actions.setType(entry.id, isEntryType(value) ? value : 'other')}
          />
        </Box>
        {noticeRow}
        <Box marginTop={1}>
          <Text dimColor>Note content</Text>
        </Box>
        <Markdown text={entry.content} />
        <Box justifyContent="space-between" gap={1} marginTop={1}>
          <Text dimColor>Source</Text>
          {canView && (
            <Button key="view-source" plain onPress={() => actions.viewSource(entry.id)}>
              View in conversation ↗
            </Button>
          )}
        </Box>
        <Text dimColor>{capturedFrom(entry)}</Text>
        {source !== undefined && <Text dimColor>{longDate(source.capturedAt)}</Text>}
        {asked !== undefined && <Text dimColor>{`In reply to: ${oneLine(asked.text, Math.max(20, measure - 14))}`}</Text>}
        {hasSnapshot && source !== undefined && (
          <Box flexDirection="column">
            <Box gap={1}>
              <Button key="snapshot" plain dimColor onPress={() => actions.toggleSnapshot()}>
                {`${model.showSnapshot ? '▾' : '▸'} Original message snapshot${source.snapshot !== entry.content ? ' (edited since)' : ''}`}
              </Button>
              <Button key="copy-snapshot" plain dimColor onPress={press => actions.copy(source.snapshot, press.surface)}>
                copy
              </Button>
            </Box>
            {model.showSnapshot && (
              <Box paddingLeft={2}>
                <Markdown text={source.snapshot} dimColor />
              </Box>
            )}
          </Box>
        )}
        {entry.file !== undefined && <Text dimColor>{`notes/${entry.file}`}</Text>}
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

  if (model.view.kind === 'confirm' && model.draft) {
    const draft = model.draft
    const isBlank = draft.source.snapshot === ''
    return (
      <Box flexDirection="column">
        <Text bold>{isBlank ? 'New note' : 'Save to notebook'}</Text>
        {folderRow('folder', draft.folder, folder => actions.setDraftFolder(folder))}
        {editorBlock(draft.content)}
        <Text dimColor>
          {`${draft.content.trim() === '' ? 'Untitled' : deriveTitle(draft.content)} · ${
            isBlank
              ? 'written here'
              : `${draft.source.captureMode === 'whole_message' ? 'whole message' : 'excerpt'} · ${draft.source.role ?? 'unknown role'}`
          } · ${draft.content.length.toLocaleString()} characters`}
        </Text>
        {noticeRow}
        <Box gap={1} marginTop={1}>
          <Button key="save" variant="primary" onPress={() => actions.save()}>
            {model.isSaving ? 'Saving…' : 'Save'}
          </Button>
          <Button key="cancel" role="dismiss" onPress={() => actions.cancel()}>
            Cancel
          </Button>
        </Box>
      </Box>
    )
  }

  if (model.view.kind === 'edit' && model.edit) {
    const edit = model.edit
    const entry = model.entries.find(one => one.id === edit.entryId)
    return (
      <Box flexDirection="column">
        <Text bold>{`Edit: ${entry?.title ?? 'entry'}`}</Text>
        {folderRow('edit-folder', edit.folder, folder => actions.setEditFolder(folder))}
        {editorBlock(edit.content)}
        <Text dimColor>{`${deriveTitle(edit.content)} · ${edit.content.length.toLocaleString()} characters · the original snapshot is kept`}</Text>
        {noticeRow}
        <Box gap={1} marginTop={1}>
          <Button key="save-edit" variant="primary" onPress={() => actions.saveEdit()}>
            {model.isSaving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button key="cancel-edit" role="dismiss" onPress={() => actions.cancelEdit()}>
            Cancel
          </Button>
        </Box>
      </Box>
    )
  }

  if (model.view.kind === 'detail') {
    const { entryId } = model.view
    const entry = model.entries.find(one => one.id === entryId)
    if (entry) {
      const detail = detailView(entry, model.view.isDeleteArmed === true)
      if (width < WIDE) return detail
      // Wide pane: the notebook's notes stay beside the open one.
      const siblings = activeIn(model.entries, entry.folder)
      return (
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column" width={34}>
            <Text dimColor>{`${entry.folder} · ${siblings.length}`}</Text>
            {siblings.map((one, index) =>
              entryRow(one, { withFolder: false, isSelected: one.id === entry.id, compact: true, isFirst: index === 0 }),
            )}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {detail}
          </Box>
        </Box>
      )
    }
  }

  // Home: search, filters, then the notebooks as collapsible groups.
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
        <Text dimColor>
          {results.length === 0
            ? query.trim() !== ''
              ? `No notes match "${query.trim()}".`
              : filter?.empty ?? 'No notes match.'
            : `${results.length} ${results.length === 1 ? 'note' : 'notes'}`}
        </Text>
        {rows(results, true)}
      </Box>
    )
  } else {
    body = (
      <Box flexDirection="column">
        {folders.names.map(name => {
          const notes = activeIn(model.entries, name)
          const closed = isCollapsed(name, notes.length, model.collapsed)
          const tags = model.tags[name]
          return (
            <Box key={`nb-row:${name}`} flexDirection="column" marginTop={1}>
              <Box justifyContent="space-between" gap={1}>
                <Button key={`nb:${name}`} plain onPress={() => actions.toggleNotebook(name)}>
                  {`${closed ? '▸' : '▾'} ${name}`}
                </Button>
                <Text dimColor>{String(notes.length)}</Text>
              </Box>
              {!closed && tags !== undefined && tags.tags.length > 0 && (
                <Box paddingLeft={2}>
                  <Text dimColor>{hashTags(tags.tags)}</Text>
                </Box>
              )}
              {!closed && notes.length === 0 && (
                <Box paddingLeft={2}>
                  <Text dimColor>No notes yet.</Text>
                </Box>
              )}
              {!closed && <Box flexDirection="column">{rows(notes, false)}</Box>}
            </Box>
          )
        })}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {toolbar()}
      {model.menuOpen && secondaryMenu()}
      {filterRow(typeFilter)}
      {noticeRow}
      {body}
    </Box>
  )
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
