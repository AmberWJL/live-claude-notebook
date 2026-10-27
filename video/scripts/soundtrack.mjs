// The film's soundtrack, synthesized from scratch (no samples, no music library, no licence to track): a warm
// pad and bass in D, a soft half-time pulse while notes travel and get found, and sound effects placed on the
// film's own cues (src/cues.mjs): message pops, the scroll-away whoosh and the rewind, button clicks, a chime when
// a note is saved, key ticks as the file and the developer's own notes type themselves, the export. Writes
// public/soundtrack.wav (44.1 kHz, 16-bit stereo), which the film plays with <Html5Audio>.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DESKTOP, END, EXPORT, FILM_FRAMES, FIND, FPS, LOCAL, START, YOURS } from '../src/cues.mjs'

const SR = 44_100
const SECONDS = FILM_FRAMES / FPS
const N = Math.ceil(SECONDS * SR)
const left = new Float32Array(N)
const right = new Float32Array(N)

/** Seconds for a frame of the film, or of a scene (`at(frame, START.find)`). */
const at = (frame, scene = 0) => (scene + frame) / FPS

// A seeded generator, so every render sounds the same.
let seed = 0x5eed
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function put(i, value, pan) {
  if (i < 0 || i >= N) return
  const angle = ((pan + 1) * Math.PI) / 4
  left[i] += value * Math.cos(angle)
  right[i] += value * Math.sin(angle)
}

/** An envelope's gain `s` seconds into a sound of `dur`: linear attack, then hold, then an exponential-ish release. */
function envelope(s, dur, attack, release) {
  if (s < 0 || s > dur) return 0
  const rise = attack > 0 ? Math.min(1, s / attack) : 1
  const fall = release > 0 ? Math.min(1, (dur - s) / release) : 1
  return rise * fall * fall
}

/**
 * A tone: partials `[ratio, gain]` over `freq` (gliding to `to` if given), shaped by attack and release,
 * or by `decay` (seconds to fall 60 dB) for struck sounds.
 */
function tone({ start, dur, freq, to = freq, amp, attack = 0.005, release = 0.05, decay, pan = 0, partials = [[1, 1]], detune = 0 }) {
  const first = Math.floor(start * SR)
  const count = Math.floor(dur * SR)
  let phase = random() * Math.PI * 2
  for (let k = 0; k < count; k += 1) {
    const s = k / SR
    const f = freq + (to - freq) * (s / dur)
    phase += (2 * Math.PI * f * (1 + detune)) / SR
    let wave = 0
    for (const [ratio, gain] of partials) wave += gain * Math.sin(phase * ratio)
    const gain = decay !== undefined ? Math.exp((-6.9 * s) / decay) * Math.min(1, s / attack) : envelope(s, dur, attack, release)
    put(first + k, wave * gain * amp, pan)
  }
}

/** Filtered noise: a one-pole low-pass sweeping from `from` to `to` Hz, minus its own low end when `bright`. */
function noise({ start, dur, amp, from = 2000, to = from, attack = 0.002, release = 0.02, pan = 0, bright = false, shape }) {
  const first = Math.floor(start * SR)
  const count = Math.floor(dur * SR)
  let low = 0
  let lower = 0
  for (let k = 0; k < count; k += 1) {
    const s = k / SR
    const cutoff = from + (to - from) * (s / dur)
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
    const white = random() * 2 - 1
    low += a * (white - low)
    lower += 0.02 * (low - lower)
    const value = bright ? low - lower : low
    const gain = shape !== undefined ? shape(s / dur) : envelope(s, dur, attack, release)
    put(first + k, value * gain * amp, pan)
  }
}

const NOTE = name => {
  const [, letter, accidental, octave] = /^([A-G])(#|b)?(\d)$/.exec(name)
  const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0)
  return 440 * 2 ** ((semis + (Number(octave) - 4) * 12) / 12)
}

// ---------------------------------------------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------------------------------------------

const BEAT = 0.6 // 100 beats a minute
const CHORD = BEAT * 8 // two bars
const CHORDS = [
  ['D3', 'A3', 'C#4', 'E4', 'F#4'], // Dmaj9
  ['B2', 'F#3', 'A3', 'D4', 'E4'], // Bm11
  ['G2', 'D3', 'F#3', 'A3', 'B3'], // Gmaj9
  ['A2', 'E3', 'A3', 'B3', 'E4'], // Asus2
]
const PAD_PARTIALS = [
  [1, 1],
  [2, 0.28],
  [3, 0.1],
  [4, 0.04],
]

