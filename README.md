# Live Notebook

A Claude Code Mod that lets you keep useful messages and insights from your
conversations without leaving Claude Code: save a whole message or an excerpt,
browse and search what you saved, and see where each entry came from.

**Status:** Phase 0 runtime spike complete (see [Phase 0 findings](#phase-0-findings)).
The capture → confirm → browse → search → source loop works end to end in the
plugin test kit; it still needs a hands-on pass in a live session.

## Install

From a terminal Claude Code session:

```
/plugin install live-notebook --marketplace AmberWJL/live-claude-notebook
```

Answer `y` to add the marketplace and pick a scope. The mod is active at once
and in every later session. Update later with `claude plugin update live-notebook`.

Requirements: Claude Code 2.1.293 or newer. The web notebook needs Node.js 18
or newer on the machine and internet access the first time the page loads
(the editor comes from a CDN). Note types and tags are chosen by Haiku through
your own API client; see "Data" below for exactly what is sent.

## Commands

| Command | What it does |
| --- | --- |
| `/save` | With no arguments: if text is selected in the transcript, drafts it as an excerpt; otherwise lists the newest messages of this session to pick from. |
| `/save <text>` | Drafts the typed text as an excerpt. |
| `/notebook [search]` | Opens the Notebook pane, optionally with a search query. `/notebook web` opens the web notebook. |

Every assistant reply also carries a dim **save to notebook** control under
each block (terminal and desktop). Pressing it drafts that block, with its
message id, straight into the confirm form.

Every save goes through a confirm form in the pane: pick a **folder** (or type
a new one), edit the **content** in place, and press **Save**. The title is
derived from the first line. Nothing is stored until you press Save, and
nothing saved is ever injected into Claude's context.

## Web notebook

A small local server (Node, no dependencies, bound to 127.0.0.1) starts
with every session. **Open Live Notebook** at the top of the pane, or
`/notebook web`, opens it in your browser: notebooks and notes in a sidebar,
each notebook with its tags, and the open note in a
[Vditor](https://github.com/Vanessa219/vditor) editor (English) that shows
the note formatted; click into a heading, list item or paragraph and its
markdown markers appear there for editing, then fade when you move on. There
is no Write/Preview switch. Edits autosave to the note's markdown file; Claude Code picks
them up within a few seconds. Notes and notebooks made on the web appear in
the pane too. Each notebook's `⋯` menu on the web renames it, exports it as
one `.md` file you save locally, or deletes it (the folder moves to
`~/.claude/live-notebook/trash`, and Claude Code archives its notes).

Notes live as plain markdown files with front matter under
`~/.claude/live-notebook/notes/<Notebook>/`, so any editor can change them.
The editor loads from a CDN (`unpkg.com`), so the page needs internet
access the first time. To stop the server by hand: `npm run web:stop`.

## Pane

- **Home**: `Open Live Notebook in Browser` across the top, then `+ Add New Note` and `+ Add New Notebook` (which asks for a name), a search field that filters as you type, and filter chips (All notes, Insights, Decisions, References, Ideas). Below, a rule, then your notebooks as collapsible groups with their count; each note is one line with its type mark, title and date. Empty notebooks start collapsed. A short "Saved to …" line with an Open button appears after a save and clears itself.
- **Pick**: the newest messages of this session (newest first) for whole-message capture.
- **Editor page** (saving a capture, a new note, or any note you click): the pane widens; `⌂` and a breadcrumb (notebook / title) with the date on the left, `⋯` and `Save` on the right; a toolbar (a Normal text / Heading 1–3 picker that shows the cursor line's level, then bold, italic, code, link, bullet and numbered lists, quote, undo, redo) that acts on the cursor's word or line; and the editor filling the rest of the pane, headings in bold and list markers in the accent colour. The editor opens with the cursor at the top. Click to place the cursor, drag (or shift+arrows, ⌘A) to select, type over a selection, ⌘C / ⌘X to copy or cut it, Esc when done; ⌃B, ⌃I, ⌃Z and ⌃⇧Z work too. Saving keeps the note open. `⌂` returns to the home page and keeps unsaved changes behind a Resume button. Saving the same message again opens the existing note instead of making a second one.
- **`⋯` menu** on the editor page: the notebook picker and a new-notebook field; for a saved note also its type picker and tags, Archive and Delete (two presses), then **Source**: one line on who wrote it, whole message or excerpt, when, and whether it has been edited since; what it was in reply to; and `Show original`, `Copy` and `View in conversation` (while the original message is on screen); then Discard.
- **Wide pane** (104 columns or more): the whole home page stays on the left beside the open note, with a rule between them; the open note's row is marked in the accent colour.
- **Types and tags**: after a save, a model (Haiku) assigns the note a type (insight, learning, idea, decision, reference or other) and up to three tags, so the filters and rows have something to show. Change the type from the `⋯` menu. A notebook's own tags come the same way from its notes' titles, first lines and project directories and are shown on the web notebook.

## Data

Entries are stored in the Mod's own key-value store, a JSON file under your
Claude Code configuration directory that the host keeps across sessions and
restarts. One key per entry (`entry:<id>`) plus a `meta` record, so one
unreadable record never hides the rest. The store holds 4 MiB in all; one
entry's content is capped at 200,000 characters and larger text is refused
rather than cut.

Each entry keeps the original text as a **snapshot** beside the editable
content, with the capture mode, role, session id and, when it can be matched,
the message's transcript row id. Each notebook's tags are also kept in the store (`tags:<name>`). The tags
and the note types are the one place content leaves your machine: the
titles, the first 300 characters of up to 20 notes and the project directory
names (for tags), and a note's title and first 1,200 characters (for its
type) go to the model through the session's own API client. It also records **context** automatically:
the two messages before and the one after the captured message (each cut to
1,500 characters) and the project directory. Folders are a `folders` record
in the same store. Nothing is sent anywhere.

## Development

The Mod's source is this folder. The hooks module is `hooks/register.tsx`;
pure logic lives under `src/` and `hooks/capture.ts`; the pane's drawing is
`hooks/ui/notebook-pane.tsx`; the data model and state contract are
`types/index.d.ts`.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
npx tsc -p .
```

`claude plugin test` needs Claude Code 2.1.293 or newer. To run a working
copy without installing it, add the folder as a marketplace and install from
it: `claude plugin marketplace add <folder>` then `claude plugin install
live-notebook@live-notebook`; the installed copy is read from the folder, and
`/reload-plugins` re-reads it. The `tsc` check
needs the engine-written types in `.claude-plugin/types/`, which appear once
the Mod has loaded in a session (or run `tsc` with a tsconfig whose `include`
names the API declaration file the plugin-authoring skill writes).

To run it from this folder in a terminal session:

```bash
claude --plugin-dir /Users/amberwang/live-claude-notebook
```

## Phase 0 findings

What the Claude Code 2.1.293 Mod runtime offers, checked against its API
declarations and the plugin test kit:

- **Persistence**: `$.store` is a per-plugin JSON key-value store kept across sessions and hot reloads, 4 MiB in all. Sufficient for the MVP; no database needed.
- **Recent messages**: `$.session.messages()` returns the newest 4,096 user and assistant messages as `{ role, text, toolUses }`. Whole-message capture works from this. It carries **no message ids**.
- **Message ids**: `session.append` fires for every stored row with its `uuid`. The Mod fingerprints each main-conversation row (role, length, head and tail) and matches a picked message back to its row id when exactly one row matches. A reply split across several text blocks, or a resumed session's history, has no id; the entry still saves with the snapshot.
- **Selected text**: `$.ui.selection()` returns the text the person selected in the transcript and the row it lies in. This is the excerpt path for the fullscreen terminal and the desktop app; it is undefined elsewhere, where `/save <text>` is the fallback.
- **Session id**: `$.session.id()`.
- **UI**: a pane (`$.ui.open`, drawn by a `ui.render` hook) with Box, Text, Button, Input, Select and Markdown on the terminal, desktop and VS Code surfaces. Input is single-line, so the content editor is a `Client` surface module of the Mod's own (`hooks/ui/editor.ts`) that keeps lines, cursor and scroll itself; it runs on the terminal and desktop, and VS Code shows the content read-only. Mobile has no Input or Select, so it gets a read-only list.
- **Navigation to the original message**: `$.ui.scroll` can scroll a transcript row into view by id, but only while answering the person's own input and only within the current session. The `⋯` menu offers `View in conversation` only when the original is in this session, and does not promise a jump. Cross-session navigation is not available.
- **Module rules the validator enforces**: `$` may only be passed to functions declared in the hooks module itself, and state atoms must be consts of that module with literal plugin and key names. Hence the split: `register.tsx` holds everything that touches `$`; the rest is pure and tested in isolation.
- **Tooling**: the `claude` on PATH (2.1.220) lacks `plugin test`; the desktop app's bundled 2.1.293 binary has it.

## Known limitations

- The editor is a plain text editor: no syntax highlighting, no selection, no undo beyond retyping.
- Session Progress (the design's §4.1) is not implemented in this phase.
- Message ids are best effort, as described above.
- Entries are per user, not per project; there is no sync or sharing.
