import { describe, expect, test } from 'claude-code/testing'

import { EXPORT_FORMATS, exportMarkdown, exportPlainText, formatOf } from '../src/services/export-markdown.mjs'

describe('exportMarkdown', () => {
  test('the notebook heads the file, then its tags and the export line, then each note under its own heading', () => {
    const text = exportMarkdown(
      {
        name: 'Ops',
        tags: ['deploys', 'caching'],
        notes: [
          { title: 'Blue/green deploy', type: 'learning', created: '2026-10-09T10:00:00.000Z', content: 'Switch traffic after health checks.' },
          { title: 'From a message', type: 'insight', fromMessage: true, content: 'Whole message.' },
        ],
      },
      '2026-10-23',
    )
    expect(text).toBe(
      [
        '# Ops',
        '',
        '#deploys #caching',
        '',
        '_Exported from Live Notebook on 2026-10-23 · 2 notes_',
        '',
        '---',
        '',
        '## Blue/green deploy',
        '',
        '_learning · created 2026-10-09_',
        '',
        'Switch traffic after health checks.',
        '',
        '---',
        '',
        '## From a message',
        '',
        '_insight · from a message_',
        '',
        'Whole message.',
        '',
      ].join('\n'),
    )
  })

  test('no tags and no facts leave no empty lines behind; one note is singular', () => {
    const text = exportMarkdown({ name: 'General', notes: [{ title: 'Only', content: 'Text.' }] }, '2026-10-23')
    expect(text).toBe('# General\n\n_Exported from Live Notebook on 2026-10-23 · 1 note_\n\n---\n\n## Only\n\nText.\n')
  })
})

describe('exportPlainText', () => {
  test('the same notebook without heading marks, italics or markdown rules', () => {
    const text = exportPlainText(
      {
        name: 'Ops',
        tags: ['deploys'],
        notes: [
          { title: 'Blue/green deploy', type: 'learning', created: '2026-10-09T10:00:00.000Z', content: 'Switch traffic after health checks.' },
          { title: 'From a message', fromMessage: true, content: 'Whole message.' },
        ],
      },
      '2026-10-23',
    )
    expect(text).toBe(
      [
        'Ops',
        '#deploys',
        'Exported from Live Notebook on 2026-10-23 · 2 notes',
        '',
        '-'.repeat(40),
        '',
        'Blue/green deploy',
        'learning · created 2026-10-09',
        '',
        'Switch traffic after health checks.',
        '',
        '-'.repeat(40),
        '',
        'From a message',
        'from a message',
        '',
        'Whole message.',
        '',
      ].join('\n'),
    )
  })

  test('a name ending in .txt asks for plain text; anything else is markdown, the default', () => {
    expect(formatOf('ops.txt')).toBe('txt')
    expect(formatOf('/Users/me/Downloads/Ops.TXT')).toBe('txt')
    expect(formatOf('ops.md')).toBe('md')
    expect(formatOf('ops')).toBe('md')
    expect(EXPORT_FORMATS.md.extension).toBe('.md')
    expect(EXPORT_FORMATS.txt.mime).toBe('text/plain')
    expect(EXPORT_FORMATS.txt.render).toBe(exportPlainText)
  })
})
