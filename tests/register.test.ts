import { describe, expect, mock, test } from 'claude-code/testing'

import { NOTES, PANE, PANE_PROPS, PLUGIN, RUN, START, entryKeys, fakeEngine, fakeFs, fakeStore, firstEntry } from './support'

const seeded = {
  schemaVersion: 1,
  id: 'e-1',
  title: 'Blue/green deploy',
  content: 'Switch traffic only after health checks pass.',
  folder: 'Ops',
  type: 'learning',
  tags: ['ops'],
  sources: [{ captureMode: 'excerpt', snapshot: 'Switch traffic only after health checks pass.', capturedAt: 1 }],
  status: 'confirmed',
  createdAt: 1,
  updatedAt: 1,
}

describe('live-notebook hooks', () => {
  test('/save with typed text drafts an excerpt; the editor edits it; Save files it, confirms, classifies it, and it survives a restart', async ($, on) => {
    const data = fakeStore(on)
    const fs = fakeFs(on)
    const engine = fakeEngine(on)
    const clock = mock.clock(on, { now: 1_760_000_000_000 })
    await $.session.start(START)
    expect(engine.registered).toEqual(['save', 'notebook'])
    expect(data.get('meta')).toEqual({ schemaVersion: 1 })
    expect(fs.read(`${NOTES}/General/_notebook.json`)).toContain('"tags": []')

    const ran = await $.command.run({ ...RUN, command: 'save', args: 'Keep the TTL under one minute.' })
    expect(ran.text).toContain('Review the excerpt')
    expect(engine.opened).toEqual([PANE])

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: /^Save to notebook$/ })).toBeDefined()
      expect((await ui.find({ key: 'folder' }))?.props.value).toBe('General')
      expect(await ui.find({ key: 'editor' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Keep the TTL under one minute\. · excerpt · / })).toBeDefined()
      expect(await ui.find({ key: 'title' })).toBeUndefined()
      expect(await ui.find({ key: 'tags' })).toBeUndefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    await ui.key({ key: 'return', in: 'editor' })
    for (const ch of 'Why: cold caches.') await ui.key({ key: ch, in: 'editor' })
    expect(await ui.find({ type: 'Text', text: /48 characters/ })).toBeDefined()
    await ui.input({ key: 'folder-new', text: 'Caching' })
    expect((await ui.find({ key: 'folder' }))?.props.value).toBe('Caching')
    expect(entryKeys(data)).toEqual([])
    await ui.press({ key: 'save' })

    // Saved: back on the list with a confirmation that opens the entry.
    expect(entryKeys(data)).toHaveLength(1)
    const stored = firstEntry(data)
    const id = String(stored.id)
    expect(stored).toMatchObject({
      schemaVersion: 1,
      title: 'Keep the TTL under one minute.',
      content: 'Keep the TTL under one minute.\nWhy: cold caches.',
      folder: 'Caching',
      type: 'other',
      status: 'confirmed',
      createdAt: 1_760_000_000_000,
      file: `Caching/keep-the-ttl-under-one-minute--${id.slice(0, 8)}.md`,
    })
    expect((stored.sources as Array<Record<string, unknown>>)[0]).toMatchObject({
      captureMode: 'excerpt',
      snapshot: 'Keep the TTL under one minute.',
      capturedAt: 1_760_000_000_000,
      context: { before: [], after: [], cwd: '/tmp/live-notebook-test' },
    })
    expect(data.get('folders')).toEqual({ names: ['General', 'Caching'], last: 'Caching' })
    const file = fs.read(`${NOTES}/${String(stored.file)}`) ?? ''
    expect(file).toContain(`id: ${id}`)
    expect(file).toContain('title: "Keep the TTL under one minute."')
    expect(file.endsWith('\nKeep the TTL under one minute.\nWhy: cold caches.\n')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Live Notebook$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Saved to Caching$/ })).toBeDefined()
    expect(await ui.find({ key: 'open-saved' })).toBeDefined()
    expect((await ui.find({ key: 'nb:Caching' }))?.text).toBe('▾ Caching')
    expect((await ui.find({ key: `entry:${id}` }))?.text).toBe('Keep the TTL under one minute.')
    // The row's preview does not repeat the title line.
    expect(await ui.find({ type: 'Text', text: /^Why: cold caches\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^#live-notebook-test$/ })).toBeDefined()
    expect(engine.toasts).toEqual(['Saved to Caching: Keep the TTL under one minute.'])

    // The timers: tags for the notebook and a type for the note.
    await clock.advance(5)
    expect(engine.prompts).toHaveLength(2)
    expect(engine.prompts.some(prompt => prompt.includes('named "Caching"'))).toBe(true)
    expect(engine.prompts.some(prompt => prompt.startsWith('Classify'))).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^#live-claude-notebook  #caching  #ttl$/ })).toBeDefined()
    expect(data.get('tags:Caching')).toMatchObject({ tags: ['live-claude-notebook', 'caching', 'ttl'], basis: '1:1760000000000', by: 'model' })
    expect(firstEntry(data)).toMatchObject({ type: 'insight', tags: ['caching', 'ttl'] })
    expect(fs.read(`${NOTES}/${String(stored.file)}`)).toContain('type: insight')
    expect(await ui.find({ type: 'Text', text: /^#caching  #ttl$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Oct 9$/ })).toBeDefined()

    // Filters and live search.
    await ui.press({ key: 'filter:insight' })
    expect(await ui.find({ type: 'Text', text: /^1 note$/ })).toBeDefined()
    expect(await ui.find({ key: `entry:${id}` })).toBeDefined()
    await ui.press({ key: 'filter:decision' })
    expect(await ui.find({ type: 'Text', text: /^No decisions yet\.$/ })).toBeDefined()
    await ui.press({ key: 'filter:all' })
    await ui.input({ key: 'search', text: 'nothing-here', kind: 'change' })
    expect(await ui.find({ type: 'Text', text: /^No notes match "nothing-here"\.$/ })).toBeDefined()
    await ui.input({ key: 'search', text: 'cold', kind: 'change' })
    expect(await ui.find({ key: `entry:${id}` })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ key: 'clear' })).toBeUndefined()

    // The confirmation opens the entry; the detail view shows its type.
    await ui.press({ key: 'open-saved' })
    expect(await ui.find({ type: 'Text', text: /^Keep the TTL under one minute\.$/ })).toBeDefined()
    expect((await ui.find({ key: 'type' }))?.props.value).toBe('insight')
    await ui.select({ key: 'type', value: 'decision' })
    expect(firstEntry(data)).toMatchObject({ type: 'decision' })
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'nb:General' })).toBeDefined()
    // Collapsing a notebook hides its rows; an empty one starts collapsed.
    expect((await ui.find({ key: 'nb:General' }))?.text).toBe('▸ General')
    await ui.press({ key: 'nb:Caching' })
    expect((await ui.find({ key: 'nb:Caching' }))?.text).toBe('▸ Caching')
    expect(await ui.find({ key: `entry:${id}` })).toBeUndefined()
    await ui.press({ key: 'nb:Caching' })
    expect(await ui.find({ key: `entry:${id}` })).toBeDefined()

    // The same excerpt again is not saved twice.
    await $.command.run({ ...RUN, command: 'save', args: 'Keep the TTL under one minute.\nWhy: cold caches.' })
    await ui.press({ key: 'save' })
    expect(entryKeys(data)).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /^Already in Caching$/ })).toBeDefined()
    expect(await ui.find({ key: 'open-saved' })).toBeDefined()
    // The status line clears itself.
    await clock.advance(6_100)
    expect(await ui.find({ type: 'Text', text: /^Already in Caching$/ })).toBeUndefined()
    await ui.unmount()

    // A restart: the session starts again over the same store and files.
    await $.session.start(START)
    await $.command.run({ ...RUN, command: 'notebook', args: 'ttl' })
    const again = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await again.find({ type: 'Text', text: /^1 note$/ })).toBeDefined()
    expect((await again.find({ key: `entry:${id}` }))?.text).toBe('Keep the TTL under one minute.')
    expect(engine.prompts).toHaveLength(2)
    await again.unmount()
  })

  test('edits made on the web come back: a changed file, a new note, a new notebook, a deleted note', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    const fs = fakeFs(on)
    fakeEngine(on)
    const clock = mock.clock(on, { now: 100 })
    await $.session.start(START)
    const path = `${NOTES}/Ops/blue-green-deploy--e-1.md`
    expect(fs.read(path)).toContain('Switch traffic only after health checks pass.')
    expect(fs.read(path)).toContain('type: learning')
    expect(data.get('entry:e-1')).toMatchObject({ file: 'Ops/blue-green-deploy--e-1.md' })

    await clock.advance(3_000)
    expect(data.get('entry:e-1')).toMatchObject({ content: 'Switch traffic only after health checks pass.' })

    fs.writeFromWeb(path, '---\nid: e-1\ntitle: "Blue/green, revised"\nfolder: "Ops"\ntype: decision\n---\n\nSwitch traffic after health checks. Then watch error rates.\n')
    fs.writeFromWeb(
      `${NOTES}/Ideas/try-canaries--abcd1234.md`,
      '---\nid: abcd1234-0000-0000-0000-000000000000\ntitle: "Try canaries"\ncreated: 2026-01-01T00:00:00.000Z\n---\n\nRoll out to 5% first.\n',
    )
    await clock.advance(3_000)

    expect(data.get('entry:e-1')).toMatchObject({
      title: 'Blue/green, revised',
      content: 'Switch traffic after health checks. Then watch error rates.',
      type: 'decision',
      updatedAt: 6_100,
    })
    expect((data.get('entry:e-1') as { sources: Array<{ snapshot: string }> }).sources[0]?.snapshot).toBe(
      'Switch traffic only after health checks pass.',
    )
    expect(data.get('entry:abcd1234-0000-0000-0000-000000000000')).toMatchObject({
      title: 'Try canaries',
      content: 'Roll out to 5% first.',
      folder: 'Ideas',
      file: 'Ideas/try-canaries--abcd1234.md',
      createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    })
    expect(data.get('folders')).toEqual({ names: ['General', 'Ops', 'Ideas'], last: 'Ops' })

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ key: 'nb:Ideas' })).toBeDefined()
    expect(await ui.find({ key: 'entry:e-1' })).toBeDefined()
    expect(await ui.find({ key: 'entry:abcd1234-0000-0000-0000-000000000000' })).toBeDefined()
    await ui.press({ key: 'filter:decision' })
    expect(await ui.find({ key: 'entry:e-1' })).toBeDefined()
    expect(await ui.find({ key: 'entry:abcd1234-0000-0000-0000-000000000000' })).toBeUndefined()
    await ui.press({ key: 'filter:all' })

    // Edited in the pane: the snapshot stays and can be shown beside the content.
    await ui.press({ key: 'entry:e-1' })
    expect(await ui.find({ key: 'snapshot' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /only after health checks pass/ })).toBeUndefined()
    await ui.press({ key: 'snapshot' })
    expect(await ui.find({ type: 'Markdown', text: /only after health checks pass/ })).toBeDefined()
    await ui.press({ key: 'edit' })
    expect(await ui.find({ type: 'Text', text: /^Edit: Blue\/green, revised$/ })).toBeDefined()
    await ui.select({ key: 'edit-folder', value: 'General' })
    for (const ch of ' Always.') await ui.key({ key: ch, in: 'editor' })
    await ui.press({ key: 'save-edit' })
    expect(data.get('entry:e-1')).toMatchObject({
      content: 'Switch traffic after health checks. Then watch error rates. Always.',
      folder: 'General',
    })
    expect(await ui.find({ type: 'Text', text: /^Saved changes$/ })).toBeDefined()

    // Deleted on the web: the file is marked archived, so the entry is archived.
    await ui.press({ key: 'back' })
    fs.writeFromWeb(`${NOTES}/General/blue-green-deploy--e-1.md`, '---\nid: e-1\narchived: true\n---\n\nwhatever\n')
    await clock.advance(3_000)
    expect(data.get('entry:e-1')).toMatchObject({ status: 'archived' })
    expect(await ui.find({ key: 'entry:e-1' })).toBeUndefined()
    await ui.unmount()
  })

  test('the web notebook starts with the session; Open Live Notebook opens the browser', async ($, on) => {
    fakeStore(on)
    fakeFs(on)
    const engine = fakeEngine(on)
    const clock = mock.clock(on)
    await $.session.start(START)
    expect(engine.commands).toEqual([])
    await clock.advance(5)
    expect(engine.commands.map(argv => argv[0])).toEqual(['node', 'node'])
    expect(engine.commands[0]).toEqual(['node', '--version'])
    expect(engine.commands[1]).toContain('--launch')

    const ran = await $.command.run({ ...RUN, command: 'notebook', args: 'web' })
    expect(ran.text).toBe('Web notebook: http://127.0.0.1:4321')
    expect(engine.commands[4]?.[0]).toBe('open')
    expect(engine.commands[4]?.[1]).toBe('http://127.0.0.1:4321')

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect((await ui.find({ key: 'web' }))?.text).toBe('Open Live Notebook')
    expect(await ui.find({ key: 'web-stop' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /web notebook (running|off)/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /127\.0\.0\.1/ })).toBeUndefined()
    await ui.press({ key: 'web' })
    expect(engine.commands.filter(argv => argv[0] === 'open')).toHaveLength(2)
    await ui.press({ key: 'more' })
    expect(await ui.find({ key: 'new-notebook' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Rename, export or delete/ })).toBeDefined()
    await ui.unmount()
  })

  test('a storage failure keeps the draft and reports no success', async ($, on) => {
    const data = fakeStore(on, {}, { failSetMatching: /^entry:/ })
    fakeFs(on)
    fakeEngine(on)
    mock.clock(on)
    await $.session.start(START)
    await $.command.run({ ...RUN, command: 'save', args: 'Will not persist.' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    await ui.press({ key: 'save' })
    expect(await ui.find({ type: 'Text', text: /Saving failed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /draft is still here/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Saved / })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Will not persist\. · excerpt · / })).toBeDefined()
    expect((await ui.find({ key: 'save' }))?.text).toBe('Save')
    expect(entryKeys(data)).toEqual([])
    await ui.unmount()
  })

  test('/save with no text and no selection offers recent messages, newest first, and keeps context', async ($, on) => {
    const data = fakeStore(on)
    fakeFs(on)
    fakeEngine(on, [
      { role: 'user', text: 'How do I invalidate the cache?', toolUses: [] },
      { role: 'assistant', text: 'Set the TTL to 60 seconds.', toolUses: [] },
      { role: 'user', text: 'Thanks!', toolUses: [] },
    ])
    mock.clock(on, { now: 42 })
    await $.session.start(START)
    const ran = await $.command.run({ ...RUN, command: 'save', args: '' })
    expect(ran.text).toContain('Pick a message')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /Save which message/ })).toBeDefined()
    expect((await ui.find({ key: 'pick:1' }))?.text).toBe('Claude: Set the TTL to 60 seconds.')
    expect((await ui.find({ key: 'pick:0' }))?.text).toBe('You: How do I invalidate the cache?')

    await ui.press({ key: 'pick:1' })
    expect(await ui.find({ type: 'Text', text: /^Set the TTL to 60 seconds\. · whole message · assistant/ })).toBeDefined()
    await ui.press({ key: 'save' })
    const stored = firstEntry(data)
    expect((stored.sources as Array<Record<string, unknown>>)[0]).toMatchObject({
      captureMode: 'whole_message',
      role: 'assistant',
      sessionId: 'session-test',
      snapshot: 'Set the TTL to 60 seconds.',
      capturedAt: 42,
      context: {
        before: [{ role: 'user', text: 'How do I invalidate the cache?' }],
        after: [{ role: 'user', text: 'Thanks!' }],
        cwd: '/tmp/live-notebook-test',
      },
    })
    await ui.press({ key: 'open-saved' })
    expect(await ui.find({ type: 'Text', text: /In reply to: How do I invalidate the cache\?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^notes\/General\// })).toBeDefined()
    expect(await ui.find({ key: 'view-source' })).toBeUndefined()
    expect(await ui.find({ key: 'snapshot' })).toBeDefined()
    await ui.unmount()
  })

  test('/save with nothing to pick from says so; the pick view can be cancelled; the empty notebook explains itself', async ($, on) => {
    fakeStore(on)
    fakeFs(on)
    fakeEngine(on)
    mock.clock(on)
    await $.session.start(START)
    const ran = await $.command.run({ ...RUN, command: 'save', args: '' })
    expect(ran.text).toContain('No messages to pick from yet')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /Save which message/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    expect(await ui.find({ type: 'Text', text: /^No notes yet$/ })).toBeDefined()
    expect(await ui.find({ key: 'new-note' })).toBeDefined()
    expect(await ui.find({ key: 'capture' })).toBeUndefined()
    await ui.unmount()
  })

  test('a narrow pane stacks its controls and a wide one keeps the list beside an open note', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    fakeFs(on)
    fakeEngine(on)
    mock.clock(on)
    await $.session.start(START)
    expect(data.get('entry:e-1')).toBeDefined()
    const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 40 } })
    expect(await narrow.find({ key: 'new-note' })).toBeDefined()
    await narrow.press({ key: 'entry:e-1' })
    expect(await narrow.find({ type: 'Text', text: /^Blue\/green deploy$/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /^Ops · 1$/ })).toBeUndefined()
    await narrow.unmount()
    const wide = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 140 } })
    expect(await wide.find({ type: 'Text', text: /^Ops · 1$/ })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: /^▍$/ })).toBeDefined()
    expect(await wide.find({ key: 'entry:e-1' })).toBeDefined()
    await wide.unmount()
  })
})
