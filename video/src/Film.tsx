import React from 'react'
import { AbsoluteFill, Series } from 'remotion'

import { CAPTURE_FRAMES, Capture } from './scenes/Capture'
import { END_FRAMES, EndCard } from './scenes/EndCard'
import { FIND_FRAMES, Find } from './scenes/Find'
import { LOCAL_FRAMES, Local } from './scenes/Local'
import { SOURCES_FRAMES, Sources } from './scenes/Sources'
import { C } from './theme'

/**
 * The home page's film: an answer worth keeping scrolls away; one click
 * keeps it as a Markdown file; every tool feeds the same folder; search
 * finds it; it all stays on your computer; how to install.
 */
const SCENES = [
  { component: Capture, frames: CAPTURE_FRAMES },
  { component: Sources, frames: SOURCES_FRAMES },
  { component: Find, frames: FIND_FRAMES },
  { component: Local, frames: LOCAL_FRAMES },
  { component: EndCard, frames: END_FRAMES },
]

export const FILM_FRAMES = SCENES.reduce((sum, scene) => sum + scene.frames, 0)

export const Film: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.ground }}>
    <Series>
      {SCENES.map(({ component: Component, frames }, i) => (
        <Series.Sequence key={i} durationInFrames={frames}>
          <Component />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
)