const endAt = at(0, START.end)
for (let c = 0; c * CHORD < endAt; c += 1) {
  const chord = CHORDS[c % CHORDS.length]
  const start = c * CHORD
  const dur = Math.min(CHORD + 1.6, endAt - start + 0.8)
  chord.forEach((name, v) => {
    const pan = (v / (chord.length - 1)) * 1.2 - 0.6
    for (const detune of [-0.0035, 0.0035]) {
      tone({ start, dur, freq: NOTE(name), amp: 0.022, attack: 1.4, release: 1.6, pan: pan + detune * 40, partials: PAD_PARTIALS, detune })
    }
  })
  // The bass: the chord's root, an octave down, swelling under each change.
  tone({ start, dur, freq: NOTE(chord[0]) / 2, amp: 0.07, attack: 0.6, release: 1.2, partials: [[1, 1], [2, 0.18]] })
}
// The end card resolves home: Dmaj9, held to the last frame.
for (const name of ['D2', 'D3', 'A3', 'C#4', 'E4', 'F#4', 'A4']) {
  tone({ start: endAt - 0.4, dur: SECONDS - endAt + 0.4, freq: NOTE(name), amp: name === 'D2' ? 0.07 : 0.024, attack: 1.0, release: 2.4, pan: 0, partials: PAD_PARTIALS })
}

// A soft half-time pulse while notes are found, edited and exported: a round kick on beats one and three, a shaker between.
const pulseFrom = at(0, START.find)
const pulseTo = at(0, START.local)
for (let s = pulseFrom; s < pulseTo - 0.05; s += BEAT) {
  const beat = Math.round((s - pulseFrom) / BEAT)
  const fadeIn = Math.min(1, (s - pulseFrom) / 2.4)
  if (beat % 2 === 0) tone({ start: s, dur: 0.32, freq: 110, to: 46, amp: 0.2 * fadeIn, attack: 0.002, release: 0.25, partials: [[1, 1]] })
  noise({ start: s + BEAT / 2, dur: 0.06, amp: 0.05 * fadeIn, from: 7000, bright: true, attack: 0.004, release: 0.05, pan: 0.25 })
}

// ---------------------------------------------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------------------------------------------

const click = (start, pan = 0) => {
  noise({ start, dur: 0.012, amp: 0.5, from: 5000, bright: true, attack: 0.0005, release: 0.01, pan })
  tone({ start, dur: 0.03, freq: 2600, to: 1800, amp: 0.05, attack: 0.001, release: 0.02, pan })
}
const chime = (start, root, amp = 0.08) => {
  const bell = [[1, 1], [2, 0.35], [2.76, 0.28], [5.4, 0.1]]
  tone({ start, dur: 2.2, freq: root, amp, attack: 0.003, decay: 1.6, partials: bell, pan: -0.15 })
  tone({ start: start + 0.11, dur: 2.2, freq: root * 1.26, amp: amp * 0.7, attack: 0.003, decay: 1.5, partials: bell, pan: 0.15 })
}
const tick = (start, amp = 0.05, pan = 0) => noise({ start, dur: 0.006, amp, from: 9000, bright: true, attack: 0.0005, release: 0.005, pan })
const whoosh = (start, dur, from, to, amp, pan = 0) =>
  noise({ start, dur, amp, from, to, pan, shape: x => Math.sin(Math.PI * Math.min(1, x)) ** 1.5 })

// The conversation: a pop for each message, the user's lower and to the right, the rush's quieter.
DESKTOP.messages.forEach(({ at: frame, role }, i) => {
  const isUser = role === 'user'
  const isRush = i >= DESKTOP.rush
  tone({ start: at(frame), dur: 0.09, freq: isUser ? 660 : 880, to: isUser ? 700 : 940, amp: isRush ? 0.035 : 0.06, attack: 0.004, release: 0.07, pan: isUser ? 0.3 : -0.2, partials: [[1, 1], [2, 0.2]] })
})
// It scrolls away: rising air while the replies rush past.
whoosh(at(DESKTOP.race[0]), at(DESKTOP.race[1] - DESKTOP.race[0]) + 0.2, 500, 7000, 0.16)
// The rewind: the air runs back down, with a falling tape tone.
whoosh(at(DESKTOP.rewind[0]), at(DESKTOP.rewind[1] - DESKTOP.rewind[0]), 7000, 300, 0.12)
tone({ start: at(DESKTOP.rewind[0]), dur: at(DESKTOP.rewind[1] - DESKTOP.rewind[0]), freq: 520, to: 140, amp: 0.025, attack: 0.05, release: 0.2 })
// Each save: the pointer reaches the button under the reply, a click, a click on the pane's Save, and the chime, a step higher the second time.
DESKTOP.saved.forEach((saved, k) => {
  tone({ start: at(DESKTOP.hover[k]), dur: 0.5, freq: NOTE('A5'), amp: 0.025, attack: 0.02, decay: 0.45, partials: [[1, 1], [2, 0.3]] })
  tone({ start: at(DESKTOP.hover[k]) + 0.08, dur: 0.5, freq: NOTE('E6'), amp: 0.02, attack: 0.02, decay: 0.45 })
  click(at(DESKTOP.clickButton[k]), -0.2)
  click(at(DESKTOP.clickSave[k]), 0.5)
  chime(at(saved), NOTE(k === 0 ? 'A5' : 'B5'))
})
// The pane slides in on the first save.
whoosh(at(DESKTOP.paneOpen[0]), at(DESKTOP.paneOpen[1] - DESKTOP.paneOpen[0]) + 0.1, 900, 3500, 0.07, 0.5)
// The notes lift out into their files; the learning's types itself in.
whoosh(at(DESKTOP.morph), 0.7, 400, 2500, 0.08, -0.3)
for (let line = 0; line < DESKTOP.lines; line += 1) {
  const startFrame = DESKTOP.typing + line * DESKTOP.step
  for (let k = 0; k < 4; k += 1) tick(at(startFrame) + k * 0.045 + random() * 0.01, 0.06, -0.3 + random() * 0.2)
}
tone({ start: at(DESKTOP.body), dur: 0.3, freq: NOTE('D5'), amp: 0.025, attack: 0.01, decay: 0.3 })

