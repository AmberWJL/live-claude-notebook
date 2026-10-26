# Publishing and discovery

What it takes to put Live Notebook where people look for it. Each step needs
an account of yours, so none of them runs from CI or from an agent.

## Done in the repository

- GitHub description and topics (`gh repo edit`), so the repository shows
  for searches like "claude code notes" or "save claude code responses".
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

## Listings

### Claude Code plugin lists

The plugin installs from this repository's marketplace already. Community
lists of Claude Code plugins (awesome-claude-code and the like) take a pull
request with the install command.

## The demo GIF

The README has room for a short demo; `docs/demo-plan.md` has the
storyboard. Record it, save it as `docs/media/demo.gif`, and add it under
the first paragraph.
