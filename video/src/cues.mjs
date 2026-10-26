/**
 * When things happen in the film, in frames at 30 fps: the scenes animate
 * from these and scripts/soundtrack.mjs times its sounds to them, so a
 * change here moves both. Times inside a scene are from the scene's start.
 */
export const FPS = 30

export const SCENES = [
  ['desktop', 495],
  ['sources', 180],
  ['find', 150],
  ['yours', 225],
  ['export', 195],
  ['local', 150],
  ['end', 150],
]

/** Each scene's first frame in the film. */
export const START = Object.fromEntries(
  SCENES.map(([name], i) => [name, SCENES.slice(0, i).reduce((sum, [, frames]) => sum + frames, 0)]),
)
export const FILM_FRAMES = SCENES.reduce((sum, [, frames]) => sum + frames, 0)
export const FRAMES = Object.fromEntries(SCENES)

/** The Claude Code desktop scene: the answer scrolls away, comes back, is saved with the button, and becomes a file. */
export const DESKTOP = {
  /** When each message appears: a question, the answer worth keeping, four more, then a rush of ten. */
  messages: [12, 30, 84, 98, 116, 126, ...Array.from({ length: 10 }, (_, i) => Math.round(142 + i * 6.5))],
  race: [140, 208],
  rewind: [218, 252],
  glow: 226,
  cursorIn: 232,
  clickButton: 262,
  paneOpen: [264, 296],
  clickSave: 345,
  saved: 348,
  morph: 384,
  /** The file's front matter types in a line every `step` frames from `typing`. */
  typing: 410,
  step: 7,
  lines: 8,
  body: 476,
}

/** Notes flying from each tool into the folder: source i sends its nth at `start + i * stagger + n * every`, landing `flight` later. */
export const SOURCES = { start: 40, stagger: 7, perSource: 4, every: 22, flight: 26, tools: 4 }

export const FIND = { typeAt: 16, cps: 9, word: 'retry', results: [38, 45, 52], shot: 82 }

/** Frames to type `text` at `cps` characters a second. */
export const typingFrames = (text, cps) => Math.ceil((text.length / cps) * FPS)

/**
 * Make it yours: a line of one's own added to a note saved from a reply,
 * then a new note written from scratch. Each step starts when the last ends.
 */
export const YOURS = (() => {
  const added = '> My note: it only works on a sorted array, so check that first.'
  const title = 'Exam checklist'
  const body = '- [ ] Trace binary search by hand\n- [ ] Write the base case first\n- [ ] Big-O of nested loops'
  const cps = { added: 34, title: 28, body: 44 }
  const clickInto = 24
  const addAt = 30
  const saved = addAt + typingFrames(added, cps.added) + 4
  const clickNew = saved + 16
  const titleAt = clickNew + 8
  const bodyAt = titleAt + typingFrames(title, cps.title) + 8
  const done = bodyAt + typingFrames(body, cps.body)
  return { added, title, body, cps, clickInto, addAt, saved, clickNew, titleAt, bodyAt, done }
})()

/** Export: the notebook's Export button, the Save dialog, then the one file it writes. */
export const EXPORT = { hover: 12, click: 30, dialog: 34, save: 78, file: 84, reveal: 96 }

export const LOCAL = { lines: [6, 22, 40, 50], cloud: 30, strike: 58 }

export const END = { brand: 4, tagline: 18, installs: [36, 46], url: 62 }

/** Every note shot in the sources scene: which tool, which notebook, when it leaves. */
export function sourceShots() {
  const shots = []
  for (let i = 0; i < SOURCES.tools; i += 1) {
    for (let n = 0; n < SOURCES.perSource; n += 1) {
      shots.push({ source: i, notebook: (i + n) % 3, start: SOURCES.start + i * SOURCES.stagger + n * SOURCES.every })
    }
  }
  return shots
}