// Search: a key tick for each letter of the word, a blip for each result, air as the notebook opens.
for (let k = 0; k < FIND.word.length; k += 1) tick(at(FIND.typeAt, START.find) + (k * 1) / FIND.cps + 0.02, 0.09)
FIND.results.forEach((frame, i) => tone({ start: at(frame, START.find), dur: 0.08, freq: 990 - i * 110, amp: 0.04, attack: 0.003, release: 0.06 }))
whoosh(at(FIND.shot, START.find), 0.9, 300, 3000, 0.09)

// On your computer: a warm low thump for each line; the cloud gets swiped away.
LOCAL.lines.forEach((frame, i) => tone({ start: at(frame, START.local), dur: 0.45, freq: 130 - i * 8, to: 72, amp: 0.13, attack: 0.003, release: 0.35, partials: [[1, 1], [2, 0.15]] }))
whoosh(at(LOCAL.cloud, START.local), 0.6, 2000, 5000, 0.04, 0.5)
whoosh(at(LOCAL.strike, START.local), 0.35, 1500, 9000, 0.1, 0.5)

// Make it yours: a click into the note, key ticks as the developer types their own line, a soft confirmation when
// it saves; a click on New Note, then ticks for the title and the decision.
const typing = (text, startFrame, cps, pan) => {
  for (let k = 0; k < text.length; k += 2) tick(at(startFrame, START.yours) + k / cps + random() * 0.01, text[k] === ' ' ? 0.035 : 0.055, pan + random() * 0.15)
}
click(at(YOURS.clickInto, START.yours), 0.2)
typing(YOURS.added, YOURS.addAt, YOURS.cps.added, 0.1)
tone({ start: at(YOURS.saved, START.yours), dur: 0.35, freq: NOTE('E5'), amp: 0.03, attack: 0.005, decay: 0.3 })
click(at(YOURS.clickNew, START.yours), -0.5)
tone({ start: at(YOURS.clickNew, START.yours) + 0.04, dur: 0.12, freq: 740, to: 880, amp: 0.04, attack: 0.004, release: 0.08 })
typing(YOURS.title, YOURS.titleAt, YOURS.cps.title, 0.1)
typing(YOURS.body, YOURS.bodyAt, YOURS.cps.body, 0.1)
tone({ start: at(YOURS.done + 4, START.yours), dur: 0.35, freq: NOTE('F#5'), amp: 0.03, attack: 0.005, decay: 0.3 })

// Export: a click on Export, the Save dialog drops in, a click on Save, and the file lands with a chime.
click(at(EXPORT.click, START.export), -0.5)
whoosh(at(EXPORT.dialog, START.export), 0.4, 800, 3000, 0.05)
click(at(EXPORT.save, START.export), 0.2)
whoosh(at(EXPORT.file, START.export), 0.6, 300, 2000, 0.08, -0.3)
tone({ start: at(EXPORT.file + 6, START.export), dur: 0.4, freq: 90, to: 60, amp: 0.1, attack: 0.003, release: 0.3 })
chime(at(EXPORT.file + 10, START.export), NOTE('D5'), 0.06)

// The end card: a low chime under the name, ticks as the install lines arrive.
chime(at(END.brand, START.end), NOTE('D5'), 0.07)
END.installs.forEach(frame => tick(at(frame, START.end), 0.04))

// ---------------------------------------------------------------------------------------------------------------
// Master: fades, a gentle saturation, normalize, 16-bit WAV
// ---------------------------------------------------------------------------------------------------------------

let peak = 0
for (let i = 0; i < N; i += 1) {
  const s = i / SR
  const fade = Math.min(1, s / 0.4) * Math.min(1, (SECONDS - s) / 1.6)
  left[i] = Math.tanh(left[i] * 1.4 * fade) / 1.4
  right[i] = Math.tanh(right[i] * 1.4 * fade) / 1.4
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
}
const gain = peak > 0 ? 0.89 / peak : 1

const data = Buffer.alloc(N * 4)
for (let i = 0; i < N; i += 1) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32767), i * 4)
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32767), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(2, 22)
header.writeUInt32LE(SR, 24)
header.writeUInt32LE(SR * 4, 28)
header.writeUInt16LE(4, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(data.length, 40)

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'soundtrack.wav')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.concat([header, data]))
console.log(`Soundtrack: ${SECONDS.toFixed(1)} s, peak gain ${gain.toFixed(2)}, ${out}`)
