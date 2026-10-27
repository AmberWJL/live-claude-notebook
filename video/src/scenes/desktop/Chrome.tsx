import React from 'react'

import { C } from '../../theme'
import { BUTTON_BOTTOM, BUTTON_HEIGHT, BUTTON_WIDTH, COMPOSER, SIDEBAR, TITLE, WIN, columnAt } from './layout'

/** The window's furniture: title bar, sessions, composer, the button under a reply, the saved toast. */

const SESSIONS = ['Sharing for notebooks', 'Flaky date test', 'Dependency bumps', 'API client docs', 'Release notes', 'Card grid layout']

export const TitleBar: React.FC = () => (
  <div style={{ height: TITLE, display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px', borderBottom: `1px solid ${C.line}`, background: '#232321' }}>
    {['#ff5f57', '#febc2e', '#28c840'].map(color => (
      <div key={color} style={{ width: 12, height: 12, borderRadius: 6, background: color, opacity: 0.85 }} />
    ))}
    <div style={{ position: 'absolute', left: SIDEBAR + 24, fontSize: 17, color: C.muted }}>{SESSIONS[0]}</div>
    <div style={{ position: 'absolute', right: 22, fontSize: 15, color: C.faint }}>Claude Code</div>
  </div>
)

export const Sidebar: React.FC = () => (
  <div style={{ position: 'absolute', left: 0, top: TITLE, width: SIDEBAR, bottom: 0, background: '#1f1f1d', borderRight: `1px solid ${C.line}`, padding: '18px 14px', boxSizing: 'border-box' }}>
    <div style={{ fontSize: 17, color: C.text, padding: '8px 12px' }}>＋ New session</div>
    <div style={{ fontSize: 17, color: C.muted, padding: '8px 12px' }}>⌕ Search</div>
    <div style={{ fontSize: 14, color: C.faint, padding: '20px 12px 8px', letterSpacing: '0.04em' }}>Recent</div>
    {SESSIONS.map((name, i) => (
      <div key={name} style={{ fontSize: 17, padding: '9px 12px', borderRadius: 8, color: i === 0 ? C.text : C.muted, background: i === 0 ? '#2c2c29' : 'transparent' }}>
        {name}
      </div>
    ))}
    <div style={{ position: 'absolute', left: 26, bottom: 22, display: 'flex', alignItems: 'center', gap: 10, color: C.muted, fontSize: 16 }}>
      <div style={{ width: 26, height: 26, borderRadius: 13, background: '#3a3a35', display: 'grid', placeItems: 'center', fontSize: 13, color: C.text }}>Y</div>
      You
    </div>
  </div>
)

/** The reply box, at the foot of the conversation's column. */
export const Composer: React.FC<{ column: { left: number; width: number } }> = ({ column }) => (
  <div
    style={{
      position: 'absolute',
      left: column.left - WIN.left,
      width: column.width,
      bottom: 24,
      height: COMPOSER,
      borderRadius: 16,
      border: `1px solid ${C.line}`,
      background: '#2c2c29',
      display: 'flex',
      alignItems: 'center',
      padding: '0 22px',
      boxSizing: 'border-box',
      color: C.faint,
      fontSize: 19,
    }}
  >
    Reply to Claude…
  </div>
)

/** The Mod's Save to notebook button under a reply, lit from 0 to 1. */
export const SaveButton: React.FC<{ lit: number; pressed?: boolean }> = ({ lit, pressed = false }) => (
  <div
    style={{
      position: 'absolute',
      right: 4,
      bottom: BUTTON_BOTTOM,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: '0 14px',
      borderRadius: 8,
      border: `1px solid rgba(224,138,106,${0.15 + lit * 0.85})`,
      background: pressed ? 'rgba(224,138,106,.28)' : `rgba(224,138,106,${lit * 0.12})`,
      color: lit > 0.5 ? C.accent : C.faint,
      fontSize: 16,
      fontWeight: 600,
      transform: `scale(${pressed ? 0.95 : 1})`,
    }}
  >
    Save to notebook
  </div>
)

/** "Saved to …", rising in over the conversation. */
export const Toast: React.FC<{ shown: number; children: React.ReactNode }> = ({ shown, children }) => {
  const column = columnAt(1)
  return (
    <div
      style={{
        position: 'absolute',
        left: column.left - WIN.left + 20,
        bottom: 110,
        width: column.width - 40,
        padding: '12px 18px',
        borderRadius: 12,
        background: '#33332f',
        border: `1px solid ${C.line}`,
        fontSize: 17,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        opacity: shown,
        transform: `translateY(${(1 - shown) * 12}px)`,
      }}
    >
      {children}
    </div>
  )
}
