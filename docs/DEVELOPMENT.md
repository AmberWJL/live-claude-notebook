# Live Notebook: development notes

User instructions are in the [README](../README.md). This file keeps the
technical details for people working on the Mod itself.

## Layout

The Mod's source is this folder. The hooks module is `hooks/register.tsx`;
pure logic lives under `src/` and `hooks/capture.ts`; the pane's drawing is
`hooks/ui/notebook-pane.tsx`; the data model and state contract are
`types/index.d.ts`. The web notebook is `server/notebook-server.mjs` (Node,
no dependencies, bound to 127.0.0.1) plus the static files in `web/`.

## Checks

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
npx tsc -p .
```

```bash
npm run test:node
```

`test:node` covers what runs without Claude Code: the note format
(`src/core/note-format.mjs`) and the web server over HTTP, including the
guards against other sites. CI (`.github/workflows/ci.yml`) runs it on
macOS, Windows and Linux.

## The home page film

`video/` is a [Remotion](https://www.remotion.dev) project (React, rendered
to MP4) for the film on the home page: Claude Code desktop with the Save to
notebook button and the Live Notebook pane, drawn in the app's layout with
made-up sessions and messages; a student filling course notebooks; the web
notebook editing a note, writing a new one and exporting a notebook (drawn in
`video/src/scenes/Web.tsx`, its export laid out as `export-markdown.mjs`
writes it). Its scenes are in `video/src/scenes/`, and
`video/src/cues.mjs` says when everything happens.

The soundtrack is synthesized by `video/scripts/soundtrack.mjs` from the same
cues (no samples or licensed music): a pad and bass in D, a soft pulse in the
middle, and sound effects on the clicks, the chime when a note is saved, the
key ticks as notes are typed, the notes landing in the folder and the
export. Change a cue and both the
picture and the sound move. The film plays it with `<Html5Audio>`, and the
render mixes it in as AAC.

```bash
cd video && npm install
npm run studio   # synthesize the soundtrack, then preview and scrub in the browser
npm run render   # docs/media/live-notebook.mp4, with sound
npm run poster   # docs/media/live-notebook-poster.jpg
```

Remotion downloads its own headless Chrome the first time; add
`--browser-executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
to use the installed one. Remotion is free for individuals and companies
of up to three people; larger companies need its company license.

`claude plugin test` needs Claude Code 2.1.293 or newer. To run a working
copy without installing it, add the folder as a marketplace and install from
it: `claude plugin marketplace add <folder>` then `claude plugin install
live-notebook@live-notebook`; the installed copy is read from the folder, and
`/reload-plugins` re-reads it. The `tsc` check needs the engine-written types
in `.claude-plugin/types/`, which appear once the Mod has loaded in a session
(or run `tsc` with a tsconfig whose `include` names the API declaration file
the plugin-authoring skill writes).

To run it from this folder in a terminal session:

```bash
claude --plugin-dir /Users/amberwang/live-claude-notebook
```

To stop the web server by hand: `npm run web:stop`.

## Data

Entries are stored in the Mod's own key-value store, a JSON file under your
Claude Code configuration directory that the host keeps across sessions and
restarts. One key per entry (`entry:<id>`) plus a `meta` record, so one
unreadable record never hides the rest. The store holds 4 MiB in all; one
entry's content is capped at 200,000 characters and larger text is refused
rather than cut.

Each entry keeps the original text as a **snapshot** beside the editable
content, with the capture mode, role, session id, the project directory's
name and, when it can be matched, the message's transcript row id. Each
notebook's tags are also kept in the store (`tags:<name>`). Folders are a
`folders` record in the same store. Entries saved by earlier versions may
also hold the messages around the capture and the project's full path;
nothing reads those, and they are never written to a file.

### The notes folder

The folder (`LIVE_NOTEBOOK_HOME`, else `~/.claude/live-notebook`) holds
everything needed to rebuild every note, so other tools can read and write
it without Claude Code:

- `notes/<Notebook>/<slug>--<id8>.md`: front matter (`id`, `title`,
  `folder`, `type`, `tags` as a JSON list, `created`, `updated`,
  `captured`, `role`, `session`, `project`, `pinned`, `archived`), a blank
  line, then the text.
