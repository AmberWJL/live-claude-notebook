import type { RenderElement } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { HOME, NOTES, PANE, PANE_PROPS, PLUGIN, ROOT, RUN, START, entryKeys, fakeEngine, fakeFs, fakeStore, firstEntry } from './support'

/** The capture editor's rows as its module drew them, each row's runs joined, trailing blank rows dropped. */
function editorLines(tree: RenderElement): string[] {
  type Node = { children?: unknown }
  const textOf = (node: unknown): string => {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    return textOf((node as Node | null)?.children ?? '')
  }
  const rows = (tree as Node).children
  return (Array.isArray(rows) ? rows : []).map(row => textOf(row).trimEnd())
}

function editorText(tree: RenderElement): string {
  return editorLines(tree).join('\n').replace(/\n+$/, '')
}

/** Types `text` into the Client keyed `key`, one key event per character. */
async function typeInto(ui: { key: (event: { key: string; in: string }) => Promise<unknown> }, key: string, text: string): Promise<void> {
  for (const char of text) await ui.key({ key: char === ' ' ? 'space' : char, in: key })
}

/** The `hover` of the drawn element keyed `key`, which `find` leaves out. */
function hoverOf(tree: unknown, key: string): unknown {
  if (Array.isArray(tree)) {
    for (const one of tree) {
      const found = hoverOf(one, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof tree !== 'object' || tree === null) return undefined
  const node = tree as { props?: { key?: unknown }; hover?: unknown; children?: unknown }
  if (node.props?.key === key) return node.hover
  return hoverOf(node.children, key)
}

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
  test('/save with typed text drafts an excerpt; the pane editor edits it; Save files it, confirms, classifies it, and it survives a restart', async ($, on) => {
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
      // The capture page: breadcrumb, Save, the toolbar and the editor, the date under it; the notebook picker behind ⋯.
      expect(await ui.find({ type: 'Text', text: /^General$/ })).toBeDefined()
      expect((await ui.find({ type: 'Button', key: 'draft-title' }))?.text).toBe('Keep the TTL under one minute.')
      expect(await ui.find({ key: 'save' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Captured Oct 9, 2025, 08:53$/ })).toBeDefined()
      expect(await ui.find({ key: 'fmt-bold' })).toBeDefined()
      expect((await ui.find({ key: 'fmt-h1' }))?.text).toBe('H1')
      expect((await ui.find({ key: 'fmt-number' }))?.text).toBe('1. List')
      expect(await ui.find({ key: 'fmt-undo' })).toBeUndefined()
      expect(await ui.find({ key: 'fmt-redo' })).toBeUndefined()
      expect(await ui.find({ key: 'editor' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /excerpt|characters/ })).toBeUndefined()
      expect(await ui.find({ key: 'title' })).toBeUndefined()
      expect(await ui.find({ key: 'tags' })).toBeUndefined()
      // The title is edited in the breadcrumb (no Title field); under the header the notebook and type pickers;
      // no ⋯ menu, no new-notebook field (that is the home page's).
      expect(await ui.find({ key: 'page-more' })).toBeUndefined()
      expect(await ui.find({ type: 'Input', key: 'draft-title' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^Title$/ })).toBeUndefined()
      expect((await ui.find({ key: 'folder' }))?.props.value).toBe('General')
      // The type picker, labelled, starts on Other (no "Automatic" entry): a note saved as Other is typed by the model.
      // Each option is the type's mark, then its name.
      expect((await ui.find({ key: 'draft-type' }))?.props).toMatchObject({ label: 'Type', value: 'other' })
      expect((await ui.find({ key: 'draft-type' }))?.props.options).toEqual([
        { value: 'insight', label: '◉ Insight' },
        { value: 'learning', label: '↗ Learning' },
        { value: 'reference', label: '▤ Reference' },
        { value: 'other', label: '• Other' },
      ])
      expect(await ui.find({ key: 'folder-new' })).toBeUndefined()
      expect((await ui.find({ key: 'cancel' }))?.text).toBe('Discard')
      await ui.unmount()
    }

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    // The editor opens with the cursor at the top; End, then a new line under the excerpt.
    await ui.key({ key: 'end', in: 'editor' })
    await ui.key({ key: 'return', in: 'editor' })
    for (const ch of 'Why: cold caches.') await ui.key({ key: ch, in: 'editor' })
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Keep the TTL under one minute.\nWhy: cold caches.')
    // The home icon keeps the draft; Resume brings it back with the text intact.
    await ui.press({ key: 'home-icon' })
    expect(await ui.find({ key: 'new-note' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Draft kept$/ })).toBeDefined()
    await ui.press({ key: 'resume-draft' })
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Keep the TTL under one minute.\nWhy: cold caches.')
    // Resume may bring the editor back fresh, its cursor at the top: a click puts it on the second line.
    await ui.pointer({ type: 'down', x: 3, y: 1, button: 'left', in: 'editor' })
    // Toolbar: H2 heads the cursor's line; pressed again on that line, it makes it normal text.
    await ui.press({ key: 'fmt-h2' })
    await ui.redraw()
    expect(editorLines(await ui.drawn({ in: 'editor' }))[1]).toBe('## Why: cold caches.')
    await ui.press({ key: 'fmt-h2' })
    await ui.redraw()
    expect(editorLines(await ui.drawn({ in: 'editor' }))[1]).toBe('Why: cold caches.')
    // A click on the first line moves the cursor there; H1 heads that line, and ⌘Z takes it off.
    await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'editor' })
    await ui.press({ key: 'fmt-h1' })
    await ui.redraw()
    expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('# Keep the TTL under one minute.')
    await ui.key({ key: 'z', meta: true, in: 'editor' })
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Keep the TTL under one minute.\nWhy: cold caches.')
    // A notebook added on the home page is picked for the kept draft, whose Resume stays; the picker shows it.
    await ui.press({ key: 'home-icon' })
    await ui.press({ key: 'new-notebook-start' })
    await ui.input({ key: 'new-notebook', text: 'Caching' })
    expect(await ui.find({ type: 'Text', text: /^Draft kept$/ })).toBeDefined()
    await ui.press({ key: 'resume-draft' })
    expect((await ui.find({ key: 'folder' }))?.props.value).toBe('Caching')
    await ui.select({ key: 'folder', value: 'General' })
    expect((await ui.find({ key: 'folder' }))?.props.value).toBe('General')
    await ui.select({ key: 'folder', value: 'Caching' })
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
      context: { before: [], after: [], project: 'live-notebook-test' },
    })
    expect(data.get('folders')).toEqual({ names: ['General', 'Caching'], last: 'Caching' })
    const file = fs.read(`${NOTES}/${String(stored.file)}`) ?? ''
    expect(file).toContain(`id: ${id}`)
    expect(file).toContain('title: "Keep the TTL under one minute."')
    expect(file.endsWith('\nKeep the TTL under one minute.\nWhy: cold caches.\n')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Live Notebook$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Saved to Caching$/ })).toBeDefined()
    expect(await ui.find({ key: 'open-saved' })).toBeDefined()
    expect((await ui.find({ key: 'nb:Caching' }))?.text).toBe('⌄')
    expect(await ui.find({ type: 'Text', text: /^Caching$/ })).toBeDefined()
    expect((await ui.find({ key: `entry:${id}` }))?.text).toBe('Keep the TTL under one minute.')
    // Notebook tags belong to the web notebook; the pane shows none.
    expect(await ui.find({ type: 'Text', text: /^#live-notebook-test$/ })).toBeUndefined()
    expect(engine.toasts).toEqual(['Saved to Caching: Keep the TTL under one minute.'])

    // The timers: tags for the notebook and a type for the note.
    await clock.advance(5)
    expect(engine.prompts).toHaveLength(2)
    expect(engine.prompts.some(prompt => prompt.includes('named "Caching"'))).toBe(true)
    expect(engine.prompts.some(prompt => prompt.startsWith('Classify'))).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^#live-claude-notebook  #caching  #ttl$/ })).toBeUndefined()
    expect(data.get('tags:Caching')).toMatchObject({ tags: ['live-claude-notebook', 'caching', 'ttl'], basis: '1:1760000000000', by: 'model' })
    expect(firstEntry(data)).toMatchObject({ type: 'insight', tags: ['caching', 'ttl'], title: 'TTL rule for cold caches' })
    expect(engine.prompts.find(prompt => prompt.startsWith('Classify'))).toContain('at most 6 words')
    expect(fs.read(`${NOTES}/${String(stored.file)}`)).toContain('type: insight')
    expect(fs.read(`${NOTES}/${String(stored.file)}`)).toContain('title: "TTL rule for cold caches"')
    expect((await ui.find({ key: `entry:${id}` }))?.text).toBe('TTL rule for cold caches')
    expect(await ui.find({ type: 'Text', text: /^Oct 9$/ })).toBeUndefined()

    // Filters and live search.
    await ui.press({ key: 'filter:insight' })
    expect(await ui.find({ type: 'Text', text: /^1 note$/ })).toBeDefined()
    expect(await ui.find({ key: `entry:${id}` })).toBeDefined()
    await ui.press({ key: 'filter:learning' })
    expect(await ui.find({ type: 'Text', text: /^No learnings yet\.$/ })).toBeDefined()
    await ui.press({ key: 'filter:other' })
    expect(await ui.find({ type: 'Text', text: /^No other notes yet\.$/ })).toBeDefined()
    expect(await ui.find({ key: 'filter:decision' })).toBeUndefined()
    expect(await ui.find({ key: 'filter:idea' })).toBeUndefined()
    await ui.press({ key: 'filter:all' })
    await ui.input({ key: 'search', text: 'nothing-here', kind: 'change' })
    expect(await ui.find({ type: 'Text', text: /^No notes match "nothing-here"\.$/ })).toBeDefined()
    await ui.input({ key: 'search', text: 'cold', kind: 'change' })
    expect(await ui.find({ key: `entry:${id}` })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ key: 'clear' })).toBeUndefined()

    // The confirmation opens the note's page: its text read-only, when it was created under it (not yet edited), and Open in web.
    await ui.press({ key: 'open-saved' })
    expect(await ui.find({ type: 'Text', text: /^TTL rule for cold caches$/ })).toBeDefined()
    expect((await ui.find({ type: 'Markdown', text: /TTL/ }))?.props.text).toBe('Keep the TTL under one minute.\nWhy: cold caches.')
    expect(await ui.find({ type: 'Text', text: /^Created Oct 9, 2025, 08:53$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Edited / })).toBeUndefined()
    expect((await ui.find({ key: 'open-in-web' }))?.text).toBe('Open in web')
    expect(await ui.find({ key: 'fmt-bold' })).toBeUndefined()
    expect(await ui.find({ key: 'save' })).toBeUndefined()
    expect(await ui.find({ key: 'editor' })).toBeUndefined()
    expect(await ui.find({ key: 'type' })).toBeUndefined()
    // Behind ⋯: Archive and Delete only; no type picker (Edit has one), no tags, no notebook picker, no source.
    await ui.press({ key: 'page-more' })
    expect(await ui.find({ key: 'archive' })).toBeDefined()
    expect(await ui.find({ key: 'delete' })).toBeDefined()
    expect(await ui.find({ key: 'type' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Type$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /#caching/ })).toBeUndefined()
    expect(await ui.find({ key: 'folder' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Source$/ })).toBeUndefined()
    expect(firstEntry(data)).toMatchObject({ type: 'insight' })
    // Open in web opens the note's file in the web notebook.
    await ui.press({ key: 'open-in-web' })
    expect(engine.commands.at(-1)).toEqual(['open', `http://127.0.0.1:4321/#/${encodeURIComponent(String(stored.file))}`])
    expect(await ui.find({ type: 'Text', text: /^Opened in your browser$/ })).toBeUndefined()
    await ui.press({ key: 'home-icon' })
    expect(await ui.find({ key: 'nb:General' })).toBeDefined()
    // Collapsing a notebook hides its rows; an empty one starts collapsed.
    expect((await ui.find({ key: 'nb:General' }))?.text).toBe('›')
    await ui.press({ key: 'nb:Caching' })
    expect((await ui.find({ key: 'nb:Caching' }))?.text).toBe('›')
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
    expect((await again.find({ key: `entry:${id}` }))?.text).toBe('TTL rule for cold caches')
    // Already titled by the model: the restart asks for no title.
    await clock.advance(5)
    expect(engine.prompts.filter(prompt => prompt.includes('title: <the title>'))).toHaveLength(1)
    await again.unmount()

    // Every write to the shared store held the lock other sessions take, and gave back the token it took.
    const takes = engine.locks.filter(args => args[0] === 'take')
    expect(takes.length).toBeGreaterThan(0)
    expect(takes.every(args => args[1] === `${HOME}/.claude/live-notebook/.store-lock`)).toBe(true)
    expect(engine.locks.filter(args => args[0] === 'give').map(args => args[3])).toEqual(takes.map(args => args[2]))
    // Each write was preceded by a renewal of the lock it was made under.
    expect(engine.locks.filter(args => args[0] === 'renew').length).toBeGreaterThan(0)
  })

  test('edits made on the web come back: a changed file, a new note, a new notebook, a deleted note', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    const fs = fakeFs(on)
    const engine = fakeEngine(on)
    const clock = mock.clock(on, { now: 100 })
    await $.session.start(START)
    const path = `${NOTES}/Ops/blue-green-deploy--e-1.md`
    expect(fs.read(path)).toContain('Switch traffic only after health checks pass.')
    expect(fs.read(path)).toContain('type: learning')
    expect(data.get('entry:e-1')).toMatchObject({ file: 'Ops/blue-green-deploy--e-1.md' })

    await clock.advance(3_000)
    expect(data.get('entry:e-1')).toMatchObject({ content: 'Switch traffic only after health checks pass.' })

    fs.writeFromWeb(path, '---\nid: e-1\ntitle: "Blue/green, revised"\nfolder: "Ops"\ntype: reference\n---\n\nSwitch traffic after health checks. Then watch error rates.\n')
    fs.writeFromWeb(
      `${NOTES}/Ideas/try-canaries--abcd1234.md`,
      '---\nid: abcd1234-0000-0000-0000-000000000000\ntitle: "Try canaries"\ncreated: 2026-01-01T00:00:00.000Z\n---\n\nRoll out to 5% first.\n',
    )
    await clock.advance(3_000)

    expect(data.get('entry:e-1')).toMatchObject({
      title: 'Blue/green, revised',
      content: 'Switch traffic after health checks. Then watch error rates.',
      type: 'reference',
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
    // A note made on the web is kept from the model by default: its text may never have been in a conversation.
    await clock.advance(5)
    expect(engine.prompts.filter(prompt => prompt.startsWith('Classify'))).toHaveLength(0)
    expect(data.get('entry:abcd1234-0000-0000-0000-000000000000')).toMatchObject({ type: 'other' })
    // With `"ai": "all"` in settings.json, its next edit gets a type from the model, as a save in the pane would.
    fs.writeFromWeb(`${ROOT}/settings.json`, JSON.stringify({ ai: 'all' }))
    fs.writeFromWeb(
      `${NOTES}/Ideas/try-canaries--abcd1234.md`,
      '---\nid: abcd1234-0000-0000-0000-000000000000\ntitle: "Try canaries"\ncreated: 2026-01-01T00:00:00.000Z\n---\n\nRoll out to 5% of hosts first.\n',
    )
    await clock.advance(3_000)
    await clock.advance(5)
    expect(engine.prompts.filter(prompt => prompt.startsWith('Classify'))).toHaveLength(1)
    expect(data.get('entry:abcd1234-0000-0000-0000-000000000000')).toMatchObject({ type: 'insight', tags: ['caching', 'ttl'] })
    expect(fs.read(`${NOTES}/Ideas/try-canaries--abcd1234.md`)).toContain('type: insight')
    expect(data.get('entry:e-1')).toMatchObject({ type: 'reference' })

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ key: 'nb:Ideas' })).toBeDefined()
    expect(await ui.find({ key: 'entry:e-1' })).toBeDefined()
    expect(await ui.find({ key: 'entry:abcd1234-0000-0000-0000-000000000000' })).toBeDefined()
    await ui.press({ key: 'filter:reference' })
    expect(await ui.find({ key: 'entry:e-1' })).toBeDefined()
    expect(await ui.find({ key: 'entry:abcd1234-0000-0000-0000-000000000000' })).toBeUndefined()
    await ui.press({ key: 'filter:all' })

    // The note's page shows the web's text; the original snapshot is not shown.
    await ui.press({ key: 'entry:e-1' })
    expect(await ui.find({ type: 'Text', text: /^Blue\/green, revised$/ })).toBeDefined()
    expect((await ui.find({ type: 'Markdown', text: /health checks/ }))?.props.text).toBe('Switch traffic after health checks. Then watch error rates.')
    await ui.press({ key: 'page-more' })
    expect(await ui.find({ key: 'snapshot' })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown', text: /only after health checks pass/ })).toBeUndefined()
    await ui.press({ key: 'open-in-web' })
    expect(engine.commands.at(-1)).toEqual(['open', `http://127.0.0.1:4321/#/${encodeURIComponent('Ops/blue-green-deploy--e-1.md')}`])
    await ui.press({ key: 'home-icon' })
    expect(await ui.find({ key: 'entry:e-1' })).toBeDefined()

    // Deleted on the web: the file is marked archived, so the entry is archived.
    fs.writeFromWeb(`${NOTES}/Ops/blue-green-deploy--e-1.md`, '---\nid: e-1\narchived: true\n---\n\nwhatever\n')
    await clock.advance(3_000)
    expect(data.get('entry:e-1')).toMatchObject({ status: 'archived' })
    expect(await ui.find({ key: 'entry:e-1' })).toBeUndefined()

    // A notebook pinned on the web keeps its flag when the mod writes the tags; one archived there, its notes
    // marked archived too, leaves the pane and the folder list.
    fs.writeFromWeb(`${NOTES}/Ideas/_notebook.json`, JSON.stringify({ name: 'Ideas', tags: ['canaries'], pinned: true }))
    fs.writeFromWeb(`${NOTES}/Ideas/try-canaries--abcd1234.md`, '---\nid: abcd1234-0000-0000-0000-000000000000\ntitle: "Try canaries"\n---\n\nRoll out to 5% first. Then 20%.\n')
    await clock.advance(3_000)
    expect(data.get('entry:abcd1234-0000-0000-0000-000000000000')).toMatchObject({ content: 'Roll out to 5% first. Then 20%.' })
    expect(JSON.parse(fs.read(`${NOTES}/Ideas/_notebook.json`) ?? '{}')).toMatchObject({ name: 'Ideas', pinned: true })
    fs.writeFromWeb(`${NOTES}/Ideas/_notebook.json`, JSON.stringify({ name: 'Ideas', pinned: true, archived: true }))
    fs.writeFromWeb(`${NOTES}/Ideas/try-canaries--abcd1234.md`, '---\nid: abcd1234-0000-0000-0000-000000000000\narchived: true\n---\n\nRoll out to 5% first. Then 20%.\n')
    await clock.advance(3_000)
    expect(data.get('entry:abcd1234-0000-0000-0000-000000000000')).toMatchObject({ status: 'archived' })
    expect(data.get('folders')).toEqual({ names: ['General', 'Ops'], last: 'Ops' })
    expect(await ui.find({ key: 'nb:Ideas' })).toBeUndefined()
    await ui.unmount()
  })

  test('the web notebook starts with the session; /notebook web opens the browser; Write note in web opens a new note there', async ($, on) => {
    const data = fakeStore(on)
    const fs = fakeFs(on)
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
    expect(engine.commands.at(-1)).toEqual(['open', 'http://127.0.0.1:4321'])

    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    // No Open in browser button on the home page: /notebook web and Open in web on a note do that.
    expect(await ui.find({ key: 'web' })).toBeUndefined()
    expect(await ui.find({ key: 'web-stop' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /web notebook (running|off)/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /127\.0\.0\.1/ })).toBeUndefined()
    expect(engine.commands.filter(argv => argv[0] === 'open')).toHaveLength(1)
    expect(await ui.find({ key: 'more' })).toBeUndefined()
    expect((await ui.find({ key: 'new-notebook-start' }))?.text).toBe('+ New Notebook')
    expect(await ui.find({ key: 'new-notebook' })).toBeUndefined()
    await ui.press({ key: 'new-notebook-start' })
    await ui.input({ key: 'new-notebook', text: 'Work' })
    expect(await ui.find({ key: 'new-notebook' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /created/ })).toBeUndefined()
    expect(data.get('folders')).toMatchObject({ last: 'Work' })

    // Write note in web: an empty file in the last-used notebook, opened in the browser to write.
    await ui.press({ key: 'new-note' })
    const made = [...fs.files.keys()].filter(path => /\/Work\/untitled--[0-9a-f]{8}\.md$/.test(path))
    expect(made).toHaveLength(1)
    const blank = fs.read(made[0] ?? '') ?? ''
    expect(blank).toContain('title: "Untitled"')
    expect(blank).toContain('folder: "Work"')
    expect(engine.commands.at(-1)).toEqual(['open', `http://127.0.0.1:4321/#/${encodeURIComponent((made[0] ?? '').slice(NOTES.length + 1))}`])
    expect(await ui.find({ key: 'editor' })).toBeUndefined()
    // Empty, it is not a note yet; the import makes it one once the web writes text into it.
    fs.writeFromWeb(`${NOTES}/General/other.md`, 'x')
    await clock.advance(3_000)
    expect(entryKeys(data)).toHaveLength(1)
    expect(firstEntry(data)).toMatchObject({ content: 'x' })
    await ui.unmount()
  })

  test('a pane edit saves only what it changed, and never writes over text changed elsewhere meanwhile', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    fakeFs(on)
    fakeEngine(on)
    mock.clock(on, { now: 500 })
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    await ui.press({ key: 'entry:e-1' })
    await ui.press({ key: 'edit' })
    // Another session saves new text while this editor is open; here only the type changes.
    data.set('entry:e-1', { ...(data.get('entry:e-1') as object), content: 'Text saved in another session.' })
    await ui.select({ key: 'edit-type', value: 'reference' })
    await ui.press({ key: 'save-edit' })
    expect(data.get('entry:e-1')).toMatchObject({ content: 'Text saved in another session.', type: 'reference' })

    // Both sides change the text: the save is refused and says so; a second Save replaces the other text.
    await ui.press({ key: 'edit' })
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Text saved in another session.')
    await ui.key({ key: 'end', in: 'editor' })
    await typeInto(ui, 'editor', ' Mine.')
    data.set('entry:e-1', { ...(data.get('entry:e-1') as object), content: 'Theirs, newer.' })
    await ui.press({ key: 'save-edit' })
    expect(data.get('entry:e-1')).toMatchObject({ content: 'Theirs, newer.' })
    expect(await ui.find({ type: 'Text', text: /changed somewhere else since you opened it/ })).toBeDefined()
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Text saved in another session. Mine.')
    await ui.press({ key: 'save-edit' })
    expect(data.get('entry:e-1')).toMatchObject({ content: 'Text saved in another session. Mine.' })
    await ui.unmount()
  })

  test('a write from Claude Code takes in a web edit not yet imported instead of writing over it', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    const fs = fakeFs(on)
    fakeEngine(on)
    mock.clock(on, { now: 500 })
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    const file = `${NOTES}/Ops/blue-green-deploy--e-1.md`
    // One save from the pane writes the file, so this session knows it.
    await ui.press({ key: 'entry:e-1' })
    await ui.press({ key: 'edit' })
    await ui.select({ key: 'edit-type', value: 'reference' })
    await ui.press({ key: 'save-edit' })
    expect(fs.read(file)).toContain('type: reference')
    // The web page saves new text; before the next import, a pane save changes the type again.
    fs.writeFromWeb(file, (fs.read(file) ?? '').replace('Switch traffic only after health checks pass.', 'Typed on the web page.'))
    await ui.press({ key: 'edit' })
    await ui.select({ key: 'edit-type', value: 'insight' })
    await ui.press({ key: 'save-edit' })
    expect(fs.read(file)).toContain('Typed on the web page.')
    expect(fs.read(file)).toContain('type: insight')
    expect(data.get('entry:e-1')).toMatchObject({ content: 'Typed on the web page.', type: 'insight' })
    await ui.unmount()
  })

  test('a note deleted in another session is no import error here', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    const fs = fakeFs(on)
    fakeEngine(on)
    const clock = mock.clock(on, { now: 500 })
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    await ui.press({ key: 'entry:e-1' })
    await ui.press({ key: 'edit' })
    await ui.select({ key: 'edit-type', value: 'reference' })
    await ui.press({ key: 'save-edit' })
    // Another session deletes the note: its entry and its file go. Then the web touches the folder.
    data.delete('entry:e-1')
    fs.files.delete(`${NOTES}/Ops/blue-green-deploy--e-1.md`)
    fs.writeFromWeb(`${NOTES}/Ops/_notebook.json`, JSON.stringify({ name: 'Ops' }))
    await clock.advance(3_000)
    expect(await ui.find({ type: 'Text', text: /could not be imported/ })).toBeUndefined()
    expect(data.has('entry:e-1')).toBe(false)
    await ui.unmount()
  })

  test('a note file written by hand gets an id when it is imported, so every session matches it', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' } })
    const fs = fakeFs(on, { [`${NOTES}/Ops/hand.md`]: 'Written by hand.\n' })
    fakeEngine(on)
    mock.clock(on, { now: 500 })
    await $.session.start(START)
    expect(entryKeys(data)).toHaveLength(1)
    const id = (firstEntry(data) as { id: string }).id
    expect(fs.read(`${NOTES}/Ops/hand.md`)).toContain(`id: ${id}`)
    expect(fs.read(`${NOTES}/Ops/hand.md`)).toContain('Written by hand.')
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
    expect((await ui.find({ type: 'Button', key: 'draft-title' }))?.text).toBe('Will not persist.')
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Will not persist.')
    expect((await ui.find({ key: 'save' }))?.text).toBe('Save')
    expect(entryKeys(data)).toEqual([])
    await ui.unmount()
  })

  test('a save while another session holds the store keeps the draft and writes nothing', async ($, on) => {
    const data = fakeStore(on)
    fakeFs(on)
    const engine = fakeEngine(on, [], { lockTakeExit: 3 })
    const clock = mock.clock(on)
    await $.session.start(START)
    await $.command.run({ ...RUN, command: 'save', args: 'Wait for the other session.' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    const pressing = ui.press({ key: 'save' })
    // The lock is tried every 50 ms for 3 s, then the save is refused.
    for (let step = 0; step < 80; step++) await clock.advance(50)
    await pressing
    expect(await ui.find({ type: 'Text', text: /Another Claude Code session is saving/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /draft is still here/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Saved / })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'draft-title' }))?.text).toBe('Wait for the other session.')
    expect(entryKeys(data)).toEqual([])
    expect(engine.locks.filter(args => args[0] === 'take').length).toBeGreaterThan(10)
    expect(engine.locks.filter(args => args[0] === 'give')).toEqual([])
    await ui.unmount()
  })

  test('/save with no text and no selection opens no pane and says what to do instead', async ($, on) => {
    const data = fakeStore(on)
    fakeFs(on)
    const engine = fakeEngine(on, [
      { role: 'user', text: 'How do I invalidate the cache?', toolUses: [] },
      { role: 'assistant', text: 'Set the TTL to 60 seconds.', toolUses: [] },
    ])
    mock.clock(on, { now: 42 })
    await $.session.start(START)
    const ran = await $.command.run({ ...RUN, command: 'save', args: '' })
    expect(ran.text).toContain('Select text in the conversation, or type /save followed by the text')
    expect(ran.text).toContain('Save to notebook control')
    expect(engine.opened).toEqual([])
    expect(entryKeys(data)).toHaveLength(0)
    // The pane, opened by hand, is on its home page: no list of messages to pick from.
    await $.command.run({ ...RUN, command: 'notebook', args: '' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /Save which message/ })).toBeUndefined()
    expect(await ui.find({ key: 'pick:1' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^No notes yet$/ })).toBeDefined()
    // The toolbar's Write Note in Web is the only one: the empty state does not repeat it.
    expect(await ui.find({ key: 'new-note' })).toBeDefined()
    expect(await ui.find({ key: 'new-note-empty' })).toBeUndefined()
    expect(await ui.find({ key: 'capture' })).toBeUndefined()
    await ui.unmount()
  })

  test('notes saved from the chat earlier get a model title once; a title of the person\'s own, or a note made on the web, keeps its own', async ($, on) => {
    const fromChat = { ...seeded, id: 'e-2', title: 'Switch traffic only after health checks pass.', type: 'reference', sources: [{ ...seeded.sources[0], sessionId: 's-old' }] }
    const named = { ...fromChat, id: 'e-3', title: 'My own name' }
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded, 'entry:e-2': fromChat, 'entry:e-3': named })
    fakeFs(on)
    const engine = fakeEngine(on)
    const clock = mock.clock(on)
    await $.session.start(START)
    await clock.advance(5)
    expect(data.get('entry:e-2')).toMatchObject({ title: 'TTL rule for cold caches', type: 'reference' })
    expect(data.get('entry:e-3')).toMatchObject({ title: 'My own name' })
    expect(data.get('entry:e-1')).toMatchObject({ title: 'Blue/green deploy' })
    expect(engine.prompts.filter(prompt => prompt.includes('title: <the title>'))).toHaveLength(1)
    // The next session finds it titled and asks again for nothing.
    await $.session.start(START)
    await clock.advance(5)
    expect(engine.prompts.filter(prompt => prompt.includes('title: <the title>'))).toHaveLength(1)
  })

  test('a narrow pane stacks its controls and a wide one keeps the list beside an open note', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    const fs = fakeFs(on, { '/usr/bin/osascript': '' })
    const engine = fakeEngine(on)
    mock.clock(on, { now: 1_761_200_000_000 })
    await $.session.start(START)
    expect(data.get('entry:e-1')).toBeDefined()
    const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 40 } })
    expect(await narrow.find({ key: 'new-note' })).toBeDefined()
    expect((await narrow.find({ key: 'new-note' }))?.text).toBe('✎ Write Note in Web')
    // The filters never wrap: at 40 columns the full labels (53) and the short ones (41) do not fit, so the marks alone.
    expect((await narrow.find({ key: 'filter:all' }))?.text).toBe('All')
    expect((await narrow.find({ key: 'filter:reference' }))?.text).toBe('▤')
    expect(await narrow.find({ type: 'Text', text: /^▤$/ })).toBeUndefined()
    expect(hoverOf(await narrow.drawn(), 'filter:reference')).toEqual({ underline: true })
    await narrow.unmount()
    // At 48 columns the short labels fit; at 80 the full ones.
    const short = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 48 } })
    expect((await short.find({ key: 'filter:reference' }))?.text).toBe('Refs')
    expect((await short.find({ type: 'Text', text: /^▤$/ }))?.props).toMatchObject({ color: 'claude' })
    await short.unmount()
    const full = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 80 } })
    expect((await full.find({ key: 'filter:reference' }))?.text).toBe('References')
    await full.unmount()
    const again = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 40 } })
    await again.press({ key: 'entry:e-1' })
    expect(await again.find({ type: 'Text', text: /^Blue\/green deploy$/ })).toBeDefined()
    expect(await again.find({ key: 'open-in-web' })).toBeDefined()
    expect(await again.find({ key: 'new-note' })).toBeUndefined()
    await again.unmount()
    // A terminal of 110 columns cannot give the home column the full filter row and the note a page of 56: the
    // note stands alone.
    const mid = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 110 } })
    expect(await mid.find({ key: 'new-note' })).toBeUndefined()
    expect(await mid.find({ key: 'filter:all' })).toBeUndefined()
    await mid.unmount()
    // A wide terminal keeps the list beside the note still open; its row, the accent colour's text, is marked by the ▌ glyph.
    const tall = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 140 } })
    expect((await tall.find({ key: 'filter:reference' }))?.text).toBe('References')
    expect(await tall.find({ key: 'entry:e-1' })).toBeUndefined()
    expect((await tall.find({ type: 'Text', text: /^▌$/ }))?.props).toMatchObject({ color: 'claude' })
    expect(await tall.find({ key: 'bar:e-1' })).toBeUndefined()
    await tall.unmount()
    // A desktop's font needs a wider column for the filters (69 cells, 73 with the border): at 120 cells the note
    // stands alone; at 140 the home page is beside it, with the full labels on one line.
    const desk = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 120 } })
    expect(await desk.find({ key: 'new-note' })).toBeUndefined()
    await desk.unmount()
    const wide = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 140 } })
    expect((await wide.find({ key: 'filter:reference' }))?.text).toBe('References')
    // Wide: the whole home page beside the note; the open note's row is marked by its bar and background.
    expect(await wide.find({ key: 'new-note' })).toBeDefined()
    expect(await wide.find({ key: 'web' })).toBeUndefined()
    // On a desktop the search field is the mod's own one-row editor, so no Enter button is drawn beside it; typing
    // into it filters the list, and the × beside it clears the query and the editor with it.
    expect((await wide.find({ key: 'search' }))?.type).toBe('Client')
    for (const ch of 'blue') await wide.key({ key: ch, in: 'search' })
    expect(await wide.find({ type: 'Text', text: /^1 note$/ })).toBeDefined()
    await wide.key({ key: 'x', in: 'search' })
    expect(await wide.find({ type: 'Text', text: /No notes match "bluex"/ })).toBeDefined()
    await wide.press({ key: 'clear' })
    expect(await wide.find({ type: 'Text', text: /No notes match/ })).toBeUndefined()
    expect(editorText(await wide.drawn({ in: 'search' }))).toContain('Search notes…')
    expect(await wide.find({ key: 'filter:all' })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: /^Ops$/ })).toBeDefined()
    expect(await wide.find({ key: 'row:e-1' })).toBeDefined()
    // On a desktop the open note's row stays a button (its native button sets every title at one distance from the mark) and takes a background.
    expect(await wide.find({ key: 'entry:e-1' })).toBeDefined()
    expect((await wide.find({ key: 'row:e-1' }))?.props).toMatchObject({ backgroundColor: '#e4e4e0' })
    // Its bar is a box in the accent colour stretched to the row's height (the native button makes the row
    // taller than a line), not the terminal's one-line glyph; the other rows' bars are empty.
    expect((await wide.find({ key: 'row:e-1' }))?.props).toMatchObject({ alignItems: 'stretch' })
    expect((await wide.find({ key: 'bar:e-1' }))?.props).toMatchObject({ backgroundColor: '#D97757', width: 1 })
    expect(await wide.find({ type: 'Text', text: /^▌$/ })).toBeUndefined()
    // On a desktop too the active filter's label is text in the accent colour (not bold: its width stays), padded where the
    // plain button's own padding was; the others are dim buttons underlining under the pointer.
    expect(await wide.find({ key: 'filter:all' })).toMatchObject({ type: 'Box', props: { paddingX: 0.65 } })
    expect((await wide.find({ type: 'Text', text: /^All notes$/ }))?.props).toMatchObject({ bold: false, underline: true, color: 'claude' })
    expect((await wide.find({ key: 'filter:insight' }))?.props).toMatchObject({ plain: true, dimColor: true, label: 'Insights' })
    expect((await wide.find({ key: 'filter:learning' }))?.text).toBe('Learnings')
    expect(hoverOf(await wide.drawn(), 'filter:learning')).toEqual({ underline: true })
    expect((await wide.find({ key: 'filter:other' }))?.text).toBe('Other')
    expect(hoverOf(await wide.drawn(), 'filter:all')).toBeUndefined()
    // Every filter's mark is in the accent colour whether or not it is active.
    expect((await wide.find({ type: 'Text', text: /^◉$/ }))?.props).toMatchObject({ color: 'claude' })
    // + New Notebook beside the open note opens its name field alone: the note's ⋯ menu stays closed, and ⋯ opens
    // that menu without the field.
    expect(await wide.find({ key: 'new-notebook' })).toBeUndefined()
    expect(await wide.find({ key: 'archive' })).toBeUndefined()
    await wide.press({ key: 'new-notebook-start' })
    expect(await wide.find({ key: 'new-notebook' })).toBeDefined()
    expect(await wide.find({ key: 'archive' })).toBeUndefined()
    expect(await wide.find({ key: 'delete' })).toBeUndefined()
    await wide.press({ key: 'new-notebook-start' })
    await wide.press({ key: 'page-more' })
    expect(await wide.find({ key: 'archive' })).toBeDefined()
    expect(await wide.find({ key: 'new-notebook' })).toBeUndefined()
    await wide.press({ key: 'page-more' })
    expect(await wide.find({ key: 'archive' })).toBeUndefined()
    expect((await wide.find({ type: 'Text', text: /^◉$/ }))?.props.dimColor).toBeUndefined()
    await wide.press({ key: 'filter:insight' })
    expect((await wide.find({ type: 'Text', text: /^◉$/ }))?.props.color).toBe('claude')
    expect((await wide.find({ type: 'Text', text: /^Insights$/ }))?.props).toMatchObject({ bold: false, underline: true, color: 'claude' })
    expect((await wide.find({ key: 'filter:all' }))?.props).toMatchObject({ dimColor: true, label: 'All notes' })
    await wide.press({ key: 'filter:all' })
    // On a desktop the row has no border at rest (an unknown colour draws black there); it greys under the pointer.
    // The native title button lights under the pointer by itself: the row adds no second highlight.
    expect(hoverOf(await wide.drawn(), 'row:e-1')).toBeUndefined()
    expect((await wide.find({ key: 'row:e-1' }))?.props).toMatchObject({ paddingX: 1 })
    expect((await wide.find({ key: 'row:e-1' }))?.props.borderStyle).toBeUndefined()
    expect((await wide.find({ type: 'Markdown', text: /health checks/ }))?.props.text).toBe('Switch traffic only after health checks pass.')
    expect(await wide.find({ key: 'open-in-web' })).toBeDefined()
    expect(await wide.find({ key: 'fmt-h1' })).toBeUndefined()
    await wide.press({ key: 'home-icon' })
    expect(await wide.find({ type: 'Text', text: /kept$/ })).toBeUndefined()
    expect(await wide.find({ key: 'entry:e-1' })).toBeDefined()
    // Export, on a notebook's header row, asks where in the Save dialog, writes the notebook there as one markdown file and names it; Copy path copies the path.
    expect(await wide.find({ key: 'export:General' })).toBeUndefined()
    engine.dialog.savePath = `${HOME}/Downloads/ops-notes.md`
    await wide.press({ key: 'export:Ops' })
    expect(engine.commands.find(argv => argv[0] === '/usr/bin/osascript')?.[2]).toContain('choose file name with prompt "Export Ops as markdown (.md) or plain text (.txt)" default name "ops.md"')
    const exported = fs.read(`${HOME}/Downloads/ops-notes.md`) ?? ''
    expect(exported.startsWith('# Ops\n\n_Exported from Live Notebook on 2025-10-23 · 1 note_\n\n---\n\n## Blue/green deploy\n\n_learning · created 1970-01-01_\n\nSwitch traffic only after health checks pass.\n')).toBe(true)
    expect(await wide.find({ type: 'Text', text: new RegExp(`^Exported Ops to ${HOME}/Downloads/ops-notes.md$`) })).toBeDefined()
    await wide.press({ key: 'copy-notice' })
    expect(engine.copied).toEqual([`${HOME}/Downloads/ops-notes.md`])
    await wide.press({ key: 'dismiss-notice' })
    expect(await wide.find({ key: 'copy-notice' })).toBeUndefined()
    // Cancel writes nothing and says nothing.
    engine.dialog.savePath = null
    const filesBefore = fs.files.size
    await wide.press({ key: 'export:Ops' })
    expect(fs.files.size).toBe(filesBefore)
    expect(await wide.find({ key: 'copy-notice' })).toBeUndefined()
    // Without osascript (another OS) there is no dialog: the file goes under the notes root.
    fs.files.delete('/usr/bin/osascript')
    await wide.press({ key: 'export:Ops' })
    expect(fs.read(`${ROOT}/exports/ops.md`)).toBe(exported)
    expect(await wide.find({ type: 'Text', text: new RegExp(`^Exported Ops to ${ROOT}/exports/ops.md$`) })).toBeDefined()
    await wide.unmount()
  })


  test('a desktop pane greys its rows to the Mac appearance, not the terminal theme', async ($, on) => {
    fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    fakeFs(on, { '/usr/bin/defaults': '' })
    const engine = fakeEngine(on)
    mock.clock(on, { now: 1_761_200_000_000 })
    // The engine's theme row is dark (its default, the terminal's own) while the Mac is in the light appearance.
    engine.host.theme = 'dark'
    // The desktop app starts the engine through the SDK, which reports no surface at session start.
    await $.session.start({ ...START, surface: null })
    expect(engine.commands).toContainEqual(['/usr/bin/defaults', 'read', '-g', 'AppleInterfaceStyle'])
    const light = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 140 } })
    // The open note's row and the search icon take the light appearance's colours; rows have no hover of their own on a desktop.
    expect(hoverOf(await light.drawn(), 'row:e-1')).toBeUndefined()
    expect((await light.find({ type: 'Svg' }))?.props.source).toContain('#7a7a74')
    await light.press({ key: 'entry:e-1' })
    expect((await light.find({ key: 'row:e-1' }))?.props).toMatchObject({ backgroundColor: '#e4e4e0' })
    await light.unmount()
    // The dark appearance, read at the next session's start, colours them dark.
    engine.host.appearance = 'Dark'
    await $.session.start({ ...START, surface: null })
    const dark = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: { ...PANE_PROPS, bodyColumns: 140 } })
    expect((await dark.find({ type: 'Svg' }))?.props.source).toContain('#9a9a93')
    await dark.press({ key: 'entry:e-1' })
    expect((await dark.find({ key: 'row:e-1' }))?.props).toMatchObject({ backgroundColor: '#32322f' })
  })
  test('a new note takes a title typed on its capture page, and the model does not replace it', async ($, on) => {
    const data = fakeStore(on)
    fakeFs(on)
    const engine = fakeEngine(on)
    const clock = mock.clock(on, { now: 1_760_000_000_000 })
    await $.session.start(START)
    await $.command.run({ ...RUN, command: 'save', args: 'Keep the TTL under one minute.' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      // The breadcrumb's title is a control: pressed, the mod's own one-row editor takes its place across the row,
      // no box and no Title row, empty, with the automatic title as its placeholder; left empty, the note is titled
      // for the person. Enter puts the title back.
      expect((await ui.find({ type: 'Button', key: 'draft-title' }))?.text).toBe('Keep the TTL under one minute.')
      expect(await ui.find({ type: 'Text', text: /^Title$/ })).toBeUndefined()
      expect(await ui.find({ key: 'title-editor' })).toBeUndefined()
      await ui.press({ key: 'draft-title' })
      expect(await ui.find({ type: 'Button', key: 'draft-title' })).toBeUndefined()
      expect(await ui.find({ type: 'Input', key: 'draft-title' })).toBeUndefined()
      expect((await ui.find({ key: 'title-editor' }))?.props).toMatchObject({ props: { text: '', placeholder: 'Keep the TTL under one minute.', rows: 1, singleLine: true } })
      expect(await ui.find({ type: 'Text', text: /^Keep the TTL under one minute\.$/, in: 'title-editor' })).toBeDefined()
      await ui.key({ key: 'return', in: 'title-editor' })
      expect(await ui.find({ key: 'title-editor' })).toBeUndefined()
      expect((await ui.find({ type: 'Button', key: 'draft-title' }))?.text).toBe('Keep the TTL under one minute.')
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    await ui.press({ key: 'draft-title' })
    await typeInto(ui, 'title-editor', 'Cache TTL')
    expect(editorText(await ui.drawn({ in: 'title-editor' }))).toBe('Cache TTL')
    await ui.key({ key: 'return', in: 'title-editor' })
    expect(await ui.find({ key: 'title-editor' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'draft-title' }))?.text).toBe('Cache TTL')
    // A type picked beside the title is kept too; back on Other, the model picks one.
    await ui.select({ key: 'draft-type', value: 'reference' })
    expect((await ui.find({ key: 'draft-type' }))?.props.value).toBe('reference')
    await ui.select({ key: 'draft-type', value: 'other' })
    expect((await ui.find({ key: 'draft-type' }))?.props.value).toBe('other')
    await ui.select({ key: 'draft-type', value: 'reference' })
    await ui.press({ key: 'save' })
    expect(firstEntry(data)).toMatchObject({ title: 'Cache TTL', content: 'Keep the TTL under one minute.', type: 'reference' })
    expect(engine.toasts).toEqual(['Saved to General: Cache TTL'])
    // The model is not asked: the note has its title and its type.
    await clock.advance(5)
    expect(engine.prompts.find(prompt => prompt.startsWith('Classify'))).toBeUndefined()
    expect(firstEntry(data)).toMatchObject({ title: 'Cache TTL', type: 'reference' })
    await ui.unmount()
  })
  test('Edit, left of Open in web, edits a saved note in the pane; Save writes it, Discard drops it, the home icon keeps it', async ($, on) => {
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, 'entry:e-1': seeded })
    const fs = fakeFs(on)
    const engine = fakeEngine(on)
    const clock = mock.clock(on, { now: 500 })
    await $.session.start(START)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    await ui.press({ key: 'entry:e-1' })
    expect((await ui.find({ key: 'edit' }))?.text).toBe('Edit')
    // Not yet edited: only when it was created shows under the text.
    expect(await ui.find({ type: 'Text', text: /^Created Jan 1, 1970, 00:00$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Edited / })).toBeUndefined()
    expect(await ui.find({ key: 'editor' })).toBeUndefined()
    // Edit: the editor and toolbar with the note's text, Save in place of the two buttons.
    await ui.press({ key: 'edit' })
    expect(await ui.find({ key: 'fmt-bold' })).toBeDefined()
    expect(await ui.find({ key: 'open-in-web' })).toBeUndefined()
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Switch traffic only after health checks pass.')
    await ui.key({ key: 'end', in: 'editor' })
    for (const ch of ' Always.') await ui.key({ key: ch, in: 'editor' })
    // The home icon keeps the edit; Resume returns to it.
    await ui.press({ key: 'home-icon' })
    expect(await ui.find({ type: 'Text', text: /^Edit kept$/ })).toBeDefined()
    await ui.press({ key: 'resume-draft' })
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Switch traffic only after health checks pass. Always.')
    // Save: the note and its file change, and the note shows again, read-only, with when it was last edited under it.
    await clock.advance(60_000)
    await ui.press({ key: 'save-edit' })
    expect(data.get('entry:e-1')).toMatchObject({ content: 'Switch traffic only after health checks pass. Always.', title: 'Blue/green deploy' })
    expect(await ui.find({ type: 'Text', text: /^Created Jan 1, 1970, 00:00$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Edited Jan 1, 1970, 00:01$/ })).toBeDefined()
    expect(fs.read(`${NOTES}/Ops/blue-green-deploy--e-1.md`)).toContain('health checks pass. Always.')
    expect(await ui.find({ key: 'editor' })).toBeUndefined()
    expect((await ui.find({ type: 'Markdown', text: /Always/ }))?.props.text).toBe('Switch traffic only after health checks pass. Always.')
    expect(await ui.find({ key: 'edit' })).toBeDefined()
    // Discard, beside Save (the edit page has no ⋯ menu), drops an edit and shows the note as saved: the text and
    // the type picked beside the title both go back.
    await ui.press({ key: 'edit' })
    expect(await ui.find({ key: 'page-more' })).toBeUndefined()
    expect((await ui.find({ key: 'cancel-edit' }))?.text).toBe('Discard')
    await ui.key({ key: 'x', in: 'editor' })
    expect((await ui.find({ key: 'edit-type' }))?.props.value).toBe('learning')
    await ui.select({ key: 'edit-type', value: 'reference' })
    expect((await ui.find({ key: 'edit-type' }))?.props.value).toBe('reference')
    await ui.press({ key: 'cancel-edit' })
    expect(data.get('entry:e-1')).toMatchObject({ content: 'Switch traffic only after health checks pass. Always.', type: 'learning' })
    expect((await ui.find({ type: 'Markdown', text: /Always/ }))?.props.text).toBe('Switch traffic only after health checks pass. Always.')
    // A type picked on the edit page is saved with it, and a changed type alone is an edit kept.
    await ui.press({ key: 'edit' })
    await ui.select({ key: 'edit-type', value: 'reference' })
    await ui.press({ key: 'home-icon' })
    expect(await ui.find({ type: 'Text', text: /^Edit kept$/ })).toBeDefined()
    await ui.press({ key: 'resume-draft' })
    await ui.press({ key: 'save-edit' })
    expect(data.get('entry:e-1')).toMatchObject({ type: 'reference', content: 'Switch traffic only after health checks pass. Always.' })
    expect(fs.read(`${NOTES}/Ops/blue-green-deploy--e-1.md`)).toContain('type: reference')
    // The notebook picker beside the title moves the note when the edit is saved: the breadcrumb follows the pick,
    // and Save writes the file under the new notebook and removes the old one.
    await ui.press({ key: 'edit' })
    expect((await ui.find({ type: 'Button', key: 'edit-title' }))?.text).toBe('Blue/green deploy')
    expect(await ui.find({ key: 'folder-new' })).toBeUndefined()
    expect((await ui.find({ key: 'edit-folder' }))?.props.value).toBe('Ops')
    await ui.select({ key: 'edit-folder', value: 'General' })
    expect((await ui.find({ key: 'edit-folder' }))?.props.value).toBe('General')
    expect(await ui.find({ type: 'Text', text: /^General$/ })).toBeDefined()
    await ui.press({ key: 'save-edit' })
    expect(data.get('entry:e-1')).toMatchObject({ folder: 'General', file: 'General/blue-green-deploy--e-1.md' })
    expect(fs.read(`${NOTES}/General/blue-green-deploy--e-1.md`)).toContain('health checks pass. Always.')
    // Node removes the old file: `$.fs` cannot, and Windows has no `rm`.
    expect(engine.commands.at(-1)?.slice(0, 2)).toEqual(['node', '-e'])
    expect(engine.commands.at(-1)?.at(-1)).toBe(`${NOTES}/Ops/blue-green-deploy--e-1.md`)
    // The title is the breadcrumb itself: pressed, a field holding it; Enter puts the new title back, and a new
    // title alone is an edit kept.
    await ui.press({ key: 'edit' })
    await ui.press({ key: 'edit-title' })
    expect(await ui.find({ type: 'Input', key: 'edit-title' })).toBeUndefined()
    expect(editorText(await ui.drawn({ in: 'title-editor' }))).toBe('Blue/green deploy')
    // The cursor starts at the end; ⌘A, then typing, replaces the whole title.
    await ui.key({ key: 'a', meta: true, in: 'title-editor' })
    await typeInto(ui, 'title-editor', 'Deploy rule')
    expect(editorText(await ui.drawn({ in: 'title-editor' }))).toBe('Deploy rule')
    await ui.key({ key: 'return', in: 'title-editor' })
    expect(await ui.find({ key: 'title-editor' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'edit-title' }))?.text).toBe('Deploy rule')
    await ui.press({ key: 'home-icon' })
    expect(await ui.find({ type: 'Text', text: /^Edit kept$/ })).toBeDefined()
    await ui.press({ key: 'resume-draft' })
    expect((await ui.find({ type: 'Button', key: 'edit-title' }))?.text).toBe('Deploy rule')
    // The preview starts folded away. Show preview, at the end of the formatting row, shows the text rendered under
    // the editor, following each keystroke; Hide preview folds it away again.
    expect((await ui.find({ key: 'preview' }))?.text).toBe('Show preview')
    expect(await ui.find({ key: 'preview-body' })).toBeUndefined()
    await ui.press({ key: 'preview' })
    expect((await ui.find({ key: 'preview' }))?.text).toBe('Hide preview')
    expect((await ui.find({ type: 'Markdown', text: /Always/ }))?.props.text).toBe('Switch traffic only after health checks pass. Always.')
    await ui.key({ key: 'end', in: 'editor' })
    await ui.key({ key: '!', in: 'editor' })
    expect((await ui.find({ type: 'Markdown', text: /Always/ }))?.props.text).toBe('Switch traffic only after health checks pass. Always.!')
    await ui.key({ key: 'backspace', in: 'editor' })
    await ui.press({ key: 'preview' })
    expect(await ui.find({ key: 'preview-body' })).toBeUndefined()
    expect(editorText(await ui.drawn({ in: 'editor' }))).toBe('Switch traffic only after health checks pass. Always.')
    // Save keeps the new title, as the person's own.
    await ui.press({ key: 'save-edit' })
    expect(data.get('entry:e-1')).toMatchObject({ title: 'Deploy rule', content: 'Switch traffic only after health checks pass. Always.' })
    // With nothing changed, the home icon keeps no edit.
    await ui.press({ key: 'edit' })
    await ui.press({ key: 'home-icon' })
    expect(await ui.find({ type: 'Text', text: /kept$/ })).toBeUndefined()
    await ui.unmount()
  })
  test('a long capture shows from its first line in the rows asked for, whatever size the surface reports; the toolbar, the wheel and ⌘C work in the editor', async ($, on) => {
    const long = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n')
    fakeStore(on)
    fakeFs(on)
    const engine = fakeEngine(on)
    mock.clock(on)
    // What reaches the pane's own window: the wheel ticks the editor hands on.
    const paneMoves: number[] = []
    on('ui.scroll', async (_$, e) => {
      paneMoves.push(e.by)
      return {}
    })
    const wheel = (by: number, column = 40) =>
      $.ui.scroll({
        component: 'Pane',
        requestId: PANE,
        offset: 0,
        by,
        bodyRows: 40,
        contentRows: 40,
        origin: { kind: 'person' },
        pointer: { column, row: 20 },
      })
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop'] as const) {
      await $.command.run({ ...RUN, command: 'save', args: long })
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
      paneMoves.length = 0
      // The region takes its height from the rows drawn: no fixed height a surface could read another way.
      expect((await ui.find({ key: 'editor' }))?.props.height).toBeUndefined()
      if (surface === 'terminal') {
        // The preview starts folded away: the editor takes the rows the pane has room for. Show preview, at the end of
        // the formatting row, shows the text rendered under the editor, which then takes half the rows; a wheel over
        // the preview is the pane's.
        expect(await ui.find({ key: 'preview-body' })).toBeUndefined()
        expect(editorLines(await ui.drawn({ in: 'editor' }))).toHaveLength(40 - 13)
        await ui.press({ key: 'preview' })
        expect((await ui.find({ key: 'preview' }))?.text).toBe('Hide preview')
        expect((await ui.find({ type: 'Markdown', text: /^Line 1\nLine 2/ }))?.props.text).toBe(long)
        expect(editorLines(await ui.drawn({ in: 'editor' }))).toHaveLength(11)
        await wheel(1)
        expect(paneMoves).toEqual([1])
        paneMoves.length = 0
        // Hide preview folds it away and becomes Show preview; the editor takes the rows back.
        await ui.press({ key: 'preview' })
        expect((await ui.find({ key: 'preview' }))?.text).toBe('Show preview')
        expect(await ui.find({ key: 'preview-body' })).toBeUndefined()
      }
      // A surface that reports a three-row region still gets the 27 rows the pane has room for; a desktop draws the
      // whole text, for the pane to scroll.
      await ui.resize({ columns: 60, rows: 3, in: 'editor' })
      let lines = editorLines(await ui.drawn({ in: 'editor' }))
      expect(lines).toHaveLength(surface === 'desktop' ? 60 : 40 - 13)
      expect(lines[0]).toBe('Line 1')
      expect(lines[26]).toBe('Line 27')
      // Heading 1 heads the cursor's line, the first, and the editor shows it.
      await ui.press({ key: 'fmt-h1' })
      lines = editorLines(await ui.drawn({ in: 'editor' }))
      expect(lines[0]).toBe('# Line 1')
      // ⌘Z takes it off again, and the toolbar's command is not applied a second time.
      await ui.key({ key: 'z', meta: true, in: 'editor' })
      expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('Line 1')
      await ui.redraw()
      expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('Line 1')
      if (surface === 'desktop') {
        // The desktop's wheel is the pane's, both ways; the last row is reached and edited there all the same.
        await wheel(1)
        await wheel(-1)
        expect(paneMoves).toEqual([1, -1])
        await ui.key({ key: 'pagedown', in: 'editor' })
        await ui.key({ key: 'x', in: 'editor' })
        expect(editorLines(await ui.drawn({ in: 'editor' }))[59]).toBe('xLine 60')
        await ui.key({ key: 'z', meta: true, in: 'editor' })
        await ui.key({ key: 'pageup', in: 'editor' })
      } else {
        // At the top, the wheel up is the pane's; down, it scrolls the text.
        await wheel(-1)
        expect(paneMoves).toEqual([-1])
        for (let i = 0; i < 10; i += 1) await wheel(1)
        expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('Line 11')
        expect(paneMoves).toEqual([-1])
        // Past the text's end the pane takes the wheel; back up, the text does.
        await wheel(40)
        expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('Line 34')
        await wheel(1)
        expect(paneMoves).toEqual([-1, 1])
        await wheel(-33)
        expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('Line 1')
      }
      // Shift+End selects the first line; ⌘C copies it through the hooks module, with no message.
      await ui.key({ key: 'end', shift: true, in: 'editor' })
      await ui.key({ key: 'c', meta: true, in: 'editor' })
      expect(engine.copied.at(-1)).toBe('Line 1')
      expect(await ui.find({ type: 'Text', text: /^Copied$/ })).toBeUndefined()
      await ui.press({ key: 'cancel' })
      await ui.unmount()
    }
  })

  test('a note file carries tags, role and project, its sidecar the snapshot; Delete trashes both; the folder alone rebuilds the note', async ($, on) => {
    const id = 'abcdef12-0000-0000-0000-000000000000'
    const fromChat = {
      ...seeded,
      id,
      sources: [
        {
          captureMode: 'whole_message',
          role: 'assistant',
          sessionId: 's-9',
          messageId: 'm-1',
          snapshot: 'Switch traffic only after health checks pass!',
          capturedAt: 5,
          // A capture by an earlier version: the messages around it and the full directory, which files never carry.
          context: { before: [{ role: 'user', text: 'my secret prompt' }], after: [], cwd: '/Users/x/work/shop' },
        },
      ],
    }
    const data = fakeStore(on, { meta: { schemaVersion: 1 }, folders: { names: ['General', 'Ops'], last: 'Ops' }, [`entry:${id}`]: fromChat })
    const fs = fakeFs(on)
    const engine = fakeEngine(on)
    mock.clock(on, { now: 100 })
    await $.session.start(START)
    const path = `${NOTES}/Ops/blue-green-deploy--abcdef12.md`
    const text = fs.read(path) ?? ''
    expect(text).toContain('tags: ["ops"]')
    expect(text).toContain('role: assistant')
    expect(text).toContain('session: s-9')
    expect(text).toContain('project: "shop"')
    expect(text).not.toContain('/Users/x')
    expect(text).not.toContain('secret')
    const sidecarPath = `${ROOT}/sources/${id}.json`
    expect(JSON.parse(fs.read(sidecarPath) ?? '{}')).toMatchObject({ id, snapshot: 'Switch traffic only after health checks pass!', messageId: 'm-1' })
    expect(data.get('filesFormat')).toBe(2)

    // Delete on the note's page: the file and the sidecar go to the trash, and node removes the originals.
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    await ui.press({ key: `entry:${id}` })
    await ui.press({ key: 'page-more' })
    await ui.press({ key: 'delete' })
    // Arming Delete redraws the page with its menu shut; the confirmation is behind ⋯ again.
    if ((await ui.find({ key: 'delete-confirm' })) === undefined) await ui.press({ key: 'page-more' })
    await ui.press({ key: 'delete-confirm' })
    expect(data.get(`entry:${id}`)).toBeUndefined()
    const trashed = [...fs.files.keys()].filter(one => one.startsWith(`${ROOT}/trash/Ops/blue-green-deploy--abcdef12--`))
    expect(trashed).toHaveLength(1)
    expect(fs.read(trashed[0] ?? '')).toBe(text)
    expect(fs.read(`${ROOT}/trash/sources/${id}.json`)).toBe(fs.read(sidecarPath))
    const removal = engine.commands.at(-1) ?? []
    expect(removal.slice(0, 2)).toEqual(['node', '-e'])
    expect(removal.slice(3)).toEqual([path, sidecarPath])
    await ui.unmount()
  })

  test('a fresh store rebuilds a captured note from its file and sidecar', async ($, on) => {
    const id = 'abcdef12-0000-0000-0000-000000000000'
    const data = fakeStore(on)
    fakeFs(on, {
      [`${NOTES}/Ops/blue-green-deploy--abcdef12.md`]: [
        '---',
        `id: ${id}`,
        'title: "Blue/green deploy"',
        'folder: "Ops"',
        'type: learning',
        'tags: ["ops", "deploys"]',
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-02T00:00:00.000Z',
        'captured: whole_message',
        'role: assistant',
        'session: s-9',
        'project: "shop"',
        '---',
        '',
        'Switch traffic only after health checks pass.',
        '',
      ].join('\n'),
      [`${ROOT}/sources/${id}.json`]: JSON.stringify({
        id,
        captureMode: 'whole_message',
        capturedAt: '2026-01-01T00:00:00.000Z',
        snapshot: 'Switch traffic only after health checks pass!',
        messageId: 'm-1',
      }),
    })
    const engine = fakeEngine(on)
    const clock = mock.clock(on, { now: 100 })
    await $.session.start(START)
    expect(data.get(`entry:${id}`)).toMatchObject({
      title: 'Blue/green deploy',
      folder: 'Ops',
      type: 'learning',
      tags: ['ops', 'deploys'],
      file: 'Ops/blue-green-deploy--abcdef12.md',
      sources: [
        {
          captureMode: 'whole_message',
          role: 'assistant',
          sessionId: 's-9',
          messageId: 'm-1',
          snapshot: 'Switch traffic only after health checks pass!',
          capturedAt: Date.parse('2026-01-01T00:00:00.000Z'),
          context: { before: [], after: [], project: 'shop' },
        },
      ],
    })
    // Typed already, so the model is not asked.
    await clock.advance(5)
    expect(engine.prompts.filter(prompt => prompt.startsWith('Classify'))).toHaveLength(0)
  })

  test('on a desktop the editor widens its text to where the pointer finds its box ends', async ($, on) => {
    fakeStore(on)
    fakeFs(on)
    fakeEngine(on)
    mock.clock(on)
    await $.session.start(START)
    await $.command.run({ ...RUN, command: 'save', args: 'word '.repeat(30).trim() })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    // The 76 cells the hooks module counted for an 80-cell pane: fifteen words to a row.
    expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('word '.repeat(15).trim())
    // A hover at column 99 shows the box is 100 cells across: twenty words to a row.
    await ui.pointer({ type: 'move', x: 99, y: 0, in: 'editor' })
    expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('word '.repeat(20).trim())
    // A drag past the edge does not widen it: the region keeps the pointer while the button is held.
    await ui.pointer({ type: 'move', x: 140, y: 0, button: 'left', in: 'editor' })
    expect(editorLines(await ui.drawn({ in: 'editor' }))[0]).toBe('word '.repeat(20).trim())
    await ui.unmount()
  })
})
