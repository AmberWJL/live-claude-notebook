import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type {
  CaptureDraft,
  EditDraft,
  EntryType,
  FoldersRecord,
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
  query: string
  typeFilter: string
  notice: Notice
  /** The name field under "+ New notebook" is showing. */
  isNamingNotebook: boolean
  /** A saved note's `⋯` menu (Archive, Delete) is open. */
  isMenuOpen: boolean
  /** A capture or edit page's breadcrumb title has been pressed: a field holds it until Enter. */
  isEditingTitle: boolean
  isLoading: boolean
  isSaving: boolean
  collapsed: readonly string[]
  /** Which surface draws the pane: the terminal draws rules as characters, a desktop as a markdown rule. */
  surface: FormSurface
  /** `e.props.bodyColumns`: the cells across the pane body. */
  width: number
  /** `e.props.scroll.bodyRows`: the rows of the pane body; 0 when unknown. */
  rows: number
  /** The light grey (or, in a dark theme, dark grey) a note row takes under the pointer. */
  hoverColor: string
  /** Whether the surface is dark: the open note's row and the search icon take their colours from it. */
  isDark: boolean
  /** The heading level under the capture editor's cursor (normal, h1, h2, h3); its toolbar button takes it off again. */
  editorHeading: string
  /** The rendered preview shows under the capture editor (the person can hide it). */
  isPreviewShown: boolean
  /**
   * The capture editor, a `Client` the hooks module builds (its module path
   * must be a literal there); absent on a surface without `Client`.
   */
  editor?: RenderElement
  /**
   * The one-row editor the breadcrumb's title becomes while it is edited, a
   * `Client` the hooks module builds; absent on a surface without `Client`,
   * where a field stands in.
   */
  titleEditor?: RenderElement
  /** On a desktop, the search field: the mod's own one-row editor (its Input would draw an Enter button). */
  searchEditor?: RenderElement
}

/** What the pane's controls do; closures the render hook builds over `$`. */
export type PaneActions = {
  search: (query: string) => void
  filterType: (type: string) => void
  toggleNewNotebook: () => void
  /** `⋯` on a saved note's page. */
  toggleMenu: () => void
  toggleNotebook: (folder: string) => void
  /** Export, on a notebook's header row: its notes as one markdown file. */
  exportNotebook: (folder: string) => void
  dismissNotice: () => void
  /** The notice's Copy path; the surface says which clipboard. */
  copy: (text: string, surface: RenderSurface) => void
  home: () => void
  /** A new, empty note, opened in the web notebook. */
  newNote: () => void
  setDraftFolder: (folder: string) => void
  /** The capture page's title, edited in the breadcrumb, changed. */
  setDraftTitle: (title: string) => void
  /** The breadcrumb's title pressed on a capture or edit page: a field takes its place. */
  beginTitleEdit: () => void
  /** Enter in that field: the title shows in the breadcrumb again. */
  endTitleEdit: () => void
  /** The capture page's type picker changed; undefined is Automatic, the model's choice at save. */
  setDraftType: (type: EntryType | undefined) => void
  addFolder: (name: string) => void
  /** A formatting command for the capture editor's cursor line or word. */
  format: (kind: string) => void
  save: () => void
  cancel: () => void
  /** Back to the capture or edit the person left with the home icon. */
  resume: () => void
  /** Opens a note's page in the pane. */
  open: (entryId: string) => void
  /** Edits a saved note in the pane's editor. */
  edit: (entryId: string) => void
  /** Opens a saved note in the web notebook. */
  openInWeb: (entryId: string) => void
  saveEdit: () => void
  /** The edit page's title, edited in the breadcrumb, changed. */
  setEditTitle: (title: string) => void
  /** The edit page's type picker, beside the title, changed. */
  setEditType: (type: EntryType) => void
  /** The edit page's notebook picker, beside the title, changed. */
  setEditFolder: (folder: string) => void
  /** Hide preview or Show preview, at the end of the capture and edit pages' formatting row. */
  togglePreview: () => void
  cancelEdit: () => void
  archive: (entryId: string) => void
  armDelete: (entryId: string, isArmed: boolean) => void
  remove: (entryId: string) => void
}