- `notes/<Notebook>/_notebook.json`: the notebook's tags and its pinned and
  archived flags.
- `sources/<id>.json`: for a note saved from a conversation, the snapshot,
  capture mode and time, and the message id.
- `trash/`: deleted notes (`trash/<Notebook>/`) and their sidecars
  (`trash/sources/`).
- `settings.json`: `{ "ai": "chat-only" | "all" | "off" }`.

The format lives in one place, `src/core/note-format.mjs` (plain
JavaScript, typed by `note-format.d.mts`); the server and the Mod both use
it. The Mod polls `notes/.touch` every few seconds and imports any file
whose time changed (`planImport`): a file with no entry becomes one, and
one whose front matter names a session is rebuilt as a capture, with its
sidecar's snapshot. When the files format changes (`FILES_FORMAT` in
`hooks/register.tsx`), every note's file is rewritten once at session start.

### What leaves the machine

Only the AI typing, titling and tagging, through the session's own API
client: a note's title and first 1,200 characters (type and title), and the
titles, first 300 characters of up to 20 notes and the project names (a
notebook's tags). `settings.json`'s `ai` decides which notes the model may
see: `chat-only` (the default) only notes saved from a Claude Code
conversation (`isFromChat`), `all` every note, `off` none.

### The web server's guards

It binds 127.0.0.1. It refuses (403) a request whose Host is not
`127.0.0.1`, `localhost` or `[::1]` at its own port (DNS rebinding); one a
browser marks as from another site or origin, except a plain navigation to
the page; and a POST or PUT that is not `application/json` (so no other
site can write without a preflight, which it never answers). The page is
served with a Content-Security-Policy that runs only its own scripts, plus
Vditor's inline icon and string scripts by hash. Vditor is vendored in
`web/vendor/` (see its README).

## Phase 0 findings

What the Claude Code 2.1.293 Mod runtime offers, checked against its API
declarations and the plugin test kit:

- **Persistence**: `$.store` is a per-plugin JSON key-value store kept across sessions and hot reloads, 4 MiB in all. Sufficient for the MVP; no database needed.
- **Recent messages**: `$.session.messages()` returns the newest 4,096 user and assistant messages as `{ role, text, toolUses }`. Whole-message capture works from this. It carries **no message ids**.
- **Message ids**: `session.append` fires for every stored row with its `uuid`. The Mod fingerprints each main-conversation row (role, length, head and tail) and matches a picked message back to its row id when exactly one row matches. A reply split across several text blocks, or a resumed session's history, has no id; the entry still saves with the snapshot.
- **Selected text**: `$.ui.selection()` returns the text the person selected in the transcript and the row it lies in. This is the excerpt path for the fullscreen terminal and the desktop app; it is undefined elsewhere, where `/save <text>` is the fallback.
- **Session id**: `$.session.id()`.
- **UI**: a pane (`$.ui.open`, drawn by a `ui.render` hook) with Box, Text, Button, Input, Select and Markdown on the terminal, desktop and VS Code surfaces. Input is single-line, so the capture editor is a `Client` surface module of the Mod's own (`hooks/ui/editor.ts`) that keeps lines, cursor and scroll itself; it runs on the terminal and desktop, and VS Code shows the capture read-only. A saved note shows read-only (Markdown) and is edited in the web notebook. Mobile has no Input or Select, so it gets a read-only list.
- **Navigation to the original message**: `$.ui.scroll` can scroll a transcript row into view by id, but only while answering the person's own input and only within the current session. The pane does not offer it; the original text is kept as the entry's snapshot.
- **Module rules the validator enforces**: `$` may only be passed to functions declared in the hooks module itself, and state atoms must be consts of that module with literal plugin and key names. Hence the split: `register.tsx` holds everything that touches `$`; the rest is pure and tested in isolation.
- **Tooling**: the `claude` on PATH (2.1.220) lacks `plugin test`; the desktop app's bundled 2.1.293 binary has it.

## Known limitations

- Session Progress (the design's §4.1) is not implemented in this phase.
- Message ids are best effort, as described above.
- Entries are per user, not per project; there is no sync or sharing.
