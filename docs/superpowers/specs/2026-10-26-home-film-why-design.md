# The home page film: why people use Live Notebook

*2026-10-26 · branch `film-why`, off `main`*

## Purpose

The film on the home page (`video/`, Remotion, rendered to `docs/media/live-notebook.mp4`) currently tells two stories: a payments answer that scrolls away, and a student filling course notebooks. This rewrite tells one: a developer designing a feature with Claude, in one chat, where side questions land next to the real work and the replies worth keeping get buried. It shows why someone reaches for Live Notebook, not just what the buttons do.

Claude Code only. No Cursor, VS Code or MCP anywhere in the film, the site or the README.

## The story

One session: designing **sharing for notebooks**. Claude's first reply is an insight (a reframing), saved on the spot. A side question about locking gets a reply worth keeping too, but the implementation rush buries it; the developer scrolls back for it and saves it. The notebook then holds Claude's two replies plus the developer's own decision note, and exports as a design doc.

The pane opens at the first save and stays open: the chat on the left scrolls into chaos while the notebook on the right stays calm.

## Scenes

Six scenes; the old Sources scene ("every session, one folder") is cut, and its claim moves to the Local scene. Lengths are targets; the Yours scene's length is computed from its typing, and the film's final length is `FILM_FRAMES`, which the README and site quote.

| Scene | Frames | ≈ s |
|---|---|---|
| desktop | 660 | 22 |
| find | 140 | 4.7 |
| yours | 246 (computed) | 8.2 |
| export | 165 | 5.5 |
| local | 130 | 4.3 |
| end | 140 | 4.7 |
| **total** | **1481** | **49.4** |

### Desktop (660 frames)

The drawn Claude Code desktop window, as today: sessions on the left, the conversation, the Live Notebook pane on the right. Session title: *Sharing for notebooks*. Sidebar sessions: Sharing for notebooks, Flaky date test, Dependency bumps, API client docs, Release notes, Card grid layout.

