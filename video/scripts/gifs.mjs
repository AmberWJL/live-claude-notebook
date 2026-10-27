// The README's GIFs: the film cut into its beats, at half size and 15 fps, written to docs/gifs/.
// Each starts past its scene's fade-in so the first frame is not black.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DESKTOP, START } from '../src/cues.mjs'

const CUTS = [
  ['01-save-insight', 8, DESKTOP.messages[2].at - 1],
  ['02-side-question', DESKTOP.messages[2].at, DESKTOP.rewind[0] - 1],
  ['03-rescue', DESKTOP.rewind[0], DESKTOP.morph - 1],
  ['04-markdown-and-find', DESKTOP.morph, START.yours - 1],
  ['05-yours', START.yours + 10, START.export - 1],
  ['06-export', START.export + 10, START.local - 1],
]

const video = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(video, '..', 'docs', 'gifs')
mkdirSync(out, { recursive: true })
for (const [name, from, to] of CUTS) {
  const file = join(out, `${name}.gif`)
  execFileSync('npx', ['remotion', 'render', 'src/index.ts', 'LiveNotebook', file, '--codec=gif', `--frames=${from}-${to}`, '--every-nth-frame=2', '--scale=0.5', '--log=error'], { cwd: video, stdio: 'inherit' })
  console.log(`${name}.gif: frames ${from}-${to}`)
}