/** The filters; each is an EntryType the data model already has. */
const TYPE_FILTERS: ReadonlyArray<{ value: '' | EntryType; label: string; short: string; empty: string }> = [
  { value: '', label: 'All notes', short: 'All', empty: 'No notes match.' },
  { value: 'insight', label: 'Insights', short: 'Insights', empty: 'No insights yet.' },
  { value: 'learning', label: 'Learnings', short: 'Learnings', empty: 'No learnings yet.' },
  { value: 'reference', label: 'References', short: 'Refs', empty: 'No references yet.' },
  { value: 'other', label: 'Other', short: 'Other', empty: 'No other notes yet.' },
]

/** The least a note page beside the home column is, in cells; narrower, the page stands alone. */
const PAGE_MIN = 56
/** The widest the home column grows beside an open note. */
const LEFT_MAX = 72
/** The widest a line of text is laid out, so long panes stay readable. */
const MEASURE = 88

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function longDate(ms: number): string {
  const date = new Date(ms)
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  return `${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${hh}:${mm}`
}

/** A saved note's created and last-updated times; a capture not yet saved has only when it was captured. */
type NoteDates = { created: number; updated: number } | { captured: number }

/**
 * The lines under a note: when it was created and, if it was edited in a
 * later minute, when it was last edited; a capture shows when it was captured.
 */
function dateLines(dates: NoteDates): string[] {
  if ('captured' in dates) return [`Captured ${longDate(dates.captured)}`]
  const created = longDate(dates.created)
  const edited = longDate(dates.updated)
  return edited === created ? [`Created ${created}`] : [`Created ${created}`, `Edited ${edited}`]
}

/** The filters' labels, longest first: the full ones, the short ones, and the marks alone. */
type FilterLabels = 'label' | 'short' | 'mark'

/**
 * The cells the filter row takes on one line with a label set, as a surface
 * draws it: each label and, before a type's, its mark. A desktop's font draws
 * the marks two cells wide, its plain button pads a cell each side, the row's
 * gap is two cells there (one on the terminal), and two cells of slack stand
 * in for its proportional font.
 */
function filterRowWidth(labels: FilterLabels, isDesktop: boolean): number {
  const pad = isDesktop ? 2 : 0
  const mark = isDesktop ? 2 : 1
  const items = TYPE_FILTERS.map(one => {
    if (one.value === '') return one[labels === 'mark' ? 'short' : labels].length + pad
    if (labels === 'mark') return mark + pad
    return mark + (isDesktop ? 0 : 1) + one[labels].length + pad
  })
  return items.reduce((sum, one) => sum + one, 0) + (items.length - 1) * (isDesktop ? 2 : 1) + (isDesktop ? 2 : 0)
}

/** The longest filter labels that fit a column on one line: the row never wraps. */
function filterLabelsFor(columnWidth: number, isDesktop: boolean): FilterLabels {
  return (['label', 'short'] as const).find(one => filterRowWidth(one, isDesktop) <= columnWidth) ?? 'mark'
}

/**
 * The home column's width beside an open note: enough for the full filter row
 * on one line (and a desktop's border and padding), else 42% of the pane, at
 * most `LEFT_MAX`.
 */
function leftWidthOf(width: number, isDesktop: boolean): number {
  const least = filterRowWidth('label', isDesktop) + (isDesktop ? 4 : 0)
  return Math.max(least, Math.min(LEFT_MAX, Math.floor(width * 0.42)))
}

/** Whether a pane keeps the home column beside an open note: the column fits the filters and the page keeps `PAGE_MIN`. */
function isWideOf(width: number, isDesktop: boolean): boolean {
  return width - leftWidthOf(width, isDesktop) - 3 >= PAGE_MIN
}

