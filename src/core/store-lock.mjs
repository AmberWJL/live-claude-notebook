// The notebook's write lock across Claude Code sessions and the web server.
// Every session on the machine shares one `$.store`, and every session and
// the web server write the same note files. Each single write is atomic, but
// a change is a read and then a write, so a writer holds this lock around it.
//
// `$.fs` cannot create a file exclusively, so a short node script does the
// lock's work on disk (the web server runs the same script). Pure code, no
// Claude Code: `tests/node/store-lock.test.mjs` runs the script in real
// processes, paused at exact points to replay races.

/** The lock folder's name, under `~/.claude/live-notebook`. */
export const STORE_LOCK_DIR = '.store-lock'
/** The script's exit code when another holder has the lock, or this holder lost it. */
export const STORE_LOCK_HELD = 3
/**
 * A lock not renewed for this long was left by a writer that is gone (its
 * session ended, or the mod reloaded mid-write); it is taken over.
 */
export const STORE_LOCK_STALE_MS = 15_000
/** How often a holder renews its lock while its work runs, well inside the stale time. */
export const STORE_LOCK_REFRESH_MS = 5_000
/**
 * How long a write keeps trying for the lock before it is refused, counted
 * in tries of STORE_LOCK_RETRY_MS: about this long, plus each try's own run.
 */
export const STORE_LOCK_WAIT_MS = 3_000
/** The pause between two tries. */
export const STORE_LOCK_RETRY_MS = 50
/**
 * For tests only: `<step>=<path>` stops the script at that step (written as
 * `<path>.reached`) until `<path>.go` exists. Unset, nothing pauses.
 */
export const STORE_LOCK_PAUSE_ENV = 'LIVE_NOTEBOOK_LOCK_TEST_PAUSE'

/**
 * Run as `node -e STORE_LOCK_SCRIPT <verb> <root> ...`:
 *
 *   take  <root> <token> <staleMs>   exit 0 and print the generation taken, or STORE_LOCK_HELD
 *   renew <root> <gen> <token>       exit 0 while this holder still has the lock, else STORE_LOCK_HELD
 *   give  <root> <gen> <token>       exit 0
 *
 * The lock is a folder of numbered generations, `<root>/000000000042`; the
 * highest one not marked `void` is the lock, held by the token in its
 * `owner` file until it is marked `released`. A generation is taken by
 * creating the next number, which only one process can do, and the lock's
 * path is never empty, so nobody can slip in while another takes it over.
 *
 * A holder renews by adding a `beat-<n>` file to its generation, then checks
 * that no newer live generation exists; it writes only after a renewal that
 * passed. A writer that finds the lock's newest beat older than `staleMs`
 * takes it over by creating the next generation, then checks that the old
 * one got no new beat meanwhile, and withdraws (marks its own `void`) if it
 * did. Each side acts first and checks second, so at least one of them sees
 * the other: an active holder and a contender never both go on.
 */
export const STORE_LOCK_SCRIPT = `
const fs = require('node:fs')
const path = require('node:path')
const HELD = ${STORE_LOCK_HELD}
const [verb, root, ...rest] = process.argv.slice(1)
const GENERATION = /^[0-9]{12}$/
const dirOf = g => path.join(root, String(g).padStart(12, '0'))
const exists = p => { try { fs.statSync(p); return true } catch { return false } }
const read = p => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const names = dir => { try { return fs.readdirSync(dir) } catch { return [] } }
const pause = step => {
  const spec = process.env.${STORE_LOCK_PAUSE_ENV}
  if (!spec || spec.slice(0, spec.indexOf('=')) !== step) return
  const file = spec.slice(spec.indexOf('=') + 1)
  fs.writeFileSync(file + '.reached', '')
  const nap = new Int32Array(new SharedArrayBuffer(4))
  while (!exists(file + '.go')) Atomics.wait(nap, 0, 0, 10)
}
const generations = () => names(root).filter(n => GENERATION.test(n)).map(Number).sort((a, b) => a - b)
const isVoid = g => exists(path.join(dirOf(g), 'void'))
const isReleased = g => exists(path.join(dirOf(g), 'released'))
const live = gens => { for (let i = gens.length - 1; i >= 0; i -= 1) if (!isVoid(gens[i])) return gens[i]; return undefined }
const beats = g => names(dirOf(g)).filter(n => n.startsWith('beat-'))
const lastBeat = g => {
  let last = 0
  for (const n of ['owner', ...beats(g)]) {
    try { last = Math.max(last, fs.statSync(path.join(dirOf(g), n)).mtimeMs) } catch {}
  }
  if (last > 0) return last
  try { return fs.statSync(dirOf(g)).mtimeMs } catch { return Date.now() }
}
const mark = (g, name) => { try { fs.writeFileSync(path.join(dirOf(g), name), '', { flag: 'wx' }) } catch {} }
const create = (g, token) => {
  try { fs.mkdirSync(dirOf(g)) } catch (error) {
    if (error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'EACCES') return false
    throw error
  }
  fs.writeFileSync(path.join(dirOf(g), 'owner'), token)
  return true
}
// Every generation but the newest and the live one is done with; a holder of one finds its renewal refused.
const tidy = () => {
  const gens = generations()
  const top = gens[gens.length - 1]
  const current = live(gens)
  for (const g of gens) {
    if (g === top || g === current) continue
    try { fs.rmSync(dirOf(g), { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }) } catch {}
  }
}
if (verb === 'take') {
  const [token, staleText] = rest
  fs.mkdirSync(root, { recursive: true })
  const gens = generations()
  const top = gens.length > 0 ? gens[gens.length - 1] : 0
  const current = live(gens)
  if (current === undefined || isReleased(current)) {
    if (!create(top + 1, token)) process.exit(HELD)
    tidy()
    process.stdout.write(String(top + 1))
    process.exit(0)
  }
  const seen = beats(current)
  if (Date.now() - lastBeat(current) <= Number(staleText)) process.exit(HELD)
  pause('take:after-stat')
  if (!create(top + 1, token)) process.exit(HELD)
  pause('take:after-create')
  // The holder renewed after it was judged gone: it is alive, so this takeover withdraws.
  if (beats(current).some(n => !seen.includes(n))) {
    mark(top + 1, 'void')
    process.exit(HELD)
  }
  tidy()
  process.stdout.write(String(top + 1))
  process.exit(0)
}
if (verb === 'renew') {
  const [genText, token] = rest
  const g = Number(genText)
  if (!GENERATION.test(genText.padStart(12, '0')) || read(path.join(dirOf(g), 'owner')) !== token || isReleased(g)) process.exit(HELD)
  for (let n = beats(g).length + 1; ; n += 1) {
    try {
      fs.writeFileSync(path.join(dirOf(g), 'beat-' + n), '', { flag: 'wx' })
      break
    } catch (error) {
      if (error.code !== 'EEXIST') process.exit(HELD)
    }
  }
  pause('renew:after-beat')
  if (generations().some(other => other > g && !isVoid(other))) process.exit(HELD)
  process.exit(0)
}
if (verb === 'give') {
  const [genText, token] = rest
  const g = Number(genText)
  if (read(path.join(dirOf(g), 'owner')) === token) mark(g, 'released')
  tidy()
  process.exit(0)
}
process.exit(2)
`

