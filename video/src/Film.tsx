import React from 'react'
import { AbsoluteFill, Html5Audio, Series, staticFile } from 'remotion'

import { Desktop } from './scenes/desktop'
import { EndCard } from './scenes/EndCard'
import { Find } from './scenes/Find'
import { Local } from './scenes/Local'
import { Export, Yours } from './scenes/Web'
import { FILM_FRAMES as FRAMES, SCENES } from './cues.mjs'
import { C } from './theme'

/**
 * The home page's film: in Claude Code desktop, one session designs a
 * feature. Claude's first reply is an insight, saved on the spot with the
 * Save to notebook button; a side question's answer is buried by the
 * implementation rush, scrolled back to and saved too; both become Markdown
 * files. Search finds them; the developer adds their own line and writes the
 * decision down; the notebook exports as one file, a design doc; it all stays
 * on your computer; how to install. The soundtrack (scripts/soundtrack.mjs)
 * is timed to the same cues.
 */
const COMPONENTS: Record<string, React.FC> = { desktop: Desktop, find: Find, yours: Yours, export: Export, local: Local, end: EndCard }

export const FILM_FRAMES = FRAMES

export const Film: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.ground }}>
    <Series>
      {SCENES.map(([name, frames]) => {
        const Component = COMPONENTS[name]
        return (
          <Series.Sequence key={name} durationInFrames={frames}>
            <Component />
          </Series.Sequence>
        )
      })}
    </Series>
    <Html5Audio src={staticFile('soundtrack.wav')} />
  </AbsoluteFill>
)
