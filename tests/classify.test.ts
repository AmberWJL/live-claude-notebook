import { describe, expect, test } from 'claude-code/testing'

import { classifyPrompt, cleanTitle, parseClassification, parseType } from '../src/services/classify'

describe('classification', () => {
  test('the prompt names the choices and carries the note', async () => {
    const prompt = classifyPrompt('Cache rule', '# Cache rule\n\nKeep the TTL under one minute.')
    expect(prompt.startsWith('Classify')).toBe(true)
    expect(prompt).toContain('Title: Cache rule')
    expect(prompt).toContain('Note: # Cache rule Keep the TTL under one minute.')
    expect(prompt).toContain('reference (a command, snippet, link or fact to look up), other.')
    expect(prompt).not.toMatch(/decision|idea/)
  })

  test('parseType reads the first type word, singular or plural, any case', async () => {
    expect(parseType('Learning')).toBe('learning')
    expect(parseType('This is an insight.')).toBe('insight')
    expect(parseType('references')).toBe('reference')
    expect(parseType('references, maybe learning')).toBe('reference')
    // Types notes no longer have are not read.
    expect(parseType('decision')).toBeUndefined()
    expect(parseType('ideas')).toBeUndefined()
    expect(parseType('nothing here')).toBeUndefined()
    expect(parseType('')).toBeUndefined()
  })

  test('parseClassification reads the two-line answer, and a bare type', async () => {
    expect(parseClassification('type: insight\ntags: Claude Code, caching, TTL, extra')).toEqual({
      type: 'insight',
      tags: ['claude-code', 'caching', 'ttl'],
    })
    expect(parseClassification('Type: Learning\nTags: none')).toEqual({ type: 'learning', tags: [] })
    expect(parseClassification('reference')).toEqual({ type: 'reference', tags: [] })
    expect(parseClassification('tags: a, b')).toEqual({ tags: ['a', 'b'] })
  })

  test('a note saved from the chat is asked for a title of at most six words, read back clean', async () => {
    const prompt = classifyPrompt('Keep the TTL', 'Keep the TTL under one minute.', { withTitle: true })
    expect(prompt).toContain('at most 6 words')
    expect(prompt).toContain('title: <the title>')
    expect(prompt).not.toContain('Title: Keep the TTL')
    expect(classifyPrompt('Keep the TTL', 'x')).not.toContain('title: <the title>')
    expect(parseClassification('title: "Cache TTL rule."\ntype: reference\ntags: caching')).toEqual({
      title: 'Cache TTL rule',
      type: 'reference',
      tags: ['caching'],
    })
    expect(cleanTitle('one two three four five six seven eight')).toBe('one two three four five six')
    expect(cleanTitle('  ')).toBeUndefined()
    expect(cleanTitle('Untitled')).toBeUndefined()
  })
})
