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
content, with the capture mode, role, session id and, when it can be matched,
the message's transcript row id. Each notebook's tags are also kept in the
store (`tags:<name>`). The tags and the note types are the one place content
leaves your machine: the titles, the first 300 characters of up to 20 notes
and the project directory names (for tags), and a note's title and first
1,200 characters (for its type) go to the model through the session's own
API client. It also records **context** automatically: the two messages
before and the one after the captured message (each cut to 1,500 characters)
and the project directory. Folders are a `folders` record in the same store.

Notes are also written as markdown files with front matter under
`~/.claude/live-notebook/notes/<Notebook>/`; the Mod polls `notes/.touch`
every few seconds to import edits made on the web or in another editor.
Deleted notes move to `~/.claude/live-notebook/trash/`.

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
