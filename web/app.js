/* Live Notebook web app: notebooks and notes in the sidebar, one note open
 * in a Vditor instant-rendering editor, autosaved to its markdown file
 * through the local server. Plain script, no build step. */
;(() => {
  // Vditor ships with the notebook (web/vendor/vditor), so the page needs no network and loads no one else's script.
  const VDITOR_CDN = '/vendor/vditor'
  const $ = id => document.getElementById(id)
  const els = {
    tree: $('tree'),
    search: $('search'),
    status: $('status'),
    bootStatus: $('boot-status'),
    empty: $('empty'),
    note: $('note'),
    title: $('title'),
    crumb: $('crumb-notebook'),
    dates: $('meta-dates'),
    type: $('note-type'),
    newNotebookForm: $('new-notebook-form'),
    newNotebookName: $('new-notebook-name'),
    newNotebookCancel: $('new-notebook-cancel'),
    newNote: $('new-note'),
    newNotebook: $('new-notebook'),
    deleteNote: $('delete-note'),
    menu: $('context-menu'),
    inbox: $('inbox'),
    inboxList: $('inbox-list'),
    inboxCount: $('inbox-count'),
    reply: $('reply'),
    replyFrom: $('reply-from'),
    replyTitle: $('reply-title'),
    replyNotebook: $('reply-notebook'),
    replySave: $('reply-save'),
    replyStatus: $('reply-status'),
    replyDiscard: $('reply-discard'),
    replyBody: $('reply-body'),
  }

  /** How an inbox item names the agent whose hook kept it. */
  const AGENTS = { 'claude-code': 'Claude Code', cursor: 'Cursor', codex: 'Codex', gemini: 'Gemini CLI' }

  const state = {
    notebooks: [],
    open: null, // { path, meta, content }
    editor: null,
    dirty: false,
    saveTimer: null,
    query: '',
    /** The server's search answer: `{ query, paths }`, or null before one. */
    hits: null,
    searchTimer: null,
    collapsed: new Set(),
    /** True once the person typed in the title field of the open note. */
    titleTouched: false,
    /** `{ path, folder }` while a note row is being dragged to another notebook. */
    dragging: null,
    /** The paths of the notes picked with ⌘-click or shift-click; the menu then acts on all of them. */
    selection: new Set(),
    /** Where a shift-click's range starts: the row last clicked with a modifier. */
    anchor: null,
    /** Replies an agent's hook kept (`live-notebook hook`), newest first. */
    inbox: [],
    /** The inbox item open in the main area, or null. */
    reply: null,
  }

  /** The first meaningful line of the text, without markdown markers. */
  function titleOf(content) {
    const line = content
      .split('\n')
      .map(l => l.trim())
      .find(l => l !== '' && !l.startsWith('```'))
    if (line === undefined) return ''
    return line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*>]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/[`*_]/g, '')
      .trim()
      .slice(0, 80)
  }

  // ---------------------------------------------------------------- api --

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.json()).error ?? ''
      } catch {
        /* none */
      }
      throw new Error(`${method} ${path} failed (${response.status}) ${detail}`.trim())
    }
    return response.status === 204 ? null : response.json()
  }

  // Only errors are shown, beside the note's meta line (or under the welcome
  // text before a note opens); saving and loading go without a word.
  function setStatus(text, tone) {
    const quiet = tone === 'error' ? text : ''
    els.status.textContent = quiet
    els.status.dataset.tone = tone ?? ''
    els.bootStatus.textContent = tone === 'error' ? quiet : ''
    els.bootStatus.dataset.tone = tone ?? ''
  }

  // --------------------------------------------------------------- tree --

  // Each note's type, marked as the Notebook pane in Claude Code marks it.
  const TYPES = {
    insight: { glyph: '◉', label: 'Insight' },
    learning: { glyph: '↗', label: 'Learning' },
    reference: { glyph: '▤', label: 'Reference' },
    other: { glyph: '•', label: 'Other' },
  }

  /** The mark on a pinned note's row. */
  const PIN_SVG =
    '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" transform="rotate(45 8 8)" d="M5 1h6v2h-1v5h2v2H9v5H7v-5H4V8h2V3H5z"/></svg>'

  function formatDate(iso) {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  /** Under the title: when the note was created and, if it was edited in a later minute, when it was last edited. */
  function showDates(meta) {
    const created = formatDate(meta.created)
    const edited = formatDate(meta.updated)
    const parts = []
    if (created !== '') parts.push(`Created ${created}`)
    if (edited !== '' && edited !== created) parts.push(`Edited ${edited}`)
    els.dates.textContent = parts.join(' · ')
  }

  /**
   * Whether a note matches the search: the server's answer for the query
   * (every word of every note, and its tags) once it has come, the title and
   * opening lines meanwhile.
   */
  function matches(note, query) {
    if (query === '') return true
    if (state.hits !== null && state.hits.query === query) return state.hits.paths.has(note.path)
    const q = query.toLowerCase()
    return note.title.toLowerCase().includes(q) || note.preview.toLowerCase().includes(q)
  }

  async function searchNotes(query) {
    try {
      const result = await api('GET', `/api/search?q=${encodeURIComponent(query)}`)
      if (state.query.trim() !== query) return
      state.hits = { query, paths: new Set(result.paths) }
      renderTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  function renderTree() {
    els.tree.replaceChildren()
    const query = state.query.trim()
    for (const notebook of state.notebooks) {
      const notes = notebook.notes.filter(note => matches(note, query))
      if (query !== '' && notes.length === 0) continue
      const section = document.createElement('section')
      section.className = 'notebook'
      // A note row dragged over another notebook than its own can be dropped there to move it.
      section.addEventListener('dragover', event => {
        if (!state.dragging || state.dragging.folder === notebook.name) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        markDropTarget(section)
      })
      section.addEventListener('dragleave', event => {
        if (event.relatedTarget instanceof Node && section.contains(event.relatedTarget)) return
        section.classList.remove('drop-target')
      })
      section.addEventListener('drop', event => {
        if (!state.dragging || state.dragging.folder === notebook.name) return
        event.preventDefault()
        const { path } = state.dragging
        endDrag()
        void moveNote(path, notebook.name)
      })

      const head = document.createElement('div')
      head.className = 'notebook-head'
      // A caret before the name marks the row as a notebook, not a note: `›` closed, turned down open.
      head.innerHTML = `<span class="head-start"><span class="head-caret" aria-hidden="true">›</span><span class="name"></span>${
        notebook.pinned ? `<span class="head-pin" title="Pinned">${PIN_SVG}</span>` : ''
      }</span><span class="head-end"><button class="head-action" type="button">Export</button><span class="count"></span></span>`
      head.querySelector('.name').textContent = notebook.name
      head.querySelector('.count').textContent = String(notebook.count)
      head.title = state.collapsed.has(notebook.name) ? 'Expand' : 'Collapse'
      head.classList.toggle('open', !state.collapsed.has(notebook.name))
      head.addEventListener('click', () => {
        if (state.collapsed.has(notebook.name)) state.collapsed.delete(notebook.name)
        else state.collapsed.add(notebook.name)
        renderTree()
      })
      // Right-click: Pin, Archive, Delete the notebook.
      head.addEventListener('contextmenu', event => {
        event.preventDefault()
        openNotebookMenu(notebook, head, event)
      })
      // Export, at the head's right end, shows under the pointer; an empty notebook has nothing to export.
      const exportButton = head.querySelector('.head-action')
      exportButton.hidden = notebook.count === 0
      exportButton.title = `Export ${notebook.name} as one markdown file`
      exportButton.setAttribute('aria-label', `Export ${notebook.name}`)
      exportButton.addEventListener('click', event => {
        event.stopPropagation()
        exportNotebook(notebook.name)
      })
      section.append(head)

      if (Array.isArray(notebook.tags) && notebook.tags.length > 0) {
        const tags = document.createElement('div')
        tags.className = 'notebook-tags'
        for (const tag of notebook.tags.slice(0, 3)) {
          const chip = document.createElement('span')
          chip.className = 'tag'
          chip.textContent = `#${tag}`
          tags.append(chip)
        }
        section.append(tags)
      } else if (notebook.count === 0) {
        const none = document.createElement('div')
        none.className = 'notebook-summary'
        none.textContent = 'No notes yet.'
        section.append(none)
      }

      if (!state.collapsed.has(notebook.name) || query !== '') {
        for (const note of notes) {
          const row = document.createElement('button')
          row.type = 'button'
          row.className =
            'note-row' +
            (state.open && state.open.path === note.path ? ' selected' : '') +
            (state.selection.has(note.path) ? ' picked' : '')
          row.dataset.path = note.path
          row.innerHTML = `<span class="row-head"><span class="row-mark"></span><span class="row-title"></span>${
            note.pinned ? `<span class="row-pin" title="Pinned">${PIN_SVG}</span>` : ''
          }</span><span class="row-preview"></span>`
          const type = TYPES[note.type] ?? TYPES.other
          row.querySelector('.row-mark').textContent = type.glyph
          row.querySelector('.row-mark').title = type.label
          row.querySelector('.row-title').textContent = note.title
          row.querySelector('.row-preview').textContent = note.preview || '—'
          // A plain click opens the note; ⌘-click (ctrl-click) adds it to or takes it from the picked notes, and
          // shift-click picks every row from the last one clicked with a modifier to this one.
          row.addEventListener('click', event => {
            if (event.metaKey || event.ctrlKey) togglePicked(note.path)
            else if (event.shiftKey) pickRange(note.path)
            else {
              clearPicked()
              void openNote(note.path)
            }
          })
          // Right-click (or the keyboard's menu key): Pin, Archive, Delete, for every picked note when this is one of them.
          row.addEventListener('contextmenu', event => {
            event.preventDefault()
            if (!state.selection.has(note.path)) {
              state.selection = new Set([note.path])
              state.anchor = note.path
              applyPicked()
            }
            openMenu(pickedNotes(), row, event)
          })
          // Drag onto another notebook to move the note there.
          row.draggable = true
          row.addEventListener('dragstart', event => {
            closeMenu()
            state.dragging = { path: note.path, folder: notebook.name }
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', note.path)
            row.classList.add('dragging')
          })
          row.addEventListener('dragend', endDrag)
          section.append(row)
        }
      }
      els.tree.append(section)
    }
    if (state.notebooks.length === 0) {
      const none = document.createElement('div')
      none.className = 'notebook-summary'
      none.textContent = 'No notebooks yet. Save something from Claude Code, or make a notebook here.'
      els.tree.append(none)
    }
  }

  /** The file name an export suggests, as the server names a download. */
  function slugOf(text) {
    const slug = String(text)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '')
    return slug === '' ? 'notebook' : slug
  }

  /**
   * Export: the notebook as one file, markdown by default or plain text when
   * the Save dialog's format (or the name typed) says `.txt`. A browser with a
   * Save dialog of its own (Chrome, Edge) asks where; another downloads the
   * markdown under the name the server gives it. The suggested name carries no
   * extension: the dialog appends the one its Format popup says (macOS leaves a
   * typed `.md` alone when the format changes, so a suggested `.md` would save
   * plain text as `name.md.txt`).
   */
  async function exportNotebook(name) {
    const urlOf = format => `/api/export?name=${encodeURIComponent(name)}&format=${format}`
    if (typeof window.showSaveFilePicker !== 'function') {
      const link = document.createElement('a')
      link.href = urlOf('md')
      link.download = ''
      document.body.append(link)
      link.click()
      link.remove()
      return
    }
    let handle
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: slugOf(name),
        types: [
          { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
          { description: 'Plain text', accept: { 'text/plain': ['.txt'] } },
        ],
      })
    } catch (error) {
      if (error && error.name === 'AbortError') return // Cancel
      setStatus(error.message, 'error')
      return
    }
    try {
      const response = await fetch(urlOf(/\.txt$/i.test(handle.name) ? 'txt' : 'md'))
      if (!response.ok) throw new Error(`Export failed (${response.status})`)
      const writable = await handle.createWritable()
      await writable.write(await response.blob())
      await writable.close()
    } catch (error) {
      setStatus(`Export failed: ${error.message}`, 'error')
    }
  }

  async function refreshTree() {
    const [{ notebooks }, { items }] = await Promise.all([api('GET', '/api/tree'), api('GET', '/api/inbox')])
    state.inbox = items
    // A reply filed or dropped elsewhere (another tab) closes here too.
    if (state.reply && !items.some(item => item.name === state.reply.name)) closeReply()
    renderInbox()
    state.notebooks = notebooks
    // A note saved or edited since the last search may match now.
    if (state.query.trim() !== '') void searchNotes(state.query.trim())
    // A picked note that is gone (deleted, archived, saved elsewhere) leaves the pick.
    const present = new Set(allNotes().map(note => note.path))
    for (const path of [...state.selection]) if (!present.has(path)) state.selection.delete(path)
    renderTree()
  }

  // --------------------------------------------------------- picking --

  function allNotes() {
    return state.notebooks.flatMap(notebook => notebook.notes)
  }

  /** The picked notes, in the tree's order. */
  function pickedNotes() {
    return allNotes().filter(note => state.selection.has(note.path))
  }

  /** The rows show the pick without the tree being drawn again (so a row under the pointer keeps its place). */
  function applyPicked() {
    for (const row of els.tree.querySelectorAll('.note-row')) row.classList.toggle('picked', state.selection.has(row.dataset.path))
  }

  function clearPicked() {
    if (state.selection.size === 0) return
    state.selection.clear()
    applyPicked()
  }

  function togglePicked(path) {
    if (state.selection.has(path)) state.selection.delete(path)
    else state.selection.add(path)
    state.anchor = path
    applyPicked()
  }

  function pickRange(path) {
    const order = [...els.tree.querySelectorAll('.note-row')].map(row => row.dataset.path)
    const from = order.indexOf(state.anchor ?? path)
    const to = order.indexOf(path)
    if (from < 0 || to < 0) return togglePicked(path)
    for (const one of order.slice(Math.min(from, to), Math.max(from, to) + 1)) state.selection.add(one)
    applyPicked()
  }

  // ------------------------------------------------------ drag and menu --

  function markDropTarget(section) {
    for (const one of els.tree.querySelectorAll('.drop-target')) {
      if (one !== section) one.classList.remove('drop-target')
    }
    section.classList.add('drop-target')
  }

  function endDrag() {
    state.dragging = null
    for (const one of els.tree.querySelectorAll('.drop-target, .dragging')) one.classList.remove('drop-target', 'dragging')
  }

  /**
   * The menu on a note row: Pin or Unpin, Archive, Delete, each with the count
   * when several notes are picked (Pin 4, Archive 4, Delete 4); Unpin when
   * every one of them is pinned.
   */
  function openMenu(notes, row, event) {
    const count = notes.length
    const suffix = count > 1 ? ` ${count}` : ''
    const allPinned = notes.every(note => note.pinned)
    showMenu(
      [
        { label: `${allPinned ? 'Unpin' : 'Pin'}${suffix}`, run: () => setPinned(notes, !allPinned) },
        { label: `Archive${suffix}`, run: () => archiveNotes(notes) },
        { label: `Delete${suffix}`, run: () => deleteNotes(notes), danger: true },
      ],
      row,
      event,
      count > 1 ? `${count} notes` : 'Note actions',
    )
  }

  /** The menu on a notebook's head: Pin or Unpin, Archive, Delete the notebook. */
  function openNotebookMenu(notebook, head, event) {
    showMenu(
      [
        { label: notebook.pinned ? 'Unpin notebook' : 'Pin notebook', run: () => setNotebookPinned(notebook, !notebook.pinned) },
        { label: 'Archive notebook', run: () => archiveNotebook(notebook) },
        { label: 'Delete notebook', run: () => deleteNotebook(notebook), danger: true },
      ],
      head,
      event,
      'Notebook actions',
    )
  }

  /** The menu's items, at the pointer, kept inside the window. */
  function showMenu(items, row, event, label) {
    closeMenu()
    els.menu.setAttribute('aria-label', label)
    for (const item of items) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'menu-item' + (item.danger ? ' danger' : '')
      button.setAttribute('role', 'menuitem')
      button.textContent = item.label
      button.addEventListener('click', () => {
        closeMenu()
        void item.run()
      })
      els.menu.append(button)
    }
    els.menu.hidden = false
    // The keyboard's menu key reports no pointer position: the menu opens under the row instead.
    const rect = row.getBoundingClientRect()
    const atPointer = event.clientX > 0 || event.clientY > 0
    const x = atPointer ? event.clientX : rect.left + 16
    const y = atPointer ? event.clientY : rect.bottom
    els.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - els.menu.offsetWidth - 8))}px`
    els.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - els.menu.offsetHeight - 8))}px`
    els.menu.querySelector('.menu-item').focus()
  }

  function closeMenu() {
    els.menu.hidden = true
    els.menu.replaceChildren()
  }

  els.menu.addEventListener('contextmenu', event => event.preventDefault())
  els.menu.addEventListener('keydown', event => {
    const items = [...els.menu.querySelectorAll('.menu-item')]
    const at = items.indexOf(document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      closeMenu()
    }
  })
  document.addEventListener('pointerdown', event => {
    if (!els.menu.hidden && !els.menu.contains(event.target)) closeMenu()
  })
  els.tree.addEventListener('scroll', closeMenu)
  window.addEventListener('resize', closeMenu)
  window.addEventListener('blur', closeMenu)

  // ------------------------------------------------------------- editor --

  // The editor stays in instant rendering: Vditor's mode shortcuts (⌘⌥7/8/9) are
  // caught on the way down, before its own handlers see them.
  document.getElementById('editor').addEventListener(
    'keydown',
    event => {
      if ((event.metaKey || event.ctrlKey) && event.altKey && ['Digit7', 'Digit8', 'Digit9'].includes(event.code)) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    true,
  )

  function ensureEditor(initial) {
    return new Promise(resolve => {
      if (state.editor) {
        state.editor.setValue(initial, true)
        resolve(state.editor)
        return
      }
      const editor = new Vditor('editor', {
        mode: 'ir',
        cdn: VDITOR_CDN,
        lang: 'en_US',
        height: 'auto',
        minHeight: 420,
        value: initial,
        placeholder: 'Write in markdown. The syntax fades as you type.',
        cache: { enable: false },
        counter: { enable: false },
        toolbarConfig: { pin: false },
        toolbar: [
          'headings',
          'bold',
          'italic',
          'strike',
          '|',
          'list',
          'ordered-list',
          'check',
          'quote',
          'code',
          'inline-code',
          'link',
          'table',
          '|',
          'undo',
          'redo',
        ],
        preview: {
          markdown: { toc: true, mark: true },
          math: { engine: 'KaTeX' },
          hljs: { lineNumber: false },
        },
        input: () => markDirty(),
        after: () => {
          state.editor = editor
          resolve(editor)
        },
      })
    })
  }

  function markDirty() {
    if (!state.open) return
    state.dirty = true
    setStatus('Editing…')
    clearTimeout(state.saveTimer)
    state.saveTimer = setTimeout(() => void save(), 700)
  }

  async function save() {
    if (!state.open || !state.dirty || !state.editor) return
    const target = state.open
    const content = state.editor.getValue()
    let title = els.title.value.trim()
    if (title === '' || title === 'Untitled' || (!state.titleTouched && title === titleOf(target.content ?? ''))) {
      // Still titled from its first line: it follows that line. A title the
      // person or Claude Code gave the note stays.
      const derived = titleOf(content)
      if (derived !== '') {
        title = derived
        els.title.value = derived
      }
    }
    try {
      const result = await api('PUT', `/api/note?path=${encodeURIComponent(target.path)}`, { content, title })
      state.dirty = false
      target.content = content
      target.meta = { ...target.meta, ...result.meta }
      showDates(target.meta)
      setStatus('')
      await refreshTree()
    } catch (error) {
      setStatus(`Save failed: ${error.message}`, 'error')
    }
  }

  async function openNote(path) {
    if (state.dirty) await save()
    try {
      const note = await api('GET', `/api/note?path=${encodeURIComponent(path)}`)
      state.open = note
      state.dirty = false
      state.titleTouched = false
      els.empty.hidden = true
      els.reply.hidden = true
      state.reply = null
      els.note.hidden = false
      els.crumb.textContent = note.meta.folder ?? path.split('/')[0]
      els.title.value = note.meta.title ?? ''
      showDates(note.meta)
      els.type.value = TYPES[note.meta.type] ? note.meta.type : 'other'
      location.hash = `#/${encodeURIComponent(path)}`
      await ensureEditor(note.content)
      setStatus('Ready')
      renderTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  // ------------------------------------------------------------- inbox --

  function agentLabel(agent) {
    return AGENTS[agent] ?? agent
  }

  function renderInbox() {
    els.inbox.hidden = state.inbox.length === 0
    els.inboxCount.textContent = String(state.inbox.length)
    els.inboxList.replaceChildren()
    for (const item of state.inbox) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'note-row' + (state.reply && state.reply.name === item.name ? ' selected' : '')
      row.innerHTML = '<span class="row-head"><span class="row-title"></span></span><span class="row-preview"></span>'
      row.querySelector('.row-title').textContent = titleOf(item.text) || 'Untitled reply'
      const when = formatDate(item.capturedAt)
      row.querySelector('.row-preview').textContent = [agentLabel(item.agent), item.project, when].filter(Boolean).join(' · ')
      row.addEventListener('click', () => void openReply(item.name))
      els.inboxList.append(row)
    }
  }

  /** A kept reply in the main area, read-only, with the notebook to file it in. */
  async function openReply(name) {
    const item = state.inbox.find(one => one.name === name)
    if (!item) return
    if (state.dirty) await save()
    state.open = null
    state.reply = item
    els.note.hidden = true
    els.empty.hidden = true
    els.reply.hidden = false
    els.replyFrom.textContent = [agentLabel(item.agent), item.project, formatDate(item.capturedAt)].filter(Boolean).join(' · ')
    els.replyTitle.textContent = titleOf(item.text) || 'Untitled reply'
    els.replyStatus.textContent = ''
    const names = state.notebooks.map(notebook => notebook.name)
    if (names.length === 0) names.push('General')
    els.replyNotebook.replaceChildren(
      ...names.map(nameOf => {
        const option = document.createElement('option')
        option.value = nameOf
        option.textContent = nameOf
        return option
      }),
    )
    els.replyBody.textContent = item.text
    if (window.Vditor) window.Vditor.preview(els.replyBody, item.text, { cdn: VDITOR_CDN, lang: 'en_US', math: { engine: 'KaTeX' }, hljs: { lineNumber: false } })
    location.hash = ''
    renderInbox()
    renderTree()
  }

  function closeReply() {
    state.reply = null
    els.reply.hidden = true
    if (!state.open) els.empty.hidden = false
  }

  async function saveReply() {
    if (!state.reply) return
    try {
      const note = await api('POST', '/api/inbox', { name: state.reply.name, folder: els.replyNotebook.value })
      closeReply()
      state.collapsed.delete(note.meta.folder)
      await refreshTree()
      await openNote(note.path)
    } catch (error) {
      els.replyStatus.textContent = error.message
    }
  }

  async function discardReply() {
    if (!state.reply) return
    try {
      await api('DELETE', `/api/inbox?name=${encodeURIComponent(state.reply.name)}`)
      closeReply()
      await refreshTree()
    } catch (error) {
      els.replyStatus.textContent = error.message
    }
  }

  function closeNote() {
    state.open = null
    els.note.hidden = true
    els.empty.hidden = false
    location.hash = ''
    renderTree()
  }

  // ------------------------------------------------------------ actions --

  async function newNote() {
    const folder =
      (state.open && state.open.meta.folder) ||
      (state.notebooks[0] && state.notebooks[0].name) ||
      'General'
    try {
      const note = await api('POST', '/api/note', { folder, content: '' })
      await refreshTree()
      await openNote(note.path)
      if (state.editor) state.editor.focus()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  /** A new type for the open note, saved to its file at once. */
  async function setType(type) {
    if (!state.open) return
    const target = state.open
    try {
      const result = await api('PUT', `/api/note?path=${encodeURIComponent(target.path)}`, { type })
      target.meta = { ...target.meta, ...result.meta }
      showDates(target.meta)
      await refreshTree()
    } catch (error) {
      els.type.value = TYPES[target.meta.type] ? target.meta.type : 'other'
      setStatus(error.message, 'error')
    }
  }

  /** New notebook: a name field under the buttons, not a browser prompt. */
  function showNotebookForm(isShown) {
    els.newNotebookForm.hidden = !isShown
    els.newNotebookName.value = ''
    if (isShown) els.newNotebookName.focus()
  }

  async function newNotebook() {
    const name = els.newNotebookName.value.trim()
    if (name === '') return
    try {
      await api('POST', '/api/notebook', { name })
      showNotebookForm(false)
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  function isOpen(path) {
    return state.open !== null && state.open.path === path
  }

  /** Delete: each file goes to the trash folder; Claude Code keeps the notes as archived entries. */
  async function deleteNotes(notes) {
    const one = notes.length === 1 ? notes[0] : undefined
    const question = one
      ? `Delete "${one.title || 'Untitled'}"? The file moves to the trash folder; Claude Code keeps it as an archived entry.`
      : `Delete ${notes.length} notes? The files move to the trash folder; Claude Code keeps them as archived entries.`
    if (!confirm(question)) return
    try {
      for (const note of notes) {
        if (isOpen(note.path)) {
          // A pending autosave would write to a file that is gone.
          clearTimeout(state.saveTimer)
          state.dirty = false
        }
        await api('DELETE', `/api/note?path=${encodeURIComponent(note.path)}`)
        if (isOpen(note.path)) closeNote()
      }
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  /** Archive: the notes leave the page; their files stay, marked archived, and Claude Code archives the entries. */
  async function archiveNotes(notes) {
    try {
      for (const note of notes) {
        if (isOpen(note.path) && state.dirty) await save()
        await api('PUT', `/api/note?path=${encodeURIComponent(note.path)}`, { archived: true })
        if (isOpen(note.path)) closeNote()
      }
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  /** A pinned note stays at the top of its notebook. */
  async function setPinned(notes, pinned) {
    try {
      for (const note of notes) await api('PUT', `/api/note?path=${encodeURIComponent(note.path)}`, { pinned })
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  function isOpenIn(notebook) {
    return state.open !== null && state.open.path.split('/')[0] === notebook.name
  }

  /** A pinned notebook stays at the top of the list. */
  async function setNotebookPinned(notebook, pinned) {
    try {
      await api('PUT', '/api/notebook', { name: notebook.name, pinned })
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  /** Archive: the notebook and its notes leave the page; the files stay, marked archived; Claude Code archives the entries and drops the notebook. */
  async function archiveNotebook(notebook) {
    const notes = notebook.count === 0 ? '' : ` and its ${notebook.count} ${notebook.count === 1 ? 'note' : 'notes'}`
    if (!confirm(`Archive "${notebook.name}"${notes}? The files stay, marked archived; Claude Code archives the entries and drops the notebook.`)) return
    try {
      if (isOpenIn(notebook) && state.dirty) await save()
      await api('PUT', '/api/notebook', { name: notebook.name, archived: true })
      if (isOpenIn(notebook)) closeNote()
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  /** Delete: the notebook's folder goes to the trash folder; Claude Code keeps its notes as archived entries. */
  async function deleteNotebook(notebook) {
    const notes = notebook.count === 0 ? '' : ` and its ${notebook.count} ${notebook.count === 1 ? 'note' : 'notes'}`
    if (!confirm(`Delete "${notebook.name}"${notes}? The folder moves to the trash folder; Claude Code keeps the notes as archived entries.`)) return
    try {
      if (isOpenIn(notebook)) {
        clearTimeout(state.saveTimer)
        state.dirty = false
      }
      await api('DELETE', `/api/notebook?name=${encodeURIComponent(notebook.name)}`)
      if (isOpenIn(notebook)) closeNote()
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  /** Move: the note's file changes notebook; an open note stays open at its new path. */
  async function moveNote(path, folder) {
    try {
      if (isOpen(path) && state.dirty) await save()
      const result = await api('PUT', `/api/note?path=${encodeURIComponent(path)}`, { folder })
      if (isOpen(path)) {
        state.open.path = result.path
        state.open.meta = { ...state.open.meta, ...result.meta }
        els.crumb.textContent = folder
        showDates(state.open.meta)
        location.hash = `#/${encodeURIComponent(result.path)}`
      }
      state.collapsed.delete(folder)
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  // --------------------------------------------------------------- wire --

  els.newNote.addEventListener('click', () => void newNote())
  els.replySave.addEventListener('click', () => void saveReply())
  els.replyDiscard.addEventListener('click', () => void discardReply())
  els.newNotebook.addEventListener('click', () => showNotebookForm(els.newNotebookForm.hidden))
  els.newNotebookForm.addEventListener('submit', event => {
    event.preventDefault()
    void newNotebook()
  })
  els.newNotebookCancel.addEventListener('click', () => showNotebookForm(false))
  els.newNotebookName.addEventListener('keydown', event => {
    if (event.key === 'Escape') showNotebookForm(false)
  })
  els.deleteNote.addEventListener('click', () => {
    if (state.open) void deleteNotes([{ path: state.open.path, title: els.title.value.trim() }])
  })
  // A click on the tree's own space, or Escape outside a field, lets the picked notes go.
  els.tree.addEventListener('click', event => {
    if (event.target === els.tree) clearPicked()
  })
  for (const [value, type] of Object.entries(TYPES)) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = `${type.glyph}  ${type.label}`
    els.type.append(option)
  }
  els.type.addEventListener('change', () => void setType(els.type.value))
  els.title.addEventListener('input', () => {
    state.titleTouched = true
    markDirty()
  })
  els.title.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (state.editor) state.editor.focus()
    }
  })
  els.search.addEventListener('input', () => {
    state.query = els.search.value
    renderTree()
    clearTimeout(state.searchTimer)
    const query = state.query.trim()
    if (query !== '') state.searchTimer = setTimeout(() => void searchNotes(query), 150)
  })
  document.addEventListener('keydown', event => {
    const inField = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault()
      void save()
    } else if (!inField && event.key === 'n') {
      event.preventDefault()
      void newNote()
    } else if (!inField && event.key === '/') {
      event.preventDefault()
      els.search.focus()
    } else if (!inField && event.key === 'Escape' && els.menu.hidden) {
      clearPicked()
    }
  })
  window.addEventListener('beforeunload', () => {
    if (state.dirty && state.open && state.editor) {
      navigator.sendBeacon?.(
        `/api/note?path=${encodeURIComponent(state.open.path)}`,
        new Blob([JSON.stringify({ content: state.editor.getValue(), title: els.title.value.trim() })], {
          type: 'application/json',
        }),
      )
    }
  })

  // Poll the tree so notes saved from Claude Code show up while the page is open.
  setInterval(() => {
    if (!state.dirty && !state.dragging) void refreshTree().catch(() => setStatus('Server unreachable', 'error'))
  }, 4000)

  async function boot() {
    try {
      await refreshTree()
      setStatus('Ready')
      const fromHash = decodeURIComponent(location.hash.replace(/^#\/?/, ''))
      if (fromHash.endsWith('.md')) await openNote(fromHash)
      else if (fromHash !== '') {
        // A notebook name: expand it and open its newest note.
        const notebook = state.notebooks.find(one => one.name === fromHash)
        if (notebook && notebook.notes[0]) await openNote(notebook.notes[0].path)
      }
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }
  void boot()
})()
