// The store lock's script in real processes: plain `node --test`, no Claude Code.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { STORE_LOCK_HELD, STORE_LOCK_SCRIPT, StoreLockError, withStoreLock } from '../../src/core/store-lock.mjs'

function runScript(args) {
  return new Promise(resolve => {
    execFile(process.execPath, ['-e', STORE_LOCK_SCRIPT, ...args], error => resolve({ exitCode: error ? (error.code ?? 1) : 0 }))
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function every(ms, beat) {
  const timer = setInterval(() => void beat(), ms)
  return () => clearInterval(timer)
}

function realLock(dir, options = {}) {
  let tokens = 0
  const name = options.name ?? 'writer'
  return { dir, run: runScript, sleep, every, newToken: () => `${name}-${(tokens += 1)}`, retryMs: 25, ...options }
}

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'store-lock-'))
  return { root, dir: join(root, 'live-notebook', '.store.lock'), done: () => rmSync(root, { recursive: true, force: true }) }
}

test('one holder at a time; only the holder gives it back', async () => {
  const { dir, done } = scratch()
  try {
    assert.equal((await runScript(['take', dir, 'a', '15000'])).exitCode, 0)
    assert.equal(readFileSync(join(dir, 'owner'), 'utf8'), 'a')
    assert.equal((await runScript(['take', dir, 'b', '15000'])).exitCode, STORE_LOCK_HELD)
    await runScript(['give', dir, 'b'])
    assert.equal(existsSync(dir), true, 'a non-holder cannot give it back')
    await runScript(['give', dir, 'a'])
    assert.equal(existsSync(dir), false)
    assert.equal((await runScript(['take', dir, 'b', '15000'])).exitCode, 0)
  } finally {
    done()
  }
})

test('a lock left by a session that stopped mid-write is taken over once it is stale', async () => {
  const { dir, done } = scratch()
  try {
    assert.equal((await runScript(['take', dir, 'gone', '15000'])).exitCode, 0)
    const old = new Date(Date.now() - 60_000)
    utimesSync(dir, old, old)
    assert.equal((await runScript(['take', dir, 'next', '15000'])).exitCode, 0)
    assert.equal(readFileSync(join(dir, 'owner'), 'utf8'), 'next')
  } finally {
    done()
  }
})

test('read-modify-writes from many processes at once lose nothing under the lock', async () => {
  const { root, dir, done } = scratch()
  const counter = join(root, 'counter')
  writeFileSync(counter, '0')
  const lock = realLock(dir, { waitMs: 20_000, retryMs: 10 })
  const increment = () =>
    withStoreLock(lock, async () => {
      const seen = Number(readFileSync(counter, 'utf8'))
      await new Promise(resolve => setTimeout(resolve, 5))
      writeFileSync(counter, String(seen + 1))
    })
  try {
    await Promise.all(Array.from({ length: 12 }, increment))
    assert.equal(readFileSync(counter, 'utf8'), '12')
    assert.equal(existsSync(dir), false, 'the last writer gave the lock back')
  } finally {
    done()
  }
})

test('a lock that is never given back makes the next writer give up and write nothing', async () => {
  const { root, dir, done } = scratch()
  const counter = join(root, 'counter')
  writeFileSync(counter, '0')
  try {
    assert.equal((await runScript(['take', dir, 'stuck', '15000'])).exitCode, 0)
    await assert.rejects(
      withStoreLock(realLock(dir, { waitMs: 400 }), async () => writeFileSync(counter, '1')),
      error => error instanceof StoreLockError && error.reason === 'held',
    )
    assert.equal(readFileSync(counter, 'utf8'), '0')
    assert.equal(readFileSync(join(dir, 'owner'), 'utf8'), 'stuck', 'the refused writer left the lock alone')
  } finally {
    done()
  }
})

test('a holder that keeps refreshing its lock is never taken over; once it stops, it is', async () => {
  const { dir, done } = scratch()
  const staleMs = 1_500
  try {
    assert.equal((await runScript(['take', dir, 'slow', String(staleMs)])).exitCode, 0)
    const stopRefreshing = every(200, () => runScript(['touch', dir, 'slow']))
    let ran = false
    await assert.rejects(
      withStoreLock(realLock(dir, { staleMs, waitMs: staleMs * 2 }), async () => {
        ran = true
      }),
      error => error instanceof StoreLockError && error.reason === 'held',
    )
    assert.equal(ran, false, 'a live holder was not taken over, though older than the stale time')
    stopRefreshing()
    await sleep(300)
    await withStoreLock(realLock(dir, { staleMs, waitMs: staleMs * 4, name: 'next' }), async () => {
      ran = true
      assert.equal(readFileSync(join(dir, 'owner'), 'utf8'), 'next-1')
    })
    assert.equal(ran, true)
  } finally {
    done()
  }
})
