/**
 * One markdown file for a whole notebook, as the web notebook's Export
 * downloads it and the pane's Export writes it: the notebook's name, its
 * tags, when it was exported, then every note under its own heading with a
 * line of facts. Plain JavaScript so the web server (zero dependencies, no
 * build step) and the Mod share one format; `export-markdown.d.mts` types
 * it for the Mod.
 */

/**
 * @param {{
 *   name: string,
 *   tags?: readonly string[],
 *   notes: ReadonlyArray<{ title: string, type?: string | null, created?: string | null, fromMessage?: boolean, content: string }>,
 * }} notebook
 * @param {string} date When it was exported, `YYYY-MM-DD`.
 * @returns {string}
 */
export function exportMarkdown(notebook, date) {
  const tags = notebook.tags ?? []
  const parts = [`# ${notebook.name}`, '']
  if (tags.length > 0) parts.push(tags.map(tag => `#${tag}`).join(' '), '')
  parts.push(`_${exportLine(notebook, date)}_`, '')
  for (const note of notebook.notes) {
    const facts = factsOf(note)
    parts.push('---', '', `## ${note.title}`, '')
    if (facts !== '') parts.push(`_${facts}_`, '')
    parts.push(note.content, '')
  }
  return parts.join('\n')
}

/**
 * The same notebook as plain text: no heading marks, italics or markdown
 * rules around the notes; each note's text stays as it was written.
 *
 * @param {Parameters<typeof exportMarkdown>[0]} notebook
 * @param {string} date When it was exported, `YYYY-MM-DD`.
 * @returns {string}
 */
export function exportPlainText(notebook, date) {
  const tags = notebook.tags ?? []
  const parts = [notebook.name]
  if (tags.length > 0) parts.push(tags.map(tag => `#${tag}`).join(' '))
  parts.push(exportLine(notebook, date), '')
  for (const note of notebook.notes) {
    const facts = factsOf(note)
    parts.push(PLAIN_RULE, '', note.title)
    if (facts !== '') parts.push(facts)
    parts.push('', note.content, '')
  }
  return parts.join('\n')
}

/** The line between notes in the plain-text export. */
const PLAIN_RULE = '-'.repeat(40)

/**
 * The export formats, by the short name the web asks the server for and the
 * pane's Save dialog takes as an extension: markdown first, the default.
 */
export const EXPORT_FORMATS = {
  md: { extension: '.md', mime: 'text/markdown', description: 'Markdown', render: exportMarkdown },
  txt: { extension: '.txt', mime: 'text/plain', description: 'Plain text', render: exportPlainText },
}

/**
 * The format a file name asks for: `.txt` is plain text, anything else
 * markdown, the default.
 *
 * @param {string} name A file name or path.
 * @returns {'md' | 'txt'}
 */
export function formatOf(name) {
  return /\.txt$/i.test(name) ? 'txt' : 'md'
}

/** @param {Parameters<typeof exportMarkdown>[0]} notebook @param {string} date */
function exportLine(notebook, date) {
  const count = notebook.notes.length
  return `Exported from Live Notebook on ${date} · ${count} ${count === 1 ? 'note' : 'notes'}`
}

/** @param {Parameters<typeof exportMarkdown>[0]['notes'][number]} note */
function factsOf(note) {
  return [note.type ?? null, note.created ? `created ${note.created.slice(0, 10)}` : null, note.fromMessage === true ? 'from a message' : null]
    .filter(Boolean)
    .join(' · ')
}