/** A note page's width: beside the home column on a wide pane, else the whole pane. */
function pageWidthOf(width: number, isDesktop: boolean): number {
  return isWideOf(width, isDesktop) ? width - leftWidthOf(width, isDesktop) - 3 : width
}

/** The cells the capture editor's text has across: the page less the editor box's border and padding. */
export function editorColumns(width: number, isDesktop: boolean): number {
  return Math.max(10, pageWidthOf(Math.max(24, width), isDesktop) - 4)
}

/** Whether a body column is on the note page rather than the home column beside it on a wide pane. */
export function isOverPage(column: number, width: number, isDesktop: boolean): boolean {
  return !isWideOf(width, isDesktop) || column > leftWidthOf(width, isDesktop) + 1
}

/** The background of the open note's row on a desktop, light and dark. */
const SELECTED_LIGHT = '#e4e4e0'
const SELECTED_DARK = '#32322f'
/** The accent (the desktop's `claude` colour) as a hex, for the bar on the open note's row there. */
const ACCENT = '#D97757'

/**
 * The magnifier before the search field on a desktop, where the ⌕ glyph is
 * a small mark: 15px, stroked in the muted grey of the appearance.
 */
export function searchIcon(isDark: boolean): string {
  const stroke = isDark ? '#9a9a93' : '#7a7a74'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"><circle cx="6.75" cy="6.75" r="4.5"/><path d="M10.25 10.25 14 14"/></svg>`
}

/** Whether a notebook is drawn closed: empty ones are, unless toggled; others are open unless toggled. */
export function isCollapsed(folder: string, count: number, collapsed: readonly string[]): boolean {
  return (count === 0) !== collapsed.includes(folder)
}