Messages and when they appear (frames from the scene's start):

| at | who | text |
|---|---|---|
| 10 | you | Let's design sharing for notebooks. Roles, or per-item permissions? |
| 28 | Claude, **kept (Insight)** | **Model the question, not the table.** People never ask "what's my role?". They ask "who can see this?". One grants table answers it directly; roles are a view on top. `grants(notebook_id, principal, can)` Start with can ∈ {view, edit}; add more only when someone asks. |
| 190 | you | Unrelated: what's optimistic vs pessimistic locking? |
| 208 | Claude, **kept (Learning)** | Optimistic: write with a version check and retry on conflict. Pessimistic: lock the row first. Sharing settings rarely conflict, so optimistic. |
| 240 | you | OK, back to it. Design the grants table and the "who can see this" sheet. |
| 258 | Claude | Schema: `grants(notebook_id, principal, can, version)`. The sheet lists people and links, each with a can picker: one row per grant. |
| 282 | you | Implement it. |
| 296 + 7·n | the rush, 10 messages | Ship it in small PRs. · Added the migration for grants. · Sheet component: WhoCanSee.tsx. · Tests? · 212 of 212 pass. · Wired the version check; retry once. · Share links too? · Links are grants with principal = link:… · Rebased onto main; no conflicts. · Opened the pull request. |

Every Claude reply has the Save to notebook button under it, right-aligned as the Mod draws it: the desktop's grey secondary button, which only changes under the pointer (lighter grey, label in the accent), never before.

Beats:

| at | what |
|---|---|
| 70 | the cursor comes in; 94 it reaches the button under the insight, which takes its hover look (grey, label in the accent) until the cursor leaves |
| 100 | click Save to notebook; 102–134 the pane slides in with the draft: *← Design / Model the question, not the table*, Notebook **Design**, Type **◉ Insight** |
| 150 | click Save; 153 saved. Toast *Saved to Design: Model the question, not the table*. The pane shows the notebook as the Mod draws it: Write Note in Web and + New Notebook, the search field, the type filters, DESIGN · 1, then PAYMENTS · OPS with two faded titles. The pane stays open from here. |
| 294–366 | the rush races the chat to the bottom (motion blur as today) |
| 378–414 | the scroll rewinds, hunting, and lands with the locking reply centred |
| 404 | the cursor comes back; 422 it reaches the button, hover look again |
| 428 | click Save to notebook; the pane switches to the second draft (*Optimistic vs pessimistic locking*, Type **↗ Learning**), no slide |
| 478 | click Save; 481 saved. Toast *Saved to Design: Optimistic vs pessimistic locking*. The pane lists DESIGN · 2: ◉ Model the question, not the table · ↗ Optimistic vs pessimistic locking |
| 518 | the window drifts away; the learning's file card springs in from its pane row, the insight's card peeking behind it (offset up-right, dimmed) |
| 544 | front matter types in, a line every 7 frames (8 lines); 608 the body fades in, and holds until the scene fades at 648 |

The file card: `Design/optimistic-vs-pessimistic-locking--7c1e4b2a.md`, front matter `title: "Optimistic vs pessimistic locking"`, `folder: "Design"`, `type: learning`, `tags: ["concurrency", "sharing"]`, `captured: whole_message`, `role: assistant`; body `## Optimistic vs pessimistic locking` and its first line. Behind it: `Design/model-the-question-not-the-table--3f2a91c0.md`.

Captions (top left, 50px, as today):

| at | caption |
|---|---|
| 4 | You're designing a feature with Claude. |
| 56 | It says something *worth keeping.* |
| 156 | One click. Keep going. |
| 192 | A side question lands in the same chat. |
| 296 | …and the chat buries it. |
| 380 | Which one was it again? |
| 432 | There's a button under every reply. |
| 528 | Saved as *plain Markdown files.* |

### Find (140 frames)

Caption *Find it again in a second.* Search types **sharing**. Three results, the word highlighted:

- DESIGN · **Model the question, not the table** · …they ask "who can see this?". One grants table answers the *sharing* question…
- DESIGN · **Optimistic vs pessimistic locking** · …*sharing* settings rarely conflict, so optimistic with a version check…
- OPS · **Share links expire** · …*sharing* links get a 7-day TTL and a one-time token…

Then the web notebook opens: `docs/media/web-notebook.png`, a real screenshot of the web notebook (1280×760 at 2x) with these notes in a Design and an Ops notebook and the insight open.

### Yours (computed, ≈ 240 frames)

The drawn web notebook, light layout, as today. Sidebar: **Design** (Optimistic vs pessimistic locking ↗, open · Model the question, not the table ◉ · Who can see this: the sheet ↗), then **Ops** (Share links expire ◉). The locking note is open, *Created today · saved from a Claude reply*, type ↗ Learning.

- Caption *Edit any note. **Add what you decided.*** The cursor clicks under the note's text; a quote line types in: `> My note: grants gets a version column; the sheet retries once on conflict.` *Saved* flashes.
- Caption *Or write **your own.*** Click + New Note. Title types: **Sharing: the decision**. Body types: `A grants(notebook, who, can) table answers "who can see this".` / `Optimistic locking; retry once on conflict.` The new note appears at the top of Design as it is typed.

Timings follow the existing `YOURS` pattern: each step starts when the last ends, from the texts' lengths and the same characters-per-second.

### Export (165 frames)

Caption *Export a notebook as **one Markdown file.*** Hover the DESIGN heading, the Export button appears, click. Dialog: *Export Design as one markdown file*, Save As `design.md`, Where Downloads, Format Markdown (.md). Save. The window dims away; the file springs in: `Downloads/design.md`:

```
# Design
#design #sharing
_Exported from Live Notebook on 2026-10-26 · 4 notes_
---
## Sharing: the decision
A grants(notebook, who, can) table answers "who can see this".
Optimistic locking; retry once on conflict.
---
## Optimistic vs pessimistic locking
_learning · created 2026-10-26 · from a message_
Optimistic: write with a version check and retry on conflict…
> My note: grants gets a version column; the sheet retries once on conflict.
---
## Model the question, not the table
```

Side text: *A design doc, ready to **share with your team.***

### Local (130 frames)

As today: *No account. / No cloud. / Just Markdown files / on your computer.* The laptop shows `~/.claude/live-notebook/notes/Design` with `model-the-question-not-the-table--3f2a91c0.md`, `optimistic-vs-pessimistic-locking--7c1e4b2a.md`, `sharing-the-decision--a81c03de.md`, `who-can-see-this-the-sheet--5b7e2f19.md`, `share-links-expire--c90d4a77.md`. The crossed-out cloud stays. Subtitle: *Every session, one folder. Open it in any editor, back it up, put it in git.*

### End (140 frames)

Unchanged: the mark and name, *Keep the answers worth keeping.*, the two install rows, the URL, *Free and open source · MIT*.

## Sound

`scripts/soundtrack.mjs` keeps its music and its instruments; only the cue hookup changes:

- The desktop sequence (hover, click, pane whoosh, click, chime) plays twice, driven by arrays in the cues; the pane whoosh only on the first.
- Message pops take the speaker from the cues (`role`), not from index parity.
- The plucks for notes landing in the folder go with the Sources scene.
- The half-time pulse runs from the start of Find to the start of Local (Find, Yours, Export).

## Code

- `video/src/cues.mjs`: `SCENES` without `sources`; `DESKTOP` rewritten with `messages: [{ at, role }]`, `hover`, `cursorIn`, `clickButton`, `clickSave`, `saved` as two-element arrays, `paneOpen` once, `race`, `rewind`, `morph`, `typing`, `step`, `lines`, `body`; `FIND.word = 'sharing'`; `YOURS` texts replaced (timings still computed); `SOURCES` and `sourceShots` removed.
- `video/src/story.ts`: what the film is about, shared by every scene: the notebook's name, the two kept notes (title, text, type, file name, tags), the other Design notes, and a note's front matter.
- `video/src/scenes/Desktop.tsx` (446 lines, growing) becomes `video/src/scenes/desktop/`:
  - `layout.ts`: the window's geometry.
  - `index.tsx`: the scene, the window, scroll and cursor timeline, captions.
  - `script.tsx`: the messages (bodies zipped with the cues' `messages`, lengths asserted equal), their rows.
  - `Chrome.tsx`: sidebar, composer, Save to notebook button, toast.
  - `Pane.tsx`: the Live Notebook pane: a draft (which note, which type) or the notebook list with one or two notes.
  - `FileCard.tsx`: the `.md` card with typing front matter, and the dimmed card behind it.
- `video/src/scenes/Sources.tsx`: deleted. `Film.tsx` drops it and its doc comment tells the new story.
- `video/src/scenes/Find.tsx`: the three results; the highlighted word comes from `FIND.word`.
- `video/src/scenes/Web.tsx`: notebook rows, the open note's title and text, the dialog's title and file name, `EXPORTED`, the side text, the Yours captions.
- `video/src/scenes/Local.tsx`: folder, file names, subtitle.
- `video/package.json`: the poster frame, a desktop frame just after the second save with both notes in the pane (≈ frame 500).
- `site/index.html`: the length wherever "N seconds" appears (three places), the VideoObject `description` and `duration`, the "What the film shows" list rewritten to the new scenes.
- `README.md`: the poster alt text and the "N-second film" line.
- `docs/DEVELOPMENT.md:42`: the one-line description of what the film draws.

- `docs/media/web-notebook.png`: retaken from the real web notebook, served from a scratch notes folder seeded with the story's notes (`server/notebook-server.mjs --serve --root <scratch> --web ./web`), through Remotion's bundled headless Chrome over the DevTools protocol at 1280×760, scale 2.

Not changed: `kit.tsx`, `theme.ts`, `Root.tsx`, `index.ts`, `EndCard.tsx`, the soundtrack's instruments, `social-preview.png`.

## Verification

1. `cd video && npm install && npm run render && npm run poster`.
2. `ffprobe` the MP4: duration equals `FILM_FRAMES / 30`, 1920×1080, has an AAC track.
3. `remotion still` at the key frames (first save, the rush, the rescue, the two-note pane, the file card; the Yours note with the typed line; the exported file) and look at them: nothing clipped, captions never overlap the window, the pane's text fits its 600px.
4. Read the site's film-script list and the README against the rendered film.
5. The root test suite (`npm test`) is unaffected; nothing in `tests/` covers `video/`.

## After

Open a PR to `main`. Once merged, delete `home-video` (local, `origin`, and its worktree): its only unique content was the older film.

## Out of scope

A voice track, and any change to the Mod or the notebook themselves.
