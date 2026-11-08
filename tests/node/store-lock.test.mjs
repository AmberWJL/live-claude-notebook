// The store lock's script in real processes, paused at exact points to replay races: plain `node --test`, no Claude Code.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { STORE_LOCK_HELD, STORE_LOCK_PAUSE_ENV, STORE_LOCK_SCRIPT, StoreLockError, withStoreLock } from '../../src/core/store-lock.mjs'

const STALE = '15000'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function runScript(args, env = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, ['-e', STORE_LOCK_SCRIPT, ...args], { env: { ...process.env, ...env } }, (error, stdout) => {
      resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout })
    })
  })
}

/** Runs the script stopped at `step` until `go()`; `reached` resolves once it stands there. */
function paused(scratchRoot, name, step, args) {
  const file = join(scratchRoot, `pause-${name}`)
  const done = runScript(args, { [STORE_LOCK_PAUSE_ENV]: `${step}=${file}` })
  const reached = (async () => {
    while (!existsSync(`${file}.reached`)) await sleep(5)
  })()
  return { reached, done, go: () => writeFileSync(`${file}.go`, '') }
}

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'store-lock-'))
  return { root, dir: join(root, 'live-notebook', '.store-lock'), done: () => rmSync(root, { recursive: true, force: true }) }
}

async function take(dir, token) {
  const { exitCode, stdout } = await runScript(['take', dir, token, STALE])
  return exitCode === 0 ? stdout.trim() : undefined
}

/** Makes a generation look abandoned: every file in it a minute old, as if its holder stopped renewing. */
function ageGeneration(dir, gen) {
  const old = new Date(Date.now() - 60_000)
  const folder = join(dir, String(gen).padStart(12, '0'))
  for (const name of readdirSync(folder)) utimesSync(join(folder, name), old, old)
  utimesSync(folder, old, old)
}

function every(ms, beat) {
  const timer = setInterval(() => void beat(), ms)
  return () => clearInterval(timer)
}

function realLock(dir, options = {}) {
  let tokens = 0
  const name = options.name ?? 'writer'
  return { dir, run: runScript, sleep, every, newToken: () => `${name}-${(tokens += 1)}`, retryMs: 25, ...options }
}

test('one holder at a time; only the holder renews and gives it back', async () => {
  const { dir, done } = scratch()
  try {
    const gen = await take(dir, 'a')
    assert.equal(gen, '1')
    assert.equal(await take(dir, 'b'), undefined)
    assert.equal((await runScript(['renew', dir, gen, 'a'])).exitCode, 0)
    assert.equal((await runScript(['renew', dir, gen, 'b'])).exitCode, STORE_LOCK_HELD)
    await runScript(['give', dir, gen, 'b'])
    assert.equal(await take(dir, 'b'), undefined, 'a non-holder cannot give it back')
    await runScript(['give', dir, gen, 'a'])
    assert.equal(await take(dir, 'b'), '2')
    assert.deepEqual(readdirSync(dir), ['000000000002'], 'given-back generations are cleared away')
  } finally {
    done()
  }
})

test('a lock its holder stopped renewing is taken over, and the old holder then learns it lost it', async () => {
  const { dir, done } = scratch()
  try {
    const gen = await take(dir, 'gone')
    ageGeneration(dir, gen)
    assert.equal(await take(dir, 'next'), '2')
    assert.equal((await runScript(['renew', dir, gen, 'gone'])).exitCode, STORE_LOCK_HELD)
    assert.equal((await runScript(['renew', dir, '2', 'next'])).exitCode, 0)
  } finally {
    done()
  }
})

test('a renewal right after the contender judged the lock stale keeps the holder, and the contender withdraws', async () => {
  const { root, dir, done } = scratch()
  try {
    const gen = await take(dir, 'holder')
    ageGeneration(dir, gen)
    const contender = paused(root, 'c', 'take:after-stat', ['take', dir, 'contender', STALE])
    await contender.reached
    assert.equal((await runScript(['renew', dir, gen, 'holder'])).exitCode, 0, 'the holder renews while the contender stands between its check and its takeover')
    contender.go()
    assert.equal((await contender.done).exitCode, STORE_LOCK_HELD)
    assert.equal((await runScript(['renew', dir, gen, 'holder'])).exitCode, 0, 'the holder still has the lock')
    assert.equal(await take(dir, 'third'), undefined)
  } finally {
    done()
  }
})

