// Runs inside VS Code's extension host (see run.mjs): the commands against a scratch notes folder.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vscode = require('vscode')

/** Shows a document, retrying while the window is still laying out (Cursor's agent window opens with no editor area at first). */
async function show(document) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await vscode.window.showTextDocument(document)
    } catch (error) {
      if (attempt >= 10) throw error
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
  }
}

async function checks() {
  const root = process.env.LIVE_NOTEBOOK_HOME
  assert.ok(root, 'LIVE_NOTEBOOK_HOME is set by run.mjs')

  // A code selection is saved as a fenced block in its language, in the notebook asked for.
  const code = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const a = 1\nexport const retries = 5\n' })
  const editor = await show(code)
  editor.selection = new vscode.Selection(1, 0, 1, 24)
  const saved = await vscode.commands.executeCommand('liveNotebook.saveSelection', { notebook: 'From VS Code', title: 'Retries', quiet: true })
  assert.ok(saved, 'the selection was saved')
  const text = readFileSync(saved.file, 'utf8')
  assert.match(text, /title: "Retries"/)
  assert.match(text, /folder: "From VS Code"/)
  assert.match(text, /captured: excerpt/)
  assert.match(text, /agent: (visual-studio-code|code|cursor)/)
  assert.match(text, /\n\n```typescript\nexport const retries = 5\n```\n$/)

  // Markdown is saved as it is.
  const prose = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# Zeppelin facts\n\nThey float.' })
  await show(prose)
  const whole = await vscode.commands.executeCommand('liveNotebook.saveSelection', { notebook: 'From VS Code', quiet: true })
  assert.match(readFileSync(whole.file, 'utf8'), /\n\n# Zeppelin facts\n\nThey float\.\n$/)

  // Search finds both, by text, and opens nothing when given a query.
  const found = await vscode.commands.executeCommand('liveNotebook.search', { query: 'zeppelin' })
  assert.deepEqual(found.map(one => one.title), ['Zeppelin facts'])
  assert.equal((await vscode.commands.executeCommand('liveNotebook.search', { query: 'retries' }))[0].notebook, 'From VS Code')

  // A notebook name that leaves the folder is refused, and nothing is written.
  assert.equal(await vscode.commands.executeCommand('liveNotebook.saveSelection', { notebook: '../outside', quiet: true }), undefined)

  // The web notebook starts with the editor's own Node.
  const info = await vscode.commands.executeCommand('liveNotebook.open')
  assert.match(info?.url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
  const health = await (await fetch(`${info.url}/api/health`)).json()
  assert.equal(health.root, root)
}

/** VS Code reports only pass or fail; the marker and the stack say which check ran and why it failed. */
async function run() {
  try {
    await checks()
    console.log('LIVE_NOTEBOOK_SUITE_OK')
  } catch (error) {
    console.error(`LIVE_NOTEBOOK_SUITE_FAILED ${error && error.stack ? error.stack : String(error)}`)
    throw error
  }
}

module.exports = { run }
