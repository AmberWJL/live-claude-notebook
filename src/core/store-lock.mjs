// The notebook's write lock across Claude Code sessions. Every session on the
// machine shares one `$.store`; each `$.store.set` is atomic on its own, but a
// read-modify-write is two calls, so a session holds this lock around it.
//
// `$.fs` cannot create a file exclusively, so a short node script does: it
// makes a directory, which either succeeds or fails as one step on every
// platform. Pure code, no Claude Code: `tests/node/store-lock.test.mjs` runs
// the script in real processes.

/** The lock directory's name, under `~/.claude/live-notebook`. */
export const STORE_LOCK_DIR = '.store.lock'
/** The script's exit code when another session holds the lock. */
export const STORE_LOCK_HELD = 3
/** A lock older than this was left by a session that stopped mid-write; it is taken over. */
export const STORE_LOCK_STALE_MS = 15_000
/** How long a write waits for the lock before going ahead with the re-check alone. */
export const STORE_LOCK_WAIT_MS = 3_000
/** The pause between two tries. */
export const STORE_LOCK_RETRY_MS = 50

/**
 * Run as `node -e STORE_LOCK_SCRIPT take <dir> <token> <staleMs>` or
 * `... give <dir> <token>`. `take` exits 0 when it took the lock and
 * STORE_LOCK_HELD when another holder has it. A stale lock is renamed aside
 * before it is removed, and put back if the one renamed turns out not to be
 * the one judged stale, so two sessions cannot both take it over. `give`
 * removes the lock only while the token in it is the giver's own.
 */
export const STORE_LOCK_SCRIPT = `
const fs = require('node:fs')
const path = require('node:path')
const [verb, dir, token, staleText] = process.argv.slice(1)
const HELD = ${STORE_LOCK_HELD}
// On Windows a directory still being removed refuses a new one with EPERM or EACCES for a moment.
const BUSY = process.platform === 'win32' ? ['EEXIST', 'EPERM', 'EACCES', 'EBUSY'] : ['EEXIST']
const remove = at => fs.rmSync(at, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
const ownerOf = at => {
  try { return fs.readFileSync(path.join(at, 'owner'), 'utf8') } catch { return '' }
}
const take = () => {
  try { fs.mkdirSync(dir) } catch (error) { if (BUSY.includes(error.code)) return false; throw error }
  try { fs.writeFileSync(path.join(dir, 'owner'), token) } catch (error) { remove(dir); throw error }
  return true
}
if (verb === 'give') {
  if (ownerOf(dir) === token) remove(dir)
  process.exit(0)
}
fs.mkdirSync(path.dirname(dir), { recursive: true })
if (take()) process.exit(0)
const held = ownerOf(dir)
let age
try { age = Date.now() - fs.statSync(dir).mtimeMs } catch { process.exit(take() ? 0 : HELD) }
if (age <= Number(staleText)) process.exit(HELD)
const aside = dir + '.stale-' + token
try { fs.renameSync(dir, aside) } catch { process.exit(HELD) }
if (ownerOf(aside) !== held) {
  try { fs.renameSync(aside, dir) } catch {}
  process.exit(HELD)
}
remove(aside)
process.exit(take() ? 0 : HELD)
`

/**
 * Runs `work` holding the lock at `lock.dir`, and gives it back after, even
 * when `work` throws. `lock.run` runs the script with the arguments after
 * `-e STORE_LOCK_SCRIPT`. When the lock cannot be had (node missing, or
 * another session keeps it past the wait), `work` runs anyway: a save is
 * never refused for the lock, and the service's re-check still stands.
 *
 * @template T
 * @param {import('./store-lock.d.mts').StoreLock} lock
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withStoreLock(lock, work) {
  const token = lock.newToken()
  const isHeld = await takeStoreLock(lock, token)
  try {
    return await work()
  } finally {
    if (isHeld) await lock.run(['give', lock.dir, token]).catch(() => undefined)
  }
}

/**
 * @param {import('./store-lock.d.mts').StoreLock} lock
 * @param {string} token
 * @returns {Promise<boolean>}
 */
async function takeStoreLock(lock, token) {
  const retryMs = lock.retryMs ?? STORE_LOCK_RETRY_MS
  const tries = Math.max(1, Math.ceil((lock.waitMs ?? STORE_LOCK_WAIT_MS) / retryMs))
  for (let attempt = 0; attempt < tries; attempt++) {
    let exitCode
    try {
      ;({ exitCode } = await lock.run(['take', lock.dir, token, String(lock.staleMs ?? STORE_LOCK_STALE_MS)]))
    } catch {
      return false
    }
    if (exitCode === 0) return true
    if (exitCode !== STORE_LOCK_HELD) return false
    if (attempt < tries - 1) await lock.sleep(retryMs)
  }
  return false
}
