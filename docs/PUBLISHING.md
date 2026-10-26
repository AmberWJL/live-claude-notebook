# Publishing and discovery

What it takes to put Live Notebook where people look for it. Each step needs
an account of yours, so none of them runs from CI or from an agent.

## Done in the repository

- GitHub description and topics (`gh repo edit`), so the repository shows
  for searches like "claude code notes", "cursor markdown notes", "mcp
  notes server".
- The landing page and guides in `site/`, published to
  `https://amberwjl.github.io/live-claude-notebook/` by
  `.github/workflows/pages.yml` on every push to `main` that touches them.
  It has a sitemap, canonical URLs, Open Graph tags and a
  `SoftwareApplication` description for search engines.
- `docs/media/web-notebook.png` (README and site) and
  `docs/media/social-preview.png` (link previews).

## After the first Pages deploy

1. **Homepage link.** Once the site is live:

   ```bash
   gh repo edit AmberWJL/live-claude-notebook --homepage https://amberwjl.github.io/live-claude-notebook/
   ```

2. **Social preview.** GitHub has no API for it: Settings → General →
   Social preview → Upload `docs/media/social-preview.png`. Links to the
   repository then show the card instead of a generated one.

3. **Google Search Console.** Search Console can only verify a site you
   control, which here is the Pages site, not github.com:
   - Add a **URL-prefix** property for
     `https://amberwjl.github.io/live-claude-notebook/`.
   - Choose **HTML file** verification, put the file Google gives you in
     `site/`, push to `main`, and press Verify. (The domain-wide property
     for `amberwjl.github.io` needs DNS, which GitHub owns; the URL-prefix
     one does not.)
   - Submit `https://amberwjl.github.io/live-claude-notebook/sitemap.xml`
     under Sitemaps, and request indexing for the home page.
   - Being indexed is not ranking: expect the site to show for its exact
     name first, and for the guides' searches as people link to it.

## Packages

### npm (the `live-notebook` command)

Until then, people install from GitHub (`npm install -g
github:AmberWJL/live-claude-notebook`), which works without publishing.
The name `live-notebook` was free on npm on 2026-10-26.

1. `npm login`.
2. In `package.json`, remove `"private": true` (it is there so nothing is
   published by accident).
3. `npm publish --dry-run` and check the file list (the `files` field keeps
   it to the command, the server, the core and the page, about 2.5 MB).
4. `npm publish`. Then the docs can say `npm install -g live-notebook`.

### VS Code Marketplace (the extension)

1. Create a publisher at <https://marketplace.visualstudio.com/manage>
   with the ID in `extensions/vscode/package.json` (`amberwjl`), or change
   that field to yours. The ID cannot be changed later.
2. Sign in for publishing. Microsoft retires global personal access tokens
   on 2026-12-01; use `vsce login` with Microsoft Entra ID
   (`npx @vscode/vsce publish --azure-credential`, vsce 2.26.1 or newer) or
   a PAT scoped to Marketplace (Manage).
3. Add a 128×128 PNG icon (`"icon"` in the manifest); the Marketplace
   rejects SVG icons.
4. `cd extensions/vscode && npm run package`, try the `.vsix` with
   **Extensions: Install from VSIX…**, then `npx @vscode/vsce publish`.

### Open VSX (Cursor, Windsurf, VSCodium)

Cursor and the others install from Open VSX, not the Marketplace.

1. Create an Eclipse account with your GitHub user name, sign in at
   <https://open-vsx.org> with GitHub, link the Eclipse account, and sign
   the Publisher Agreement.
2. Create an access token in your Open VSX settings.
3. `npx ovsx create-namespace amberwjl -p <token>` (once), then
   `npx ovsx publish extensions/vscode/live-notebook-0.1.0.vsix -p <token>`.
4. To show as a verified publisher, claim the namespace (an issue on the
   Open VSX repository).

### MCP registries

- The official MCP registry (<https://registry.modelcontextprotocol.io>)
  lists servers published to npm: publish to npm first, add a
  `server.json`, and run its `mcp-publisher`.
- Directories that take a GitHub link (awesome-mcp-servers lists and
  similar) need only the repository URL and one line: "Save and search
  Markdown notes from any MCP agent; local files only."

### Claude Code plugin lists

The plugin installs from this repository's marketplace already. Community
lists of Claude Code plugins (awesome-claude-code and the like) take a pull
request with the install command.

## The demo GIF

The README has room for a short demo; `docs/demo-plan.md` has the
storyboard. Record it, save it as `docs/media/demo.gif`, and add it under
the first paragraph.
