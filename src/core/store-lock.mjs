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
/**
 * A lock not refreshed for this long was left by a session that is gone (it
 * ended, or the mod reloaded mid-write); it is taken over.
 */
export const STORE_LOCK_STALE_MS = 15_000
/** How often a holder refreshes its lock while its write runs, well inside the stale time. */
export const STORE_LOCK_REFRESH_MS = 5_000
/**
 * How long a write keeps trying for the lock before it is refused, counted
 * in tries of STORE_LOCK_RETRY_MS: about this long, plus each try's own run.
 */
export const STORE_LOCK_WAIT_MS = 3_000
/** The pause between two tries. */
export const STORE_LOCK_RETRY_MS = 50

/**
 * Run as `node -e STORE_LOCK_SCRIPT take <dir> <token> <staleMs>`, `... touch
 * <dir> <token>` or `... give <dir> <token>`. `take` exits 0 when it took the
 * lock and STORE_LOCK_HELD when another holder has it. A lock is stale when
 * its directory's time is older than `staleMs`: its holder stopped
 * refreshing it. A stale lock is renamed aside before it is removed, and put
 * back if the one renamed turns out not to be the one judged stale, so two
 * sessions cannot both take it over. `touch` refreshes the lock's time and
 * `give` removes it, each only while the token in it is the caller's own.
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
if (verb === 'touch') {
  if (ownerOf(dir) !== token) process.exit(HELD)
  const now = new Date()
  fs.utimesSync(dir, now, now)
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

/** Why a write did not run: another session kept the lock (`held`), or it could not be taken at all (`unavailable`). */
export class StoreLockError extends Error {
  /**
   * @param {'held' | 'unavailable'} reason
   * @param {string} message
   */
  constructor(reason, message) {
    super(message)
    this.name = 'StoreLockError'
    this.reason = reason
  }
}

/**
 * Runs `work` holding the lock at `lock.dir`, refreshing it every
 * `refreshMs` while `work` runs, and gives it back after, even when `work`
 * throws. `lock.run` runs the script with the arguments after `-e
 * STORE_LOCK_SCRIPT`. When the lock cannot be had, `work` never runs and a
 * StoreLockError says why: a write made without the lock could land between
 * another session's last read and its write, and undo that write.
 *
 * @template T
 * @param {import('./store-lock.d.mts').StoreLock} lock
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withStoreLock(lock, work) {
  const token = lock.newToken()
  await takeStoreLock(lock, token)
  const stop = lock.every(lock.refreshMs ?? STORE_LOCK_REFRESH_MS, () =>
    lock.run(['touch', lock.dir, token]).then(
      () => undefined,
      () => undefined,
    ),
  )
  try {
    return await work()
  } finally {
    stop()
    await lock.run(['give', lock.dir, token]).catch(() => undefined)
  }
}

/**
 * @param {import('./store-lock.d.mts').StoreLock} lock
 * @param {string} token
 * @returns {Promise<void>}
 */
async function takeStoreLock(lock, token) {
  const retryMs = lock.retryMs ?? STORE_LOCK_RETRY_MS
  const tries = Math.max(1, Math.ceil((lock.waitMs ?? STORE_LOCK_WAIT_MS) / retryMs))
  for (let attempt = 0; attempt < tries; attempt++) {
    let exitCode
    try {
      ;({ exitCode } = await lock.run(['take', lock.dir, token, String(lock.staleMs ?? STORE_LOCK_STALE_MS)]))
    } catch (error) {
      throw new StoreLockError('unavailable', `The notebook's write lock could not be taken (${error instanceof Error ? error.message : String(error)}), so nothing was saved.`)
    }
    if (exitCode === 0) return
    if (exitCode !== STORE_LOCK_HELD) {
      throw new StoreLockError('unavailable', `The notebook's write lock could not be taken (its script exited ${exitCode}), so nothing was saved.`)
    }
    if (attempt < tries - 1) await lock.sleep(retryMs)
  }
  throw new StoreLockError('held', 'Another Claude Code session is saving to the notebook, so nothing was saved. Try again in a moment.')
}
