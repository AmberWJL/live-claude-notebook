/** The types of `store-lock.mjs`, the notebook's write lock across Claude Code sessions. */

export const STORE_LOCK_DIR: '.store.lock'
export const STORE_LOCK_HELD: 3
export const STORE_LOCK_STALE_MS: number
export const STORE_LOCK_WAIT_MS: number
export const STORE_LOCK_RETRY_MS: number
export const STORE_LOCK_SCRIPT: string

export type StoreLock = {
  /** The lock directory, an absolute path. */
  dir: string
  /** Runs `node -e STORE_LOCK_SCRIPT ...args` and resolves its exit code. */
  run: (args: string[]) => Promise<{ exitCode: number }>
  sleep: (ms: number) => Promise<void>
  /** A fresh token per hold, so a holder never gives back someone else's lock. */
  newToken: () => string
  waitMs?: number
  retryMs?: number
  staleMs?: number
}

export function withStoreLock<T>(lock: StoreLock, work: () => Promise<T>): Promise<T>
