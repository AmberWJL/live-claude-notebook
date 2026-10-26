# Live Notebook for VS Code and Cursor

Save the useful parts of your AI coding chats, and the code you want to remember, as Markdown notes on your own computer. Search them later from the command palette or in the web notebook.

Works in **VS Code**, **Cursor**, **Windsurf** and **VSCodium**, with any AI chat: GitHub Copilot, Cursor's agent, Claude Code, Cline, and others.

## Save

- **A chat reply:** press the reply's Copy button, then run **Live Notebook: Save Clipboard as Note**. The reply is saved word for word, code blocks included.
- **Code or text in an editor:** select it, right-click, **Save Selection as Note**. Code is saved as a fenced block in its language.

Pick a notebook (or make one) and the note is written to `~/.claude/live-notebook/notes/<Notebook>/` as a plain `.md` file.

## Find

- **Live Notebook: Search Notes** searches every note's title, text and tags as you type, and opens the one you pick.
- **Live Notebook: Open Notebook** opens the web notebook in your browser, to browse, edit, pin, move and export notes.
- **Live Notebook: Show Notes Folder** reveals the folder in Finder or Explorer.

## Your notes stay yours

- Notes are Markdown files in a folder you own. There is no account and no cloud, and the extension sends nothing anywhere.
- The web notebook runs on your computer (127.0.0.1), refuses requests from other websites, and loads nothing from the internet.
- It shares the folder with [Live Notebook for Claude Code](https://github.com/AmberWJL/live-claude-notebook) and the `live-notebook` command, so a note saved in one shows up in the others.

To keep notes somewhere else, set **Live Notebook: Notes Folder** (`liveNotebook.notesFolder`).

## More

Agents that speak MCP (Cursor, Copilot's agent mode, Claude Code, Codex, Gemini CLI) can save and search notes themselves through `live-notebook mcp`. See [the agent setup guide](https://github.com/AmberWJL/live-claude-notebook/blob/main/docs/AGENTS.md).
