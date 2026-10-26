# Live Notebook with Cursor, VS Code, Codex, Gemini CLI and other agents

Live Notebook keeps notes from AI coding sessions as Markdown files in one folder on your computer (`~/.claude/live-notebook/notes/`, or `LIVE_NOTEBOOK_HOME`). Claude Code has its own plugin with a **Save to notebook** button under every reply. Everywhere else, there are three ways in, and you can use any of them together:

| Way | What it does | Word for word? | Where |
|---|---|---|---|
| [The editor extension](#the-editor-extension) | Save the selection or a copied chat reply; search notes | Yes | VS Code, Cursor, Windsurf, VSCodium |
| [The MCP server](#the-mcp-server) | Ask the agent to save or find notes | As the agent passes it | Any MCP agent |
| [The reply inbox](#the-reply-inbox-hooks) | Every reply is kept for you to file from the web notebook | Yes | Agents with hooks |

All three write to the same folder, so the web notebook, the Claude Code plugin and the extension all see every note. None of them sends a note anywhere.

## Install the command

The MCP server and the inbox run through the `live-notebook` command. It needs Node.js 18 or newer:

```bash
npm install -g github:AmberWJL/live-claude-notebook
```

Check it with `live-notebook help`. The same command also saves and searches from a terminal:

```bash
live-notebook save --clipboard -n "Ops"
live-notebook search "retry backoff"
live-notebook open
```

## The editor extension

In VS Code, Cursor, Windsurf or VSCodium:

- **Save a chat reply:** press the reply's Copy button, then run **Live Notebook: Save Clipboard as Note** from the command palette.
- **Save code or text:** select it, right-click, **Save Selection as Note**. Code is saved as a fenced block in its language.
- **Find a note:** **Live Notebook: Search Notes**.
- **Browse and edit:** **Live Notebook: Open Notebook** opens the web notebook.

Until the extension is on the Marketplace and Open VSX, build it and install the file:

```bash
cd extensions/vscode && npm run package
```

Then, in the editor, run **Extensions: Install from VSIX…** and pick `extensions/vscode/live-notebook-0.1.0.vsix`. In Cursor you can also drag the file onto the Extensions view.

No editor lets an extension read another extension's chat, so the extension cannot save a reply by itself: the Copy button plus **Save Clipboard as Note** is the one-step way, and the inbox below is the automatic one.

## The MCP server

`live-notebook mcp` gives the agent four tools: `save_note`, `search_notes`, `read_note` and `list_notebooks`. Then ask in plain words: "save that answer to my notebook under Ops", "what did I save about retries?".

The agent decides what text to send to `save_note`. The tool asks for the text verbatim, and agents usually comply, but for an exact copy use the extension or the inbox.

**Claude Code**

```bash
claude mcp add --scope user live-notebook -- live-notebook mcp
```

**Cursor**: `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{ "mcpServers": { "live-notebook": { "command": "live-notebook", "args": ["mcp"] } } }
```

**VS Code** (Copilot agent mode): run **MCP: Add Server…**, choose **Command (stdio)**, and enter `live-notebook mcp`. Or add to your MCP configuration:

```json
{ "servers": { "live-notebook": { "type": "stdio", "command": "live-notebook", "args": ["mcp"] } } }
```

**Codex**: `~/.codex/config.toml`:

```toml
[mcp_servers.live-notebook]
command = "live-notebook"
args = ["mcp"]
```

**Gemini CLI**: `~/.gemini/settings.json`:

```json
{ "mcpServers": { "live-notebook": { "command": "live-notebook", "args": ["mcp"] } } }
```

**On Windows**, an agent may not find the `live-notebook.cmd` that npm installs; use `"command": "cmd", "args": ["/c", "live-notebook", "mcp"]`.

## The reply inbox (hooks)

An agent's hook can hand every reply to `live-notebook hook`, which keeps the newest 50 in `~/.claude/live-notebook/inbox/`. They show at the top of the web notebook's sidebar under **Inbox**: open one, pick a notebook, **Save as note**, or **Discard**. A saved reply is the agent's text exactly, with which agent wrote it and the project it was in.

This is opt-in: nothing is kept until you add the hook. The inbox is plain files; delete the folder to clear it.

**Cursor**: `~/.cursor/hooks.json`:

```json
{ "version": 1, "hooks": { "afterAgentResponse": [{ "command": "live-notebook hook" }] } }
```

**Claude Code** without the plugin: `~/.claude/settings.json`:

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "live-notebook hook" }] }] } }
```

**Codex**: a `Stop` hook running `live-notebook hook --agent codex` (see [Codex hooks](https://learn.chatgpt.com/docs/hooks) for the file's layout).

**Gemini CLI**: an `AfterAgent` hook running `live-notebook hook` (see [Gemini CLI hooks](https://geminicli.com/docs/hooks/reference/)).

The hook never fails the agent: whatever goes wrong, it exits successfully and prints nothing.

## Privacy

- The MCP tools, the hook and the extension read and write local files only. Nothing is uploaded.
- The agent you use already sees what it wrote; saving a note sends it nowhere new.
- The Claude Code plugin asks a small Claude model to type and tag notes saved in Claude Code. It never does this for notes saved from other agents, unless you set `"ai": "all"` in `~/.claude/live-notebook/settings.json`.
