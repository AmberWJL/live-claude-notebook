import { describe, expect, test } from 'claude-code/testing'

import { STORE_LOCK_HELD, withStoreLock, type StoreLock } from '../src/core/store-lock.mjs'

/** A lock whose script answers from `exits`, one exit code per `take`; records every run. */
function scriptedLock(exits: number[], options: { failRun?: boolean } = {}) {
  const runs: string[][] = []
  const sleeps: number[] = []
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
    newToken: () => `token-${(tokens += 1)}`,
    waitMs: 200,
    retryMs: 50,
  }
  return { lock, runs, sleeps }
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

  test('still saves, unlocked, when the lock stays held past the wait; gives back nothing it did not take', async () => {
    const { lock, runs } = scriptedLock([STORE_LOCK_HELD, STORE_LOCK_HELD, STORE_LOCK_HELD, STORE_LOCK_HELD, STORE_LOCK_HELD])
    let ran = false
    await withStoreLock(lock, async () => {
      ran = true
    })
    expect(ran).toBe(true)
    expect(runs.map(args => args[0])).toEqual(['take', 'take', 'take', 'take'])
  })

  test('still saves, unlocked, when node cannot run or the script fails', async () => {
    const missing = scriptedLock([], { failRun: true })
    expect(await withStoreLock(missing.lock, async () => 'saved')).toBe('saved')
    expect(missing.runs.map(args => args[0])).toEqual(['take'])

    const crashed = scriptedLock([1])
    expect(await withStoreLock(crashed.lock, async () => 'saved')).toBe('saved')
    expect(crashed.runs.map(args => args[0])).toEqual(['take'])
  })
})
