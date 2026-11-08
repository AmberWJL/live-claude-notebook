/** The types of `export-markdown.mjs`, the notebook export the server and the Mod share. */

export type ExportNote = {
  title: string
  type?: string | null
  /** ISO date-time; only its date is written. */
  created?: string | null
  /** Saved from a whole chat message, not an excerpt or written by hand. */
  fromMessage?: boolean
  content: string
}

export type ExportNotebook = {
  name: string
  tags?: readonly string[]
  notes: readonly ExportNote[]
}

/** The notebook as one markdown text; `date` is when, `YYYY-MM-DD`. */
export function exportMarkdown(notebook: ExportNotebook, date: string): string

/** The notebook as plain text: no heading marks, italics or rules; `date` is when, `YYYY-MM-DD`. */
export function exportPlainText(notebook: ExportNotebook, date: string): string

export type ExportFormat = 'md' | 'txt'

/** The export formats by short name: the extension, the media type, a label for a Save dialog, and the renderer. */
export const EXPORT_FORMATS: Record<
  ExportFormat,
  { extension: string; mime: string; description: string; render: (notebook: ExportNotebook, date: string) => string }
>

/** The format a file name or path asks for: `.txt` is plain text, anything else markdown. */
export function formatOf(name: string): ExportFormat
