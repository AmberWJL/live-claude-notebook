import { describe, expect, mock, test } from 'claude-code/testing'

import { PANE, PANE_PROPS, PLUGIN, START, fakeEngine, fakeFs, fakeStore } from './support'

const BLOCK = { text: '## Cache rule\n\nKeep the TTL under one minute.', isFirstOfReply: true } as const

const MESSAGES = [
  { role: 'user' as const, text: 'What is the cache rule?', toolUses: [] },
  { role: 'assistant' as const, text: BLOCK.text, toolUses: [] },
]

describe('save control under assistant replies', () => {
  test('every reply block draws its markdown and a save control on terminal and desktop', async ($, on) => {
    fakeStore(on)
    fakeFs(on)
    fakeEngine(on, MESSAGES)
    mock.clock(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const row = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AssistantMessage', requestId: 'msg-1', props: BLOCK })
      expect((await row.find({ type: 'Markdown' }))?.props.text).toBe(BLOCK.text)
      expect((await row.find({ key: 'save' }))?.text).toBe('Save to notebook')
      await row.unmount()
    }
  })

  test('pressing save drafts the whole block with its message id and context, then Save stores it', async ($, on) => {
    const data = fakeStore(on)
    fakeFs(on)
    const engine = fakeEngine(on, MESSAGES)
    mock.clock(on, { now: 7 })
    await $.session.start(START)

    const row = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AssistantMessage', requestId: 'msg-42', props: BLOCK })
    await row.press({ key: 'save' })
    expect(engine.opened).toEqual([PANE])
    await row.unmount()

    const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /^Cache rule$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^whole message · assistant/ })).toBeDefined()
    await pane.press({ key: 'save' })

    const key = [...data.keys()].find(k => k.startsWith('entry:')) ?? ''
    const stored = data.get(key) as Record<string, unknown>
    expect(stored).toMatchObject({ title: 'Cache rule', content: BLOCK.text, folder: 'General', status: 'confirmed' })
    expect((stored.sources as Array<Record<string, unknown>>)[0]).toEqual({
      captureMode: 'whole_message',
      role: 'assistant',
      messageId: 'msg-42',
      sessionId: 'session-test',
      snapshot: BLOCK.text,
      capturedAt: 7,
      context: {
        before: [{ role: 'user', text: 'What is the cache rule?' }],
        after: [],
        cwd: '/tmp/live-notebook-test',
      },
    })
    // Saved: the list again, with a confirmation that opens the note.
    expect(await pane.find({ type: 'Text', text: /^Saved to General$/ })).toBeDefined()
    expect(await pane.find({ type: 'Markdown', text: /Keep the TTL/ })).toBeUndefined()
    // Open puts the note in the editor; its source is behind ⋯.
    await pane.press({ key: 'open-saved' })
    expect(await pane.find({ type: 'Text', text: /^Cache rule$/ })).toBeDefined()
    expect(await pane.find({ key: 'save-edit' })).toBeDefined()
    await pane.press({ key: 'editor-more' })
    expect(await pane.find({ key: 'view-source' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Captured from assistant message$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /In reply to: What is the cache rule\?/ })).toBeDefined()
    await pane.press({ key: 'home-icon' })
    expect((await pane.find({ key: 'nb:General' }))?.text).toBe('⌄')
    await pane.unmount()
  })

  test('narration between tool calls gets no save control; the reply that ends the turn does', async ($, on) => {
    fakeStore(on)
    fakeFs(on)
    fakeEngine(on, MESSAGES)
    mock.session(on)
    mock.clock(on)
    await $.session.start(START)
    const origin = { kind: 'model' as const, model: 'test' }
    const text = (uuid: string, body: string) =>
      $.session.append({ uuid, door: 'response', origin, message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: body }] } })
    await text('r-1', 'Reading the files first:')
    await $.session.append({
      uuid: 'r-tool',
      door: 'response',
      origin,
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }] },
    })
    await text('r-2', 'Done. The TTL is the cause.')

    const hasSave = async (requestId: string, body: string) => {
      try {
        const row = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AssistantMessage', requestId, props: { text: body, isFirstOfReply: true } })
        const found = (await row.find({ key: 'save' })) !== undefined
        await row.unmount()
        return found
      } catch {
        return false
      }
    }
    expect(await hasSave('r-1', 'Reading the files first:')).toBe(false)
    expect(await hasSave('r-2', 'Done. The TTL is the cause.')).toBe(false)
    await $.turn.complete({ turnId: 't-1', answer: 'Done. The TTL is the cause.', durationMs: 10, isAborted: false, reason: 'answer' })
    expect(await hasSave('r-2', 'Done. The TTL is the cause.')).toBe(true)
    expect(await hasSave('r-1', 'Reading the files first:')).toBe(false)
    // A block from before this session is not tracked, so it keeps the control.
    expect(await hasSave('older', 'An earlier reply.')).toBe(true)
  })
})
