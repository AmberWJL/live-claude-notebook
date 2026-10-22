import type { ElementTable, RenderElement } from 'claude-code'

/** The surfaces where a transcript row can be clicked and hovered. */
export type RowSurface = 'terminal' | 'desktop'

export type AssistantBlockModel = {
  surface: RowSurface
  /** The block's markdown, as the engine would draw it. */
  text: string
  /** True on the block that opens a reply: the terminal draws its bullet. */
  isFirstOfReply: boolean
}

export type AssistantBlockActions = {
  /** Drafts this block as a Notebook entry and opens the pane. */
  save: () => void
}

/** The key the block's save button is drawn under; `e.element` at `ui.press`. */
export const SAVE_BUTTON_KEY = 'save'

/**
 * One assistant reply block, drawn as the engine draws it (the terminal's
 * bullet and two-cell gutter, the markdown) with a dim `save to notebook`
 * control under it.
 */
export function renderAssistantBlock(
  els: ElementTable<RowSurface>,
  model: AssistantBlockModel,
  actions: AssistantBlockActions,
): RenderElement {
  const { Box, Text, Button, Markdown } = els
  // Right-aligned under the text, as a secondary button (`variant="secondary"`:
  // the terminal's plain `[ label ]`, the desktop's standard grey button). The
  // keyed Box scopes the hover style: bold under the pointer.
  const body = (
    <Box flexDirection="column" flexGrow={1}>
      <Markdown text={model.text} />
      <Box key={`${SAVE_BUTTON_KEY}-row`} justifyContent="flex-end">
        <Button
          key={SAVE_BUTTON_KEY}
          variant="secondary"
          hover={{ color: 'claude', bold: true }}
          onPress={() => actions.save()}
        >
          Save to notebook
        </Button>
      </Box>
    </Box>
  )
  if (model.surface === 'desktop') return body
  return (
    <Box flexDirection="row">
      <Text color="claude">{model.isFirstOfReply ? '⏺ ' : '  '}</Text>
      {body}
    </Box>
  )
}
