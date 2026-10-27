/** The drawn Claude Code window and where its parts sit, in film pixels. */
export const WIN = { left: 110, top: 150, width: 1700, height: 870 }
export const TITLE = 46
export const SIDEBAR = 290
export const PANE = 600
export const COMPOSER = 64
export const VIEW_TOP = TITLE + 22
export const VIEW_HEIGHT = WIN.height - VIEW_TOP - COMPOSER - 46
/** Between messages. */
export const GAP = 24

/** The Save to notebook button: a row under every reply, right-aligned under the text as the Mod draws it. */
export const BUTTON_ROW = 46
export const BUTTON_BOTTOM = 6
export const BUTTON_HEIGHT = 34
export const BUTTON_WIDTH = 172

/** The conversation's column at pane progress `p`: centered in what the pane leaves of the window. */
export function columnAt(p: number): { left: number; width: number } {
  const mainLeft = WIN.left + SIDEBAR
  const mainWidth = WIN.width - SIDEBAR - PANE * p
  const width = Math.min(940, mainWidth - 80)
  return { left: mainLeft + (mainWidth - width) / 2, width }
}

export const PANE_LEFT = WIN.left + WIN.width - PANE
/** The pane's Save button, on screen. */
export const SAVE_BUTTON = { x: PANE_LEFT + PANE - 96, y: WIN.top + 58 }
/** The two note rows in the pane's list, on screen: where the file cards lift out from. */
export const NOTE_ROWS = [
  { x: PANE_LEFT + 22, y: WIN.top + 142 },
  { x: PANE_LEFT + 22, y: WIN.top + 230 },
]
/** Where the note's file card lands. */
export const CARD = { left: 140, top: 250, width: 860, height: 590 }
