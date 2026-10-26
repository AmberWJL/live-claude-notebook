/**
 * Live Notebook for VS Code, Cursor, Windsurf and VSCodium: save the
 * selection or the clipboard (a chat reply copied from any AI panel) as a
 * Markdown note, search notes, and open the web notebook. The notes are the
 * files under the notes folder, the same ones Live Notebook for Claude Code
 * and the `live-notebook` command read and write. Nothing leaves the
 * computer. The note store is the repository's own (`runtime/`, copied by
 * scripts/bundle.mjs); this file only adapts it to the editor.
 *
 * Every command also takes an argument object, so a keybinding or a test can
 * run it without its pickers: `{ notebook, title }` to save, `{ query }` to
 * search (it then returns the results instead of showing them).
 */
const vscode = require('vscode')
const { execFile } = require('node:child_process')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const LAST_NOTEBOOK_KEY = 'liveNotebook.lastNotebook'
const NEW_NOTEBOOK = '$(add) New notebook…'

let store
let format

async function core() {
  if (store === undefined) {
    store = await import(pathToFileURL(join(__dirname, 'runtime', 'src', 'core', 'note-store.mjs')).href)
    format = await import(pathToFileURL(join(__dirname, 'runtime', 'src', 'core', 'note-format.mjs')).href)
  }
  return { store, format }
}

async function rootOf() {
  const { store } = await core()
  const configured = vscode.workspace.getConfiguration('liveNotebook').get('notesFolder')
  return store.resolveRoot(typeof configured === 'string' && configured.trim() !== '' ? configured.replace(/^~(?=$|[\\/])/, require('node:os').homedir()) : undefined)
}

/** The editor, as a note's `agent`: `visual-studio-code`, `cursor`, `windsurf`, `vscodium`. */
function agentName() {
  const name = String(vscode.env.appName ?? 'vscode')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return name === '' ? 'vscode' : name
}

function projectName() {
  return vscode.workspace.workspaceFolders?.[0]?.name
}

/** The notebook to save in: the one asked for, else a pick among the notebooks (the last used first), or a new one. */
async function pickNotebook(context, asked) {
  if (typeof asked === 'string' && asked.trim() !== '') return asked
  const { store } = await core()
  const last = context.globalState.get(LAST_NOTEBOOK_KEY) ?? store.DEFAULT_NOTEBOOK
  const names = store.listNotebooks(await rootOf()).map(notebook => notebook.name)
  if (!names.includes(last)) names.unshift(last)
  const ordered = [last, ...names.filter(name => name !== last)]
  const picked = await vscode.window.showQuickPick([...ordered, NEW_NOTEBOOK], { title: 'Save to which notebook?', placeHolder: last })
  if (picked === undefined) return undefined
  if (picked !== NEW_NOTEBOOK) return picked
  return vscode.window.showInputBox({
    title: 'New notebook',
    prompt: 'A name of 1 to 40 characters',
    validateInput: value => (format.safeFolderName(value) === undefined ? 'Use 1 to 40 characters, no slash, not starting with a dot.' : undefined),
  })
}

