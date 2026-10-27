import React from 'react'

import { DESKTOP as Q } from '../../cues.mjs'
import { INSIGHT, LEARNING } from '../../story'
import { C, MONO } from '../../theme'
import { BUTTON_ROW, GAP, VIEW_HEIGHT } from './layout'

export type Role = 'user' | 'agent'
/** A message in the conversation; `kept` is its index among the replies saved, if it is one. */
export type Message = { role: Role; height: number; body: React.ReactNode; kept?: number }

/** A line of code in a reply, as Claude Code draws it. */
export const code = (text: string) => (
  <div style={{ marginTop: 12, padding: '12px 16px', borderRadius: 10, background: '#1a1a18', border: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 19, color: '#d7d5cc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
    {text}
  </div>
)

const mono = (text: string) => <span style={{ fontFamily: MONO, color: C.accent }}>{text}</span>

/**
 * What is said, in the cues' order. Heights are the rows in the conversation
 * at the narrower column the open pane leaves (user bubbles wrap at 70% of
 * it); the rush's come from who speaks.
 */
const BODIES: Array<{ height?: number; body: React.ReactNode }> = [
  { height: 90, body: 'Let’s design sharing for notebooks. Roles, or per-item permissions?' },
  {
    height: 240,
    body: (
      <>
        <div style={{ fontSize: 27, fontWeight: 700, marginBottom: 6 }}>{INSIGHT.title}</div>
        <div>{INSIGHT.text}</div>
        {code(INSIGHT.code ?? '')}
        <div style={{ marginTop: 12 }}>
          Start with {mono('can')} ∈ {'{'}view, edit{'}'}; add more only when someone asks.
        </div>
      </>
    ),
  },
  { height: 90, body: 'Unrelated: what’s optimistic vs pessimistic locking?' },
  { height: 100, body: LEARNING.text },
  { height: 90, body: 'OK, back to it. Design the grants table and the “who can see this” sheet.' },
  {
    height: 110,
    body: (
      <>
        {code('grants(notebook_id, principal, can, version)')}
        <div style={{ marginTop: 12 }}>The sheet lists people and links, each with a {mono('can')} picker.</div>
      </>
    ),
  },
  { height: 60, body: 'Implement it.' },
  ...[
    'Ship it in small PRs.',
    'Added the migration for grants.',
    'Sheet component: WhoCanSee.tsx.',
    'Tests?',
    '212 of 212 pass.',
    'Wired the version check; retry once.',
    'Share links too?',
    'Links are grants with principal = link:…',
    'Rebased onto main; no conflicts.',
    'Opened the pull request.',
  ].map(body => ({ body })),
]

if (BODIES.length !== Q.messages.length) throw new Error(`The script has ${BODIES.length} messages; the cues time ${Q.messages.length}.`)

/** Every message with its row's height; a reply's row includes the Save to notebook button under it. */
export const MESSAGES: Message[] = BODIES.map((message, i) => {
  const role = Q.messages[i].role as Role
  const base = message.height ?? (role === 'user' ? 60 : 40)
  const kept = Q.kept.indexOf(i)
  return { role, body: message.body, height: base + (role === 'agent' ? BUTTON_ROW : 0), kept: kept === -1 ? undefined : kept }
})

export const TOPS = MESSAGES.reduce<number[]>((tops, _, i) => [...tops, i === 0 ? 0 : tops[i - 1] + MESSAGES[i - 1].height + GAP], [])
export const BOTTOM = TOPS[TOPS.length - 1] + MESSAGES[MESSAGES.length - 1].height

/** The scroll that brings message `i`'s foot into view. */
export const follow = (i: number): number => Math.max(0, TOPS[i] + MESSAGES[i].height - VIEW_HEIGHT)

/** The scroll that centres kept reply `k`. */
export function centreOn(k: number): number {
  const i = Q.kept[k]
  return TOPS[i] - (VIEW_HEIGHT - MESSAGES[i].height) / 2
}
