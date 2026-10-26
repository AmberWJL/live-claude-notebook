/**
 * What differs by operating system for the `live-notebook` command: reading
 * the clipboard and opening a URL in the browser. No dependencies; each
 * platform's own tools.
 */
import { spawn, spawnSync } from 'node:child_process'

/** The ways to read the clipboard on this platform, tried in order. */
function clipboardReaders(platform) {
  if (platform === 'darwin') return [['pbpaste']]
  if (platform === 'win32') {
    return [['powershell', '-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard -Raw']]
  }
  return [['wl-paste', '--no-newline'], ['xclip', '-selection', 'clipboard', '-o'], ['xsel', '--clipboard', '--output']]
}

/** The clipboard's text; throws when no reader works (on Linux, install wl-clipboard, xclip or xsel). */
export function readClipboard(platform = process.platform) {
  const tried = []
  for (const [command, ...args] of clipboardReaders(platform)) {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 5_000,
      env: { ...process.env, LANG: process.env.LANG ?? 'en_US.UTF-8', LC_CTYPE: process.env.LC_CTYPE ?? 'UTF-8' },
      windowsHide: true,
    })
    if (result.error === undefined && result.status === 0) return platform === 'win32' ? result.stdout.replace(/\r?\n$/, '') : result.stdout
    tried.push(command)
  }
  const hint = platform === 'linux' ? ' Install wl-clipboard (Wayland), xclip or xsel.' : ''
  throw new Error(`Could not read the clipboard (tried ${tried.join(', ')}).${hint}`)
}

/** Opens a URL in the default browser without waiting; false when there was no way to. */
export function openUrl(url, platform = process.platform) {
  const [command, ...args] =
    platform === 'darwin' ? ['open', url] : platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url] : ['xdg-open', url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => undefined)
    child.unref()
    return true
  } catch {
    return false
  }
}
