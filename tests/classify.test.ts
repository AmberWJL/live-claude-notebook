import { describe, expect, test } from 'claude-code/testing'

import { classifyPrompt, parseClassification, parseType } from '../src/services/classify'

describe('classification', () => {
  test('the prompt names the choices and carries the note', async () => {
    const prompt = classifyPrompt('Cache rule', '# Cache rule\n\nKeep the TTL under one minute.')
    expect(prompt.startsWith('Classify')).toBe(true)
    expect(prompt).toContain('Title: Cache rule')
    expect(prompt).toContain('Note: # Cache rule Keep the TTL under one minute.')
  })

  test('parseType reads the first type word, singular or plural, any case', async () => {
    expect(parseType('Decision')).toBe('decision')
    expect(parseType('This is an insight.')).toBe('insight')
    expect(parseType('references')).toBe('reference')
    expect(parseType('ideas, maybe learning')).toBe('idea')
    expect(parseType('nothing here')).toBeUndefined()
    expect(parseType('')).toBeUndefined()
  })

  test('parseClassification reads the two-line answer, and a bare type', async () => {
    expect(parseClassification('type: insight\ntags: Claude Code, caching, TTL, extra')).toEqual({
      type: 'insight',
      tags: ['claude-code', 'caching', 'ttl'],
    })
    expect(parseClassification('Type: Decision\nTags: none')).toEqual({ type: 'decision', tags: [] })
    expect(parseClassification('reference')).toEqual({ type: 'reference', tags: [] })
    expect(parseClassification('tags: a, b')).toEqual({ tags: ['a', 'b'] })
  })
})
