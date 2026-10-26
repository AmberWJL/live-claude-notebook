import React from 'react'
import { AbsoluteFill, Html5Audio, Series, staticFile } from 'remotion'

import { Desktop } from './scenes/Desktop'
import { EndCard } from './scenes/EndCard'
import { Find } from './scenes/Find'
import { Local } from './scenes/Local'
import { Sources } from './scenes/Sources'
import { Export, Yours } from './scenes/Web'
import { FILM_FRAMES as FRAMES, SCENES } from './cues.mjs'
import { C } from './theme'

/**
 * The home page's film: in Claude Code desktop, an answer worth keeping
 * scrolls away; the Save to notebook button under it keeps it as a Markdown
 * file; a student's explanations fill their course notebooks; search finds
 * them; a note gets their own words, a new one is written from scratch, and
 * the notebook exports as one Markdown file; it all stays on your computer;
 * how to install. The soundtrack (scripts/soundtrack.mjs) is
 * timed to the same cues.
 */
const COMPONENTS: Record<string, React.FC> = { desktop: Desktop, sources: Sources, find: Find, yours: Yours, export: Export, local: Local, end: EndCard }

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
