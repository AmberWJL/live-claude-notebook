// Runs test/suite.cjs inside a VS Code already installed on this machine (nothing is downloaded), with a
// throwaway profile and a scratch notes folder; the person's own VS Code settings and notes are not touched.
// VS Code's binary: VSCODE_BIN, else the usual install place on macOS, Windows or Linux.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const candidates = [
  process.env.VSCODE_BIN,
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
  '/usr/share/code/code',
].filter(Boolean)
const binary = candidates.find(one => existsSync(one))
if (binary === undefined) {
  console.error('No VS Code found; set VSCODE_BIN to its binary.')
  process.exit(1)
}

const scratch = mkdtempSync(join(tmpdir(), 'live-notebook-vscode-'))
const notes = join(scratch, 'notes-root')
// A folder to open: with none, Cursor opens its agent window, which has no editor area for the suite's documents.
const workspace = join(scratch, 'workspace')
mkdirSync(workspace, { recursive: true })
try {
  const run = spawnSync(
    binary,
    [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      `--user-data-dir=${join(scratch, 'profile')}`,
      `--extensions-dir=${join(scratch, 'extensions')}`,
      `--extensionDevelopmentPath=${join(here, '..')}`,
      `--extensionTestsPath=${join(here, 'suite.cjs')}`,
      workspace,
    ],
    { encoding: 'utf8', env: { ...process.env, LIVE_NOTEBOOK_HOME: notes, ELECTRON_RUN_AS_NODE: undefined }, timeout: 180_000 },
  )
  const log = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const failure = log.split('\n').findIndex(line => line.includes('LIVE_NOTEBOOK_SUITE_FAILED'))
  if (failure >= 0) console.error(log.split('\n').slice(failure, failure + 12).join('\n'))
  // Stop the web notebook the suite started.
  spawnSync(process.execPath, [join(here, '..', 'runtime', 'server', 'notebook-server.mjs'), '--stop', '--root', notes], { stdio: 'ignore' })
  if (run.status !== 0 || !log.includes('LIVE_NOTEBOOK_SUITE_OK')) {
    console.error(`VS Code tests failed (exit ${run.status ?? run.signal}).`)
    process.exit(1)
  }
  console.log('VS Code tests passed.')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
