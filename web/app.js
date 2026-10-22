/* Live Notebook web app: notebooks and notes in the sidebar, one note open
 * in a Vditor instant-rendering editor, autosaved to its markdown file
 * through the local server. Plain script, no build step. */
;(() => {
  const VDITOR_CDN = 'https://unpkg.com/vditor@4.0.1'
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
    updated: $('meta-updated'),
    captured: $('meta-captured'),
    newNote: $('new-note'),
    newNotebook: $('new-notebook'),
    deleteNote: $('delete-note'),
  }

  const state = {
    notebooks: [],
    open: null, // { path, meta, content }
    editor: null,
    dirty: false,
    saveTimer: null,
    query: '',
    collapsed: new Set(),
    /** True once the person typed in the title field of the open note. */
    titleTouched: false,
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

  // Transient only: what is shown is the last save's outcome or an error,
  // beside the note's meta line (or under the welcome text before a note opens).
  function setStatus(text, tone) {
    const quiet = text === 'Ready' || text === 'Loading…' ? '' : text
    els.status.textContent = quiet
    els.status.dataset.tone = tone ?? ''
    els.bootStatus.textContent = tone === 'error' ? quiet : ''
    els.bootStatus.dataset.tone = tone ?? ''
  }

  // --------------------------------------------------------------- tree --

  function formatDate(iso) {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function matches(note, query) {
    if (query === '') return true
    const q = query.toLowerCase()
    return note.title.toLowerCase().includes(q) || note.preview.toLowerCase().includes(q)
  }

  function renderTree() {
    els.tree.replaceChildren()
    const query = state.query.trim()
    for (const notebook of state.notebooks) {
      const notes = notebook.notes.filter(note => matches(note, query))
      if (query !== '' && notes.length === 0) continue
      const section = document.createElement('section')
      section.className = 'notebook'

      const head = document.createElement('div')
      head.className = 'notebook-head'
      head.innerHTML = `<span class="name"></span><span class="count"></span>`
      head.querySelector('.name').textContent = notebook.name
      head.querySelector('.count').textContent = String(notebook.count)
      head.title = state.collapsed.has(notebook.name) ? 'Expand' : 'Collapse'
      head.addEventListener('click', () => {
        if (state.collapsed.has(notebook.name)) state.collapsed.delete(notebook.name)
        else state.collapsed.add(notebook.name)
        renderTree()
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
          row.className = 'note-row' + (state.open && state.open.path === note.path ? ' selected' : '')
          row.innerHTML = `<span class="row-title"></span><span class="row-preview"></span>`
          row.querySelector('.row-title').textContent = note.title
          row.querySelector('.row-preview').textContent = note.preview || '—'
          row.addEventListener('click', () => void openNote(note.path))
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

  async function refreshTree() {
    const { notebooks } = await api('GET', '/api/tree')
    state.notebooks = notebooks
    renderTree()
  }

  // ------------------------------------------------------------- editor --

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
          '|',
          'outline',
          'edit-mode',
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
    const content = state.editor.getValue()
    let title = els.title.value.trim()
    if (!state.titleTouched || title === '' || title === 'Untitled') {
      // Not named by the person: the note is titled from its first line.
      const derived = titleOf(content)
      if (derived !== '') {
        title = derived
        els.title.value = derived
      }
    }
    const target = state.open
    try {
      const result = await api('PUT', `/api/note?path=${encodeURIComponent(target.path)}`, { content, title })
      state.dirty = false
      target.content = content
      target.meta = { ...target.meta, ...result.meta }
      els.updated.textContent = `Saved ${formatDate(target.meta.updated)}`
      setStatus('Saved')
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
      els.note.hidden = false
      els.crumb.textContent = note.meta.folder ?? path.split('/')[0]
      els.title.value = note.meta.title ?? ''
      els.updated.textContent = note.meta.updated ? `Updated ${formatDate(note.meta.updated)}` : ''
      els.captured.textContent = note.meta.captured
        ? note.meta.captured === 'whole_message'
          ? 'Saved from a whole message'
          : 'Saved as an excerpt'
        : 'Made here'
      location.hash = `#/${encodeURIComponent(path)}`
      await ensureEditor(note.content)
      setStatus('Ready')
      renderTree()
    } catch (error) {
      setStatus(error.message, 'error')
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
      prompt('Name the first notebook:', 'General')
    if (!folder) return
    try {
      const note = await api('POST', '/api/note', { folder, content: '' })
      await refreshTree()
      await openNote(note.path)
      if (state.editor) state.editor.focus()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  async function newNotebook() {
    const name = prompt('Notebook name:')
    if (!name || name.trim() === '') return
    try {
      await api('POST', '/api/notebook', { name: name.trim() })
      await refreshTree()
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  async function deleteNote() {
    if (!state.open) return
    if (!confirm(`Delete "${els.title.value || 'Untitled'}"? Claude Code keeps it as an archived entry.`)) return
    try {
      await api('DELETE', `/api/note?path=${encodeURIComponent(state.open.path)}`)
      closeNote()
      await refreshTree()
      setStatus('Deleted')
    } catch (error) {
      setStatus(error.message, 'error')
    }
  }

  // --------------------------------------------------------------- wire --

  els.newNote.addEventListener('click', () => void newNote())
  els.newNotebook.addEventListener('click', () => void newNotebook())
  els.deleteNote.addEventListener('click', () => void deleteNote())
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
    if (!state.dirty) void refreshTree().catch(() => setStatus('Server unreachable', 'error'))
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
