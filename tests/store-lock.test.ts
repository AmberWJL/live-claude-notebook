import { describe, expect, test } from 'claude-code/testing'

import { STORE_LOCK_HELD, StoreLockError, withStoreLock, type StoreLock } from '../src/core/store-lock.mjs'

/**
 * A lock whose script answers from `exits`, one exit code per `take`; records
 * every run. Its refresh timer fires only when the test calls `beat`.
 */
function scriptedLock(exits: number[], options: { failRun?: boolean } = {}) {
  const runs: string[][] = []
  const sleeps: number[] = []
  const timers: { ms: number; beat: () => Promise<void>; isStopped: boolean }[] = []
  let tokens = 0
  const lock: StoreLock = {
    dir: '/home/t/.claude/live-notebook/.store.lock',
    run: async args => {
      runs.push(args)
      if (options.failRun === true) throw new Error('spawn node ENOENT')
      return { exitCode: args[0] === 'take' ? (exits.shift() ?? 0) : 0 }
    },
    sleep: async ms => {
      sleeps.push(ms)
    },
    every: (ms, beat) => {
      const timer = { ms, beat, isStopped: false }
      timers.push(timer)
      return () => {
        timer.isStopped = true
      }
    },
    newToken: () => `token-${(tokens += 1)}`,
    waitMs: 200,
    retryMs: 50,
  }
  return { lock, runs, sleeps, timers }
}

async function refusal(promise: Promise<unknown>): Promise<StoreLockError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StoreLockError) return error
    throw error
  }
  throw new Error('the write ran')
}

describe('withStoreLock', () => {
  test('takes the lock, runs the work, gives the same token back', async () => {
    const { lock, runs } = scriptedLock([0])
    expect(await withStoreLock(lock, async () => 'saved')).toBe('saved')
    expect(runs).toEqual([
      ['take', lock.dir, 'token-1', '15000'],
      ['give', lock.dir, 'token-1'],
    ])
  })

  test('gives the lock back when the work throws', async () => {
    const { lock, runs } = scriptedLock([0])
    await expect(withStoreLock(lock, async () => Promise.reject(new Error('disk full')))).rejects.toThrow('disk full')
    expect(runs.map(args => args[0])).toEqual(['take', 'give'])
  })

  test('waits while another session holds it, then takes it', async () => {
    const { lock, runs, sleeps } = scriptedLock([STORE_LOCK_HELD, STORE_LOCK_HELD, 0])
    await withStoreLock(lock, async () => undefined)
    expect(runs.map(args => args[0])).toEqual(['take', 'take', 'take', 'give'])
    expect(sleeps).toEqual([50, 50])
  })

  test('refreshes the lock while the work runs, and stops when it is given back', async () => {
    const { lock, runs, timers } = scriptedLock([0])
    let finish = () => {}
    const writing = withStoreLock(lock, () => new Promise<void>(resolve => (finish = resolve)))
    for (let tick = 0; tick < 20 && timers.length === 0; tick++) await Promise.resolve()
    expect(timers).toHaveLength(1)
    expect(timers[0]?.ms).toBe(5000)
    await timers[0]?.beat()
    await timers[0]?.beat()
    finish()
    await writing
    expect(runs.map(args => args[0])).toEqual(['take', 'touch', 'touch', 'give'])
    expect(runs[1]).toEqual(['touch', lock.dir, 'token-1'])
    expect(timers[0]?.isStopped).toBe(true)
  })

  test('refuses the write when another session keeps the lock past the wait', async () => {
    const { lock, runs, timers } = scriptedLock([STORE_LOCK_HELD, STORE_LOCK_HELD, STORE_LOCK_HELD, STORE_LOCK_HELD, STORE_LOCK_HELD])
    let ran = false
    const error = await refusal(
      withStoreLock(lock, async () => {
        ran = true
      }),
    )
    expect(error.reason).toBe('held')
    expect(error.message).toContain('nothing was saved')
    expect(ran).toBe(false)
    expect(runs.map(args => args[0])).toEqual(['take', 'take', 'take', 'take'])
    expect(timers).toHaveLength(0)
  })

  test('refuses the write when node cannot run or the script fails', async () => {
    let ran = false
    const work = async () => {
      ran = true
    }
    const missing = scriptedLock([], { failRun: true })
    expect((await refusal(withStoreLock(missing.lock, work))).reason).toBe('unavailable')
    expect(missing.runs.map(args => args[0])).toEqual(['take'])

    const crashed = scriptedLock([1])
    expect((await refusal(withStoreLock(crashed.lock, work))).reason).toBe('unavailable')
    expect(crashed.runs.map(args => args[0])).toEqual(['take'])
    expect(ran).toBe(false)
  })
})