/** Why a write did not run: another writer kept the lock (`held`), it could not be taken at all (`unavailable`), or this writer lost it (`lost`). */
export class StoreLockError extends Error {
  /**
   * @param {'held' | 'unavailable' | 'lost'} reason
   * @param {string} message
   */
  constructor(reason, message) {
    super(message)
    this.name = 'StoreLockError'
    this.reason = reason
  }
}

/**
 * Runs `work(check)` holding the lock at `lock.dir`, renewing it every
 * `refreshMs` while `work` runs, and gives it back after, even when `work`
 * throws. `work` calls `check()` right before each write: it renews the lock
 * and throws a StoreLockError `lost` when another writer has taken it over,
 * so a writer that lost the lock writes nothing more. When the lock cannot be
 * had, `work` never runs and a StoreLockError says why.
 *
 * `lock.run` runs the script with the arguments after `-e STORE_LOCK_SCRIPT`.
 *
 * @template T
 * @param {import('./store-lock.d.mts').StoreLock} lock
 * @param {(check: () => Promise<void>) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withStoreLock(lock, work) {
  const token = lock.newToken()
  const gen = await takeStoreLock(lock, token)
  const check = async () => {
    let exitCode
    try {
      ;({ exitCode } = await lock.run(['renew', lock.dir, gen, token]))
    } catch {
      exitCode = -1
    }
    if (exitCode !== 0) {
      throw new StoreLockError('lost', 'Another writer took over the notebook while this change was being saved, so the rest of it was not saved. Try again.')
    }
  }
  const stop = lock.every(lock.refreshMs ?? STORE_LOCK_REFRESH_MS, () => check().catch(() => undefined))
  try {
    return await work(check)
  } finally {
    stop()
    await lock.run(['give', lock.dir, gen, token]).catch(() => undefined)
  }
}

/**
 * @param {import('./store-lock.d.mts').StoreLock} lock
 * @param {string} token
 * @returns {Promise<string>} the generation taken
 */
async function takeStoreLock(lock, token) {
  const retryMs = lock.retryMs ?? STORE_LOCK_RETRY_MS
  const tries = Math.max(1, Math.ceil((lock.waitMs ?? STORE_LOCK_WAIT_MS) / retryMs))
  for (let attempt = 0; attempt < tries; attempt++) {
    let result
    try {
      result = await lock.run(['take', lock.dir, token, String(lock.staleMs ?? STORE_LOCK_STALE_MS)])
    } catch (error) {
      throw new StoreLockError('unavailable', `The notebook's write lock could not be taken (${error instanceof Error ? error.message : String(error)}), so nothing was saved.`)
    }
    const gen = String(result.stdout ?? '').trim()
    if (result.exitCode === 0 && /^[0-9]+$/.test(gen)) return gen
    if (result.exitCode !== STORE_LOCK_HELD) {
      throw new StoreLockError('unavailable', `The notebook's write lock could not be taken (its script exited ${result.exitCode}), so nothing was saved.`)
    }
    if (attempt < tries - 1) await lock.sleep(retryMs)
  }
  throw new StoreLockError('held', 'Another Claude Code session is saving to the notebook, so nothing was saved. Try again in a moment.')
}
