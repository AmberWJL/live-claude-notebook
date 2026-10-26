# Live Notebook demo: video and GIF plan

Two deliverables, one recording session:

| Piece | Length | Where it goes |
| --- | --- | --- |
| Hero GIF | 20–30 s, silent, loops | Top of the README, under the title |
| Walkthrough video | 2–3 min, with voice or captions | GitHub release / README link / social |
| Three feature GIFs (optional) | 8–12 s each | README sections they illustrate |

Record the long video first. Every GIF is a trimmed cut of it, so you only
set up once.

## 1. Set up the stage (15 min)

- **App**: Claude desktop app, Code tab, in a small sample project (a few
  files, not this repo). The desktop app records cleaner than the terminal.
- **Window**: 1440×900 or 1600×1000. Hide the sidebar. One pane only.
- **Theme**: pick one and keep it. Light reads better in GIFs on GitHub;
  dark looks nicer in video. Avoid switching mid-recording.
- **Seed data**: have two notebooks with 3–4 notes each already saved
  (e.g. `Work` and `Learning`), so the pane and the web page never look
  empty. One note pinned, one of each type, so the filters show something.
- **Fresh session**: start a new session so the transcript is empty.
- **Prepared prompt**: something that yields a short, visibly useful reply,
  for example "Explain the difference between `git rebase` and `git merge`
  in five lines" or "Give me a bash one-liner to find large files".
  Short replies keep the Save button on screen.
- **Hide anything private**: file names, API keys, other sessions.
- **Mouse**: slow, deliberate moves. Pause 1 s on every new screen before
  the next click. Those pauses are what the GIF viewer needs.

## 2. Storyboard: the walkthrough video (2–3 min)

Each shot has what you do and the line you say (or caption).

| # | Time | Action | Line |
| --- | --- | --- | --- |
| 1 | 0:00 | Title card: logo/name, one sentence | "Live Notebook keeps the useful parts of your Claude Code conversations." |
| 2 | 0:05 | Type the prepared prompt, Claude replies | "You ask Claude something useful…" |
| 3 | 0:15 | Hover the dim **Save to notebook**, press it | "…and under every reply there's a Save button." |
| 4 | 0:20 | Capture page: show title field, notebook picker, type picker. Type a title, pick `Learning`, press **Save** | "Give it a title, pick a notebook, Save. Nothing is stored until you do." |
| 5 | 0:35 | The "Saved to…" line appears. Wait for the type mark and tags to fill in | "A moment later it gets a type and tags, so you can filter later." |
| 6 | 0:45 | Select a few lines of the reply, run `/save` | "Only need part of a reply? Select it and run /save." |
| 7 | 0:55 | Run `/notebook`. Scroll the home page, click a type filter, type a search word | "/notebook opens your notebook. Search as you type, filter by type." |
| 8 | 1:10 | Click a note, show the read-only view, press **Edit**, change a word, **Save** | "Open a note, edit it in place." |
| 9 | 1:25 | Press **Open in web** | "Or take it to the browser." |
| 10 | 1:30 | Web notebook: edit a heading, show it render, wait, switch back to the pane to show the change arrived | "Edits save on their own and show up back in Claude Code." |
| 11 | 1:45 | Right-click a note → Pin. Drag a note to the other notebook | "Pin what matters, drag notes between notebooks." |
| 12 | 1:55 | Export a notebook, show the markdown file in Finder or an editor | "Everything is plain markdown on your disk, so export or open it anywhere." |
| 13 | 2:10 | End card with the install command | "Install with one command. Link in the description." |

Record at normal speed. Speed-ups happen in editing.

## 3. The hero GIF (cut from shots 2–7)

Goal: someone scrolling GitHub understands the product in one loop.

1. Prompt and reply (2 s, start on the reply already on screen)
2. Press **Save to notebook** (3 s)
3. Capture page, press **Save** (4 s)
4. `/notebook`, search, click the note (6 s)
5. **Open in web**, web notebook appears (4 s)
6. Hold 1 s, loop

Target 20–25 s, under 10 MB. Add a one-line caption overlay per step
("1 · Save a reply", "2 · Find it", "3 · Edit on the web") if the tool
supports it.

## 4. Feature GIFs (optional, 8–12 s each)

| GIF | Cut from | Shows |
| --- | --- | --- |
| `save-selection.gif` | shot 6 | select text → `/save` → capture page |
| `search-and-filter.gif` | shot 7 | type a search, press a filter |
| `web-notebook.gif` | shots 10–11 | edit, pin, drag |

Reference each one from the README section it belongs to.

## 5. Tools

**Recording**: macOS built-in (`⌘⇧5`, choose "Record Selected Portion")
records to `.mov`. Kap or CleanShot X are nicer: they trim and export GIF
directly.

**Video editing**: iMovie or CapCut. Trim, cut dead time, add captions,
export 1080p H.264.

**GIF from a .mov** (ffmpeg + gifski gives the best quality per MB):

```bash
brew install ffmpeg gifski
```

```bash
ffmpeg -i hero.mov -ss 00:00:12 -t 24 -vf "fps=12,scale=1200:-1" frames/%04d.png
```

```bash
gifski --fps 12 --quality 80 -o docs/media/demo.gif frames/*.png
```

Lower `scale` to 1000 or `fps` to 10 if the file is over 10 MB.

## 6. Before you hit record

- [ ] New session, empty transcript, sidebar hidden
- [ ] Seed notebooks and notes in place, one note pinned
- [ ] Web notebook opened once already (editor is cached, no blank page)
- [ ] Prompt text copied to the clipboard
- [ ] Notifications off (Do Not Disturb)
- [ ] Nothing private visible
- [ ] Do a 30-second test recording and check the frame

## 7. Pitfalls

- Type and tags arrive a few seconds after Save. Either wait on camera
  (it reads as "magic") or cut the wait in editing. Don't click away early.
- The capture editor's cursor moves with the mouse; keep the pointer out
  of the editor while narrating so the viewer isn't distracted.
- If the web page loads blank, you are offline or the editor is not
  cached. Open it once before recording.
- Keep each GIF to one idea. If you need a caption to explain it, the GIF
  is too long.

## 8. After recording

1. Put the files in `docs/media/` (`demo.gif`, `walkthrough.mp4` or a
   YouTube link).
2. In the README, replace the HTML comment under the title with
   `![Live Notebook demo](docs/media/demo.gif)`.
3. Add the video link right under the GIF: `[Watch the 2-minute walkthrough](…)`.
4. Commit the GIF with the README change so the image shows on GitHub.
