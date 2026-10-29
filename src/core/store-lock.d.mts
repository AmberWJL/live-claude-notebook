/** The types of `store-lock.mjs`, the notebook's write lock across Claude Code sessions and the web server. */

export const STORE_LOCK_DIR: '.store-lock'
export const STORE_LOCK_HELD: 3
export const STORE_LOCK_STALE_MS: number
export const STORE_LOCK_REFRESH_MS: number
export const STORE_LOCK_WAIT_MS: number
export const STORE_LOCK_RETRY_MS: number
export const STORE_LOCK_PAUSE_ENV: 'LIVE_NOTEBOOK_LOCK_TEST_PAUSE'
export const STORE_LOCK_SCRIPT: string

export type StoreLock = {
  /** The lock folder, an absolute path. */
  dir: string
  /** Runs `node -e STORE_LOCK_SCRIPT ...args` and resolves its exit code and output. */
  run: (args: string[]) => Promise<{ exitCode: number; stdout?: string }>
  sleep: (ms: number) => Promise<void>
  /** Calls `beat` every `ms` milliseconds until the returned function is called. */
  every: (ms: number, beat: () => Promise<void>) => () => void
  /** A fresh token per hold, so a holder never acts on someone else's generation. */
  newToken: () => string
  waitMs?: number
  retryMs?: number
  staleMs?: number
  refreshMs?: number
}

export class StoreLockError extends Error {
  constructor(reason: 'held' | 'unavailable' | 'lost', message: string)
  readonly reason: 'held' | 'unavailable' | 'lost'
}

export function withStoreLock<T>(lock: StoreLock, work: (check: () => Promise<void>) => Promise<T>): Promise<T>