export function renderNotebookPane(
  els: ElementTable<FormSurface>,
  model: PaneModel,
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button, Input, Select, Markdown } = els
  // Every remote surface has Svg; the terminal has not.
  const Svg = 'Svg' in els ? els.Svg : undefined
  const width = Math.max(24, model.width)
  const measure = Math.min(width, MEASURE)
  const isDesktop = model.surface === 'desktop'
  // A desktop font draws some marks (▤) wider than a cell; their column is two cells there.
  const markWidth = isDesktop ? 2 : 1
  // On a wide pane an open note shares the width with the home page: the left column, a gap, a rule, a gap, the page.
  const isWide = isWideOf(width, isDesktop)
  const leftWidth = leftWidthOf(width, isDesktop)
  const pageMeasure = Math.min(pageWidthOf(width, isDesktop), MEASURE)
  const { notice, folders, query } = model
  const folderOptions = folders.names.map(name => ({ value: name, label: name }))
  // Each option is the type's mark, then its name; a Select draws its text in the surface's own colour.
  const typeOptions = ENTRY_TYPES.map(type => ({ value: type, label: `${TYPE_GLYPHS[type]} ${TYPE_LABELS[type]}` }))

  // A short status line: one phrase, an optional Open, Resume or Copy path, and a way to dismiss it.
  const noticeRow = notice ? (
    <Box gap={1} flexWrap="wrap" marginTop={1}>
      <Text color={notice.tone === 'error' ? 'error' : 'success'}>{notice.text}</Text>
      {notice.open !== undefined && (
        <Button key="open-saved" plain onPress={() => actions.open(notice.open ?? '')}>
          Open
        </Button>
      )}
      {notice.copy !== undefined && (
        <Button key="copy-notice" plain onPress={press => actions.copy(notice.copy ?? '', press.surface)}>
          Copy path
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

  /**
   * A dim rule across a column: under the filters and between notebooks. The
   * terminal gets one character per cell; a desktop lays text out in its own
   * font, where a row of characters is the wrong length, so it gets a markdown
   * rule that spans the column.
   */
  function rule(columnWidth: number): RenderElement {
    if (model.surface !== 'terminal') return <Markdown text="---" dimColor />
    return <Text dimColor>{'─'.repeat(Math.max(8, Math.min(columnWidth, width)))}</Text>
  }
  /** Rows of `│`, the terminal's rule between the home column and an open note. */
  function verticalRule(): RenderElement {
    return <Text dimColor>{Array.from({ length: Math.max(12, model.rows) }, () => '│').join('\n')}</Text>
  }

  /**
   * One line per note: the type mark and the title, with the notebook's name
   * after it in search results. The bar and the mark sit in columns of their
   * own, the mark centred in its column, so titles line up whatever width a
   * desktop font gives each glyph.
   *
   * On the terminal the row greys under the pointer, and the open note is
   * drawn in the accent colour instead of as a button. A desktop draws the
   * title as its native button, which lights under the pointer by itself and
   * sets the title off from the mark by its own padding: so there the row
   * adds no second highlight, and the open note stays a button too, marked by
   * the bar and a background, so every title sits at the same distance. The
   * button makes a desktop row taller than a line of text, so there the bar
   * is a box filled with the accent, stretched to the row's height, not the
   * `▌` glyph, which would stop short of the background.
   */
  function entryRow(
    entry: NotebookEntry,
    options: { withFolder: boolean; isSelected?: boolean; columnWidth?: number },
  ): RenderElement {
    const folder = options.withFolder ? entry.folder : ''
    const textWidth = Math.max(12, Math.min(options.columnWidth ?? measure, MEASURE) - 8 - (folder === '' ? 0 : folder.length + 1))
    const isSelected = options.isSelected === true
    const isButton = !isSelected || isDesktop
    return (
      <Box
        key={`row:${entry.id}`}
        flexDirection="row"
        alignItems={isDesktop ? 'stretch' : 'center'}
        gap={1}
        {...(isDesktop ? { paddingX: 1 } : { hover: { backgroundColor: model.hoverColor } })}
        {...(isDesktop && isSelected ? { backgroundColor: model.isDark ? SELECTED_DARK : SELECTED_LIGHT } : {})}
      >
        {isDesktop ? (
          <Box key={`bar:${entry.id}`} width={1} flexShrink={0} {...(isSelected ? { backgroundColor: ACCENT } : {})}>
            <Text> </Text>
          </Box>
        ) : (
          <Box width={1} flexShrink={0}>
            <Text color="claude">{isSelected ? '▌' : ' '}</Text>
          </Box>
        )}
        <Box width={markWidth} flexShrink={0} justifyContent="center" alignSelf="center">
          <Text color="claude">{TYPE_GLYPHS[entry.type]}</Text>
        </Box>
        <Box flexGrow={1} alignSelf="center">
          {isButton ? (
            <Button key={`entry:${entry.id}`} plain onPress={() => actions.open(entry.id)}>
              {oneLine(entry.title, textWidth)}
            </Button>
          ) : (
            <Text bold color="claude">
              {oneLine(entry.title, textWidth)}
            </Text>
          )}
        </Box>
        {folder !== '' && (
          <Box alignSelf="center">
            <Text dimColor>{folder}</Text>
          </Box>
        )}
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
    // The list filters as the person types, so Enter adds nothing. Every surface draws an Enter button beside
    // an Input and a mod can only name it, not drop it: an empty name falls back to "submit", so the name is a
    // zero-width space, which the terminal shows only while the field has focus. The desktop draws its button
    // always, so there the field is the mod's own one-row editor (`searchEditor`) in a bordered box.
    const input = (
      <Input
        key="search"
        placeholder="Search notes…"
        value={query}
        submitLabel={'\u200B'}
        onInput={value => actions.search(value)}
        onSubmit={value => actions.search(value)}
      />
    )
    return (
      <Box flexGrow={1} gap={1} alignItems="center">
        {isDesktop && Svg !== undefined ? (
          <Svg source={searchIcon(model.isDark)} alt="Search" width={15} height={15} />
        ) : (
          <Text dimColor>⌕</Text>
        )}
        {model.searchEditor !== undefined ? (
          <Box flexGrow={1} borderStyle="round" borderDimColor paddingX={1}>
            {model.searchEditor}
          </Box>
        ) : (
          <Box flexGrow={1}>{input}</Box>
        )}
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

  /** The buttons across the top of the home page, side by side, and the search field under them. */
  function toolbar(): RenderElement {
    return (
      <Box flexDirection="column">
        <Box gap={1} flexDirection="row" flexWrap="wrap">
          <Button key="new-note" variant="primary" onPress={() => actions.newNote()}>
            ✎ Write Note in Web
          </Button>
          <Button key="new-notebook-start" onPress={() => actions.toggleNewNotebook()}>
            + New Notebook
          </Button>
        </Box>
        {model.isNamingNotebook && newNotebookField()}
        <Box marginTop={1}>{searchField()}</Box>
      </Box>
    )
  }

  /**
   * The type filters on one line, never two: the longest labels that fit the
   * column (full, short, or the marks alone). Each type's has its mark in the
   * accent colour, as the rows show it, and its label grey, underlined under
   * the pointer. The active one's label is drawn underlined in the accent
   * colour (bold too on the terminal) instead of as a button: the mark alone
   * never says which filter is on.
   */
  function filterRow(active: '' | EntryType, columnWidth: number): RenderElement {
    const labels = filterLabelsFor(columnWidth, isDesktop)
    const filterButton = (one: (typeof TYPE_FILTERS)[number]) => {
      const key = `filter:${one.value || 'all'}`
      const text = labels === 'mark' ? (one.value === '' ? one.short : TYPE_GLYPHS[one.value]) : one[labels]
      const isActive = one.value === active
      // The active label is text where a plain button's label sits. A desktop's plain button pads its label about
      // two thirds of a cell each side; the same padding keeps the text in place when it becomes active, and no
      // bold there keeps its width, so the labels after it stay put too.
      const button = isActive ? (
        <Box key={key} {...(isDesktop ? { paddingX: 0.65 } : {})}>
          <Text bold={!isDesktop} underline color="claude">
            {text}
          </Text>
        </Box>
      ) : (
        <Button key={key} plain dimColor hover={{ underline: true }} onPress={() => actions.filterType(one.value)}>
          {text}
        </Button>
      )
      const mark = labels !== 'mark' && one.value !== '' ? <Text color="claude">{TYPE_GLYPHS[one.value]}</Text> : null
      // The keyed Box is the hover's scope: the label underlines with the pointer over it or its mark.
      return (
        <Box key={`filter-item:${one.value || 'all'}`} gap={isDesktop ? 0 : 1} alignItems="center">
          {mark}
          {button}
        </Box>
      )
    }
    return (
      <Box gap={isDesktop ? 2 : 1} marginTop={1} alignItems="center">
        {TYPE_FILTERS.map(filterButton)}
      </Box>
    )
  }

  function emptyState(): RenderElement {
    return (
      <Box flexDirection="column" alignItems="center" marginTop={2}>
        <Text color="claude">▤</Text>
        <Text bold>No notes yet</Text>
        <Text dimColor>Save useful insights, learnings, and references from your conversations.</Text>
      </Box>
    )
  }

  // ------------------------------------------------------------ views --

  /**
   * A note page, for a capture not yet saved, a saved note, and a saved note
   * being edited: `←` and the breadcrumb, the page's buttons (Discard and
   * Save; or Edit and Open in web) and, when the page has a menu, `⋯` before
   * them; the body, and its dates under it (created, and last edited when
   * that is a later minute; a capture shows when it was captured). A
   * capture's or an edit's body is the editor with its toolbar, under a row
   * with the notebook and type pickers; a saved note's is its text, read-only.
   * On a capture or an edit the breadcrumb's title is a control: pressed, a
   * field takes its place (`titleEdit`), and Enter puts the title back. Only
   * a saved note has a menu behind `⋯`: Archive and Delete.
   */
  function notePage(options: {
    folder: string
    content: string
    dates: NoteDates
    title: string
    action: RenderElement
    menu?: RenderElement
    body?: RenderElement
    /** The capture or edit page's title, editable in the breadcrumb: the field's key, the title as typed so far, and what a change does. */
    titleEdit?: { key: string; value: string; onTitle: (title: string) => void }
    /** The capture or edit page's picker row, under the header. */
    titleField?: RenderElement
  }): RenderElement {
    const shownTitle = oneLine(options.title, Math.max(12, pageMeasure - options.folder.length - 20))
    const titleEdit = options.titleEdit
    const isEditingTitle = titleEdit !== undefined && model.isEditingTitle
    // The page is as tall as the pane's body, the body growing to fill it: the outline reaches down to the dates, which sit at the bottom.
    return (
      <Box flexDirection="column" flexGrow={1} {...(model.rows > 0 ? { minHeight: model.rows } : {})}>
        <Box justifyContent="space-between" gap={1}>
          <Box gap={1} flexGrow={isEditingTitle ? 1 : 0}>
            <Button key="home-icon" plain dimColor onPress={() => actions.home()}>
              ←
            </Button>
            <Box gap={1} flexGrow={isEditingTitle ? 1 : 0} alignItems="center">
              <Text dimColor>{options.folder}</Text>
              <Text dimColor>/</Text>
              {titleEdit === undefined ? (
                <Text bold>{shownTitle}</Text>
              ) : isEditingTitle ? (
                // The title is edited in place, across the rest of the row, with no box around it: the mod's own one-row
                // editor (Enter puts the title back). A surface without Client gets a field instead.
                <Box flexGrow={1} minWidth={16}>
                  {model.titleEditor ?? (
                    <Input
                      key={titleEdit.key}
                      autoFocus
                      placeholder={shownTitle}
                      value={titleEdit.value}
                      onInput={titleEdit.onTitle}
                      onSubmit={title => {
                        titleEdit.onTitle(title)
                        actions.endTitleEdit()
                      }}
                    />
                  )}
                </Box>
              ) : (
                <Button key={titleEdit.key} plain onPress={() => actions.beginTitleEdit()}>
                  {shownTitle}
                </Button>
              )}
            </Box>
          </Box>
          <Box gap={1}>
            {options.menu !== undefined && (
              <Button key="page-more" plain dimColor onPress={() => actions.toggleMenu()}>
                ⋯
              </Button>
            )}
            {options.action}
          </Box>
        </Box>
        {options.menu !== undefined && model.isMenuOpen && (
          <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderDimColor>
            {options.menu}
          </Box>
        )}
        {options.titleField}
        {options.body ?? (
          <Box flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
            <Markdown text={options.content} />
          </Box>
        )}
        <Box gap={2} flexWrap="wrap">
          {dateLines(options.dates).map(line => (
            <Text key={`date:${line}`} dimColor>
              {line}
            </Text>
          ))}
        </Box>
        {noticeRow}
      </Box>
    )
  }

  /**
   * The editor, for a capture or a saved note being edited: a row of
   * formatting buttons over the editor, Show preview at its right end, and,
   * once that is pressed, under the editor the text rendered as it will
   * read, updated as it is typed, until Hide preview folds it away again.
   * The editor's outline grows to the page's bottom; the dates sit under it.
   */
  function captureEditor(content: string): RenderElement {
    const tool = (key: string, label: string, kind: string) => (
      <Button key={key} plain onPress={() => actions.format(kind)}>
        {label}
      </Button>
    )
    // A heading button on a line already at that level makes it normal text again.
    const heading = (level: 'h1' | 'h2' | 'h3') => tool(`fmt-${level}`, level.toUpperCase(), model.editorHeading === level ? 'normal' : level)
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box gap={1} marginTop={1} justifyContent="space-between" alignItems="center">
          <Box gap={1} flexWrap="wrap" alignItems="center">
            {heading('h1')}
            {heading('h2')}
            {heading('h3')}
            {tool('fmt-bold', 'B', 'bold')}
            {tool('fmt-italic', 'I', 'italic')}
            {tool('fmt-code', '</>', 'code')}
            {tool('fmt-link', 'Link', 'link')}
            {tool('fmt-bullet', '• List', 'bullet')}
            {tool('fmt-number', '1. List', 'number')}
            {tool('fmt-quote', 'Quote', 'quote')}
          </Box>
          {model.editor !== undefined && (
            <Button key="preview" plain onPress={() => actions.togglePreview()}>
              {model.isPreviewShown ? 'Hide preview' : 'Show preview'}
            </Button>
          )}
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
          {model.editor ?? (
            <Box flexDirection="column">
              <Markdown text={content} />
              <Text dimColor>Editing needs the terminal or the desktop app.</Text>
            </Box>
          )}
        </Box>
        {model.editor !== undefined && model.isPreviewShown && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Preview</Text>
            <Box key="preview-body" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
              {content.trim() === '' ? <Text dimColor>Nothing to preview yet.</Text> : <Markdown text={content} />}
            </Box>
          </Box>
        )}
      </Box>
    )
  }

  /**
   * The row under an editor page's header: the notebook picker and the type
   * picker; on a narrow pane the type picker wraps under the notebook's. The
   * title is edited in the breadcrumb itself.
   */
  function pickerRow(options: {
    folderKey: string
    folder: string
    onFolder: (folder: string) => void
    typeKey: string
    typeOptions: ReadonlyArray<{ value: string; label: string }>
    type: string
    onType: (value: string) => void
  }): RenderElement {
    return (
      <Box marginTop={1} gap={1} alignItems="center" flexWrap="wrap">
        <Box flexShrink={0}>
          <Select key={options.folderKey} label="Notebook" options={folderOptions} value={options.folder} onSelect={options.onFolder} />
        </Box>
        <Box flexShrink={0}>
          <Select key={options.typeKey} label="Type" options={options.typeOptions} value={options.type} onSelect={options.onType} />
        </Box>
      </Box>
    )
  }

  /** Discard, dim, before the page's main button. */
  function discardButton(key: string, onPress: () => void): RenderElement {
    return (
      <Button key={key} plain dimColor onPress={onPress}>
        Discard
      </Button>
    )
  }

  /** The editor pages' top right: Save. */
  function editorActions(saveKey: string, onSave: () => void): RenderElement {
    return (
      <Button key={saveKey} variant="primary" onPress={onSave}>
        {model.isSaving ? 'Saving…' : 'Save'}
      </Button>
    )
  }

  /**
   * A page beside the home page when the pane is wide enough for both. On
   * the terminal a rule of `│` stands between them; a desktop, whose glyphs
   * would sit apart, draws a dim border around the home column instead, the
   * pane's full height.
   */
  function withOverview(page: RenderElement, selectedId?: string): RenderElement {
    if (!isWide) return page
    if (isDesktop) {
      return (
        <Box flexDirection="row" gap={1} minHeight={Math.max(12, model.rows)}>
          <Box flexDirection="column" width={leftWidth} flexShrink={0} borderStyle="round" borderDimColor paddingX={1}>
            {homeView(leftWidth - 4, selectedId, false)}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {page}
          </Box>
        </Box>
      )
    }
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
    return withOverview(notePage({
      folder: draft.folder,
      content: draft.content,
      dates: { captured: draft.source.capturedAt },
      title: (draft.title ?? '').trim() !== '' ? (draft.title ?? '') : draft.content.trim() === '' ? 'Untitled' : deriveTitle(draft.content),
      // Left empty, the note is titled from its text when it is saved; left Other, it is typed by the model.
      titleEdit: { key: 'draft-title', value: draft.title ?? '', onTitle: title => actions.setDraftTitle(title) },
      titleField: pickerRow({
        folderKey: 'folder',
        folder: draft.folder,
        onFolder: folder => actions.setDraftFolder(folder),
        typeKey: 'draft-type',
        typeOptions,
        type: draft.type ?? 'other',
        onType: value => actions.setDraftType(isEntryType(value) && value !== 'other' ? value : undefined),
      }),
      body: captureEditor(draft.content),
      action: (
        <Box gap={1}>
          {discardButton('cancel', () => actions.cancel())}
          {editorActions('save', () => actions.save())}
        </Box>
      ),
    }))
  }

  if (model.view.kind === 'edit' && model.edit) {
    const edit = model.edit
    const entry = model.entries.find(one => one.id === edit.entryId)
    if (entry !== undefined) {
      return withOverview(notePage({
        folder: edit.folder ?? entry.folder,
        content: edit.content,
        dates: { created: entry.createdAt, updated: entry.updatedAt },
        title: edit.title.trim() === '' ? entry.title : edit.title,
        titleEdit: { key: 'edit-title', value: edit.title, onTitle: title => actions.setEditTitle(title) },
        titleField: pickerRow({
          folderKey: 'edit-folder',
          folder: edit.folder ?? entry.folder,
          onFolder: folder => actions.setEditFolder(folder),
          typeKey: 'edit-type',
          typeOptions,
          type: edit.type ?? entry.type,
          onType: value => actions.setEditType(isEntryType(value) ? value : 'other'),
        }),
        body: captureEditor(edit.content),
        action: (
          <Box gap={1}>
            {discardButton('cancel-edit', () => actions.cancelEdit())}
            {editorActions('save-edit', () => actions.saveEdit())}
          </Box>
        ),
      }), entry.id)
    }
  }

  if (model.view.kind === 'note') {
    const entryId = model.view.entryId
    const entry = model.entries.find(one => one.id === entryId)
    if (entry !== undefined) {
      const isArmed = model.view.isDeleteArmed === true
      return withOverview(notePage({
        folder: entry.folder,
        content: entry.content,
        dates: { created: entry.createdAt, updated: entry.updatedAt },
        title: entry.title,
        action: (
          <Box gap={1}>
            <Button key="edit" onPress={() => actions.edit(entry.id)}>
              Edit
            </Button>
            <Button key="open-in-web" variant="primary" onPress={() => actions.openInWeb(entry.id)}>
              Open in web
            </Button>
          </Box>
        ),
        menu: (
          <Box flexDirection="column">
            <Box gap={1} flexWrap="wrap">
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
        ),
      }), entry.id)
    }
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
              <Box key={`nb-row:${name}`} flexDirection="column" marginTop={isDesktop ? 0 : 1}>
                {rule(columnWidth)}
                <Box justifyContent="space-between" gap={1} {...(isDesktop ? { paddingX: 1 } : {})}>
                  <Box gap={1} alignItems="center">
                    <Box width={2} flexShrink={0}>
                      <Button key={`nb:${name}`} plain dimColor onPress={() => actions.toggleNotebook(name)}>
                        {closed ? '›' : '⌄'}
                      </Button>
                    </Box>
                    <Text bold>{name}</Text>
                  </Box>
                  <Box gap={1} alignItems="center">
                    {notes.length > 0 && (
                      <Button key={`export:${name}`} plain dimColor onPress={() => actions.exportNotebook(name)}>
                        Export
                      </Button>
                    )}
                    <Text dimColor>{String(notes.length)}</Text>
                  </Box>
                </Box>
                {!closed && notes.length === 0 && (
                  <Box {...(isDesktop ? { paddingX: 1 } : {})}>
                    <Text dimColor>No notes yet.</Text>
                  </Box>
                )}
                {!closed && <Box flexDirection="column">{rows(notes, false, columnWidth, selectedId)}</Box>}
              </Box>
            )
          })}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {toolbar()}
        {filterRow(typeFilter, columnWidth)}
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