test('a renewal right after the contender created its generation stops both, never lets both go on', async () => {
  const { root, dir, done } = scratch()
  try {
    const gen = await take(dir, 'holder')
    ageGeneration(dir, gen)
    const contender = paused(root, 'c', 'take:after-create', ['take', dir, 'contender', STALE])
    await contender.reached
    assert.equal((await runScript(['renew', dir, gen, 'holder'])).exitCode, STORE_LOCK_HELD, 'the holder sees a newer generation and stops')
    contender.go()
    assert.equal((await contender.done).exitCode, STORE_LOCK_HELD, 'the contender sees the renewal and withdraws')
    await runScript(['give', dir, gen, 'holder'])
    assert.notEqual(await take(dir, 'next'), undefined, 'once the holder gives it back, the lock is free')
  } finally {
    done()
  }
})

test('a holder paused between its renewal and its check keeps the lock against a contender', async () => {
  const { root, dir, done } = scratch()
  try {
    const gen = await take(dir, 'holder')
    ageGeneration(dir, gen)
    const contender = paused(root, 'c', 'take:after-stat', ['take', dir, 'contender', STALE])
    await contender.reached
    const holder = paused(root, 'h', 'renew:after-beat', ['renew', dir, gen, 'holder'])
    await holder.reached
    contender.go()
    assert.equal((await contender.done).exitCode, STORE_LOCK_HELD)
    holder.go()
    assert.equal((await holder.done).exitCode, 0)
  } finally {
    done()
  }
})

test('two contenders taking over the same stale lock at once: exactly one gets it', async () => {
  const { root, dir, done } = scratch()
  try {
    const gen = await take(dir, 'gone')
    ageGeneration(dir, gen)
    const first = paused(root, 'one', 'take:after-stat', ['take', dir, 'one', STALE])
    const second = paused(root, 'two', 'take:after-stat', ['take', dir, 'two', STALE])
    await Promise.all([first.reached, second.reached])
    first.go()
    second.go()
    const exits = [(await first.done).exitCode, (await second.done).exitCode].sort()
    assert.deepEqual(exits, [0, STORE_LOCK_HELD])
  } finally {
    done()
  }
})

test('read-modify-writes from many processes at once lose nothing under the lock', async () => {
  const { root, dir, done } = scratch()
  const counter = join(root, 'counter')
  writeFileSync(counter, '0')
  const lock = realLock(dir, { waitMs: 30_000, retryMs: 10 })
  const increment = () =>
    withStoreLock(lock, async check => {
      const seen = Number(readFileSync(counter, 'utf8'))
      await sleep(5)
      await check()
      writeFileSync(counter, String(seen + 1))
    })
  try {
    await Promise.all(Array.from({ length: 12 }, increment))
    assert.equal(readFileSync(counter, 'utf8'), '12')
    assert.equal(await take(dir, 'after'), '13', 'every writer gave the lock back')
  } finally {
    done()
  }
})

test('a lock that is never given back makes the next writer give up and write nothing', async () => {
  const { root, dir, done } = scratch()
  const counter = join(root, 'counter')
  writeFileSync(counter, '0')
  try {
    assert.notEqual(await take(dir, 'stuck'), undefined)
    await assert.rejects(
      withStoreLock(realLock(dir, { waitMs: 400 }), async () => writeFileSync(counter, '1')),
      error => error instanceof StoreLockError && error.reason === 'held',
    )
    assert.equal(readFileSync(counter, 'utf8'), '0')
  } finally {
    done()
  }
})

test('a writer whose lock was taken over writes nothing more', async () => {
  const { root, dir, done } = scratch()
  const note = join(root, 'note')
  writeFileSync(note, 'first')
  try {
    let gen
    const writing = withStoreLock(realLock(dir, { name: 'slow' }), async check => {
      gen = readdirSync(dir).at(-1)
      ageGeneration(dir, Number(gen))
      assert.notEqual(await take(dir, 'other'), undefined, 'another writer takes the abandoned-looking lock')
      writeFileSync(note, 'other')
      await check()
      writeFileSync(note, 'stale')
    })
    await assert.rejects(writing, error => error instanceof StoreLockError && error.reason === 'lost')
    assert.equal(readFileSync(note, 'utf8'), 'other')
  } finally {
    done()
  }
})

test('a holder that keeps renewing is never taken over; once it stops, it is', async () => {
  const { dir, done } = scratch()
  const staleMs = 1_500
  try {
    const gen = (await runScript(['take', dir, 'slow', String(staleMs)])).stdout.trim()
    const stopRenewing = every(200, () => runScript(['renew', dir, gen, 'slow']))
    let ran = false
    await assert.rejects(
      withStoreLock(realLock(dir, { staleMs, waitMs: staleMs * 2 }), async () => {
        ran = true
      }),
      error => error instanceof StoreLockError && error.reason === 'held',
    )
    assert.equal(ran, false, 'a live holder was not taken over, though older than the stale time')
    stopRenewing()
    await sleep(300)
    await withStoreLock(realLock(dir, { staleMs, waitMs: staleMs * 4, name: 'next' }), async check => {
      await check()
      ran = true
    })
    assert.equal(ran, true)
  } finally {
    done()
  }
})