async function saveText(context, content, options, captured) {
  const { store } = await core()
  if (content.trim() === '') {
    vscode.window.showWarningMessage('Live Notebook: there is no text to save.')
    return undefined
  }
  const notebook = await pickNotebook(context, options.notebook)
  if (notebook === undefined) return undefined
  const root = await rootOf()
  try {
    const note = store.createNote(root, {
      folder: notebook,
      title: options.title,
      content,
      captured,
      agent: agentName(),
      project: projectName(),
    })
    await context.globalState.update(LAST_NOTEBOOK_KEY, note.meta.folder)
    if (options.quiet !== true) {
      void vscode.window.showInformationMessage(`Saved to ${note.meta.folder}: ${note.meta.title}`, 'Open note').then(choice => {
        if (choice === 'Open note') void openNoteFile(root, note.path)
      })
    }
    return { ...note, file: join(root, 'notes', note.path) }
  } catch (error) {
    vscode.window.showErrorMessage(`Live Notebook: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

async function openNoteFile(root, path) {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(root, 'notes', path)))
  await vscode.window.showTextDocument(document, { preview: true })
}

/** The selection (every one of a multi-cursor selection, in order); the whole document when nothing is selected. */
function selectedText(editor) {
  const parts = editor.selections.filter(selection => !selection.isEmpty).map(selection => editor.document.getText(selection))
  return parts.length > 0 ? parts.join('\n\n') : editor.document.getText()
}

/** A code selection is kept as a fenced block in its language, so it reads as code in the note. */
function asNoteText(editor, text) {
  const language = editor.document.languageId
  if (language === 'markdown' || language === 'plaintext') return text
  return `\`\`\`${language}\n${text.replace(/\n$/, '')}\n\`\`\``
}

/** Starts the web notebook (or finds the running one) with the editor's own Node, and returns its address. */
async function launchServer() {
  const server = join(__dirname, 'runtime', 'server', 'notebook-server.mjs')
  const root = await rootOf()
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [server, '--launch', '--root', root],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20_000, windowsHide: true },
      (error, stdout, stderr) => {
        const line = String(stdout)
          .split('\n')
          .map(one => one.trim())
          .filter(one => one.startsWith('{'))
          .pop()
        if (error !== null || line === undefined) reject(new Error(`The web notebook did not start. ${String(stderr).trim()}`.trim()))
        else resolve(JSON.parse(line))
      },
    )
  })
}

function activate(context) {
  const register = (name, run) => context.subscriptions.push(vscode.commands.registerCommand(name, run))

  register('liveNotebook.saveSelection', async (options = {}) => {
    const editor = vscode.window.activeTextEditor
    if (editor === undefined) {
      vscode.window.showWarningMessage('Live Notebook: open a file and select text to save. To save a chat reply, copy it, then run Save Clipboard as Note.')
      return undefined
    }
    return saveText(context, asNoteText(editor, selectedText(editor)), options, 'excerpt')
  })

  register('liveNotebook.saveClipboard', async (options = {}) => {
    // A chat reply copied with the panel's Copy button arrives whole and word for word.
    const text = await vscode.env.clipboard.readText()
    return saveText(context, text, options, 'whole_message')
  })

  register('liveNotebook.search', async (options = {}) => {
    const { store } = await core()
    const root = await rootOf()
    if (typeof options.query === 'string') return store.searchNotes(root, options.query, { limit: options.limit ?? 50 })
    const pick = vscode.window.createQuickPick()
    pick.title = 'Search Live Notebook'
    pick.placeholder = 'Words in a note’s title, text or tags'
    pick.matchOnDescription = true
    pick.matchOnDetail = true
    const show = query => {
      const results = query.trim() === '' ? [] : store.searchNotes(root, query, { limit: 50 })
      pick.items = results.map(found => ({
        label: found.title,
        description: found.notebook + (found.tags.length > 0 ? `  #${found.tags.join(' #')}` : ''),
        detail: found.snippet,
        path: found.path,
        alwaysShow: true,
      }))
    }
    pick.onDidChangeValue(show)
    pick.onDidAccept(() => {
      const chosen = pick.selectedItems[0]
      pick.hide()
      if (chosen !== undefined) void openNoteFile(root, chosen.path)
    })
    pick.onDidHide(() => pick.dispose())
    pick.show()
    return undefined
  })

  register('liveNotebook.open', async () => {
    try {
      const info = await launchServer()
      await vscode.env.openExternal(vscode.Uri.parse(info.url))
      return info
    } catch (error) {
      vscode.window.showErrorMessage(`Live Notebook: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  })

  register('liveNotebook.showFolder', async () => {
    const root = await rootOf()
    require('node:fs').mkdirSync(join(root, 'notes'), { recursive: true })
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(join(root, 'notes')))
    return root
  })
}

function deactivate() {}

module.exports = { activate, deactivate }
