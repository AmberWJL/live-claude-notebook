/**
 * When things happen in the film, in frames at 30 fps: the scenes animate
 * from these and scripts/soundtrack.mjs times its sounds to them, so a
 * change here moves both. Times inside a scene are from the scene's start.
 */
export const FPS = 30

/** Frames to type `text` at `cps` characters a second. */
export const typingFrames = (text, cps) => Math.ceil((text.length / cps) * FPS)

/**
 * Make it yours: a line of one's own added to the locking note saved from a
 * reply, then a new note written from scratch: the decision, in the
 * developer's own words. Each step starts when the last ends.
 */
export const YOURS = (() => {
  const added = '> My note: grants gets a version column; the sheet retries once on conflict.'
  const title = 'Sharing: the decision'
  const body = 'A `grants(notebook, who, can)` table answers "who can see this".\nOptimistic locking; retry once on conflict.'
  const cps = { added: 34, title: 32, body: 48 }
  const clickInto = 24
  const addAt = 30
  const saved = addAt + typingFrames(added, cps.added) + 4
  const clickNew = saved + 16
  const titleAt = clickNew + 8
  const bodyAt = titleAt + typingFrames(title, cps.title) + 8
  const done = bodyAt + typingFrames(body, cps.body)
  return { added, title, body, cps, clickInto, addAt, saved, clickNew, titleAt, bodyAt, done }
})()

export const SCENES = [
  ['desktop', 660],
  ['find', 140],
  ['yours', YOURS.done + 24],
  ['export', 165],
  ['local', 130],
  ['end', 140],
]

/** Each scene's first frame in the film. */
export const START = Object.fromEntries(
  SCENES.map(([name], i) => [name, SCENES.slice(0, i).reduce((sum, [, frames]) => sum + frames, 0)]),
)
export const FILM_FRAMES = SCENES.reduce((sum, [, frames]) => sum + frames, 0)
export const FRAMES = Object.fromEntries(SCENES)

/**
 * The Claude Code desktop scene: one session designing a feature. The first
 * reply is an insight, saved on the spot; a side question's answer is buried
 * by the implementation rush, scrolled back to, and saved too; the pane's two
 * notes become files.
 */
export const DESKTOP = {
  /**
   * When each message appears and who says it: the design question, the
   * insight, a side question and its answer, back to the design, "implement
   * it", then a rush of ten.
   */
  messages: [
    { at: 10, role: 'user' },
    { at: 28, role: 'agent' },
    { at: 190, role: 'user' },
    { at: 208, role: 'agent' },
    { at: 240, role: 'user' },
    { at: 258, role: 'agent' },
    { at: 282, role: 'user' },
    ...['user', 'agent', 'agent', 'user', 'agent', 'agent', 'user', 'agent', 'agent', 'agent'].map((role, i) => ({ at: 296 + i * 7, role })),
  ],
  /** The first message of the rush. */
  rush: 7,
  /** The two replies kept, as message indexes: the insight, then the learning. */
  kept: [1, 3],
  /** Each save, in order: the button under the reply lights, the cursor comes, click, the pane's Save, saved. */
  glow: [64, 400],
  cursorIn: [70, 404],
  clickButton: [100, 428],
  clickSave: [150, 478],
  saved: [153, 481],
  /** The pane slides in on the first save and stays. */
  paneOpen: [102, 134],
  /** The rush races the chat to the bottom; the rewind scrolls back to the learning. */
  race: [294, 366],
  rewind: [378, 414],
  morph: 518,
  /** The file's front matter types in a line every `step` frames from `typing`. */
  typing: 544,
  step: 7,
  lines: 8,
  body: 608,
}

export const FIND = { typeAt: 16, cps: 9, word: 'sharing', results: [40, 47, 54], shot: 84 }

/** Export: the notebook's Export button, the Save dialog, then the one file it writes. */
export const EXPORT = { hover: 12, click: 30, dialog: 34, save: 78, file: 84, reveal: 96 }

export const LOCAL = { lines: [6, 22, 40, 50], cloud: 30, strike: 58 }

export const END = { brand: 4, tagline: 18, installs: [36, 46], url: 62 }
