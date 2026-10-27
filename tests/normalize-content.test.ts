import { describe, expect, test } from 'claude-code/testing'

import {
  MAX_CONTENT_CHARS,
  deriveTitle,
  normalizeContent,
  oneLine,
  parseTags,
  plainText,
  previewOf,
} from '../src/utils/normalize-content'

describe('normalizeContent', () => {
  test('rejects empty and whitespace-only content', async () => {
    expect(normalizeContent('')).toMatchObject({ ok: false, reason: 'empty' })
    expect(normalizeContent('   \n\t\n')).toMatchObject({ ok: false, reason: 'empty' })
  })

  test('preserves code blocks and indentation, normalizes line endings', async () => {
    const raw = 'Intro\r\n\r\n```ts\r\n  const x = 1\r\n```\r\n\r\n'
    const result = normalizeContent(raw)
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.content).toBe('Intro\n\n```ts\n  const x = 1\n```')
  })

  test('refuses oversized content instead of truncating it', async () => {
    const result = normalizeContent('x'.repeat(MAX_CONTENT_CHARS + 1))
    expect(result).toMatchObject({ ok: false, reason: 'too-large' })
    expect(normalizeContent('x'.repeat(MAX_CONTENT_CHARS))).toMatchObject({ ok: true })
  })
})

describe('deriveTitle', () => {
  test('drops markdown backslash escapes, as a WYSIWYG editor writes them', async () => {
    expect(deriveTitle('\\#\\#\\# hiionn')).toBe('hiionn')
    expect(deriveTitle('Keep the \\*TTL\\* under 60s')).toBe('Keep the TTL under 60s')
  })

  test('uses the first meaningful line without markdown markers', async () => {
    expect(deriveTitle('\n\n## The **real** fix\n\nmore')).toBe('The real fix')
    expect(deriveTitle('- a bullet')).toBe('a bullet')
    expect(deriveTitle('```\ncode first\n```\nthen text')).toBe('code first')
  })

  test('caps long titles with an ellipsis', async () => {
    const title = deriveTitle('word '.repeat(40), 20)
    expect(title.length).toBe(20)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('parseTags and oneLine', () => {
  test('parseTags trims, lowercases, strips # and dedupes', async () => {
    expect(parseTags(' Debug, #debug ,Perf\nperf,, ')).toEqual(['debug', 'perf'])
  })

  test('oneLine collapses whitespace and cuts to width', async () => {
    expect(oneLine('a\n  b\t c', 80)).toBe('a b c')
    expect(oneLine('abcdefghij', 5)).toBe('abcd…')
  })

  test('plainText drops markdown markers and keeps the words', async () => {
    expect(plainText('## Head\n\n- **bold** and _it_ with `code` and [a link](https://x)\n\n```ts\nconst a = 1\n```')).toBe(
      'Head\n\nbold and it with code and a link\n\n\nconst a = 1\n',
    )
  })

  test('previewOf skips the line the title came from', async () => {
    expect(previewOf({ title: 'Head', content: '# Head\n\nFirst para.\n\nSecond.' }, 80)).toBe('First para. Second.')
    expect(previewOf({ title: 'Custom', content: '# Head\n\nFirst para.' }, 80)).toBe('Head First para.')
    expect(previewOf({ title: 'Only line', content: 'Only line' }, 80)).toBe('Only line')
  })
})
