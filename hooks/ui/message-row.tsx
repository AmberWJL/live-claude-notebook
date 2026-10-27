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

/** The accent's faint wash behind the desktop's save pill under the pointer. */
const PILL_HOVER_BACKGROUND = '#d977571f'

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
  // Right-aligned under the text. On a desktop, an outlined pill: a faint
  // accent outline and a dim label at rest; under the pointer the outline and
  // the label take the accent and a faint wash fills it (the keyed Box is the
  // hover scope). On the terminal, a secondary button, `[ label ]`, bold in
  // the accent under the pointer: a bordered Box there would take three rows
  // under every reply.
  const button =
    model.surface === 'desktop' ? (
      <Box
        key={`${SAVE_BUTTON_KEY}-pill`}
        borderStyle="round"
        borderColor="claude"
        borderDimColor
        hover={{ borderColor: 'claude', borderDimColor: false, backgroundColor: PILL_HOVER_BACKGROUND }}
      >
        <Button key={SAVE_BUTTON_KEY} plain dimColor hover={{ color: 'claude', dimColor: false }} onPress={() => actions.save()}>
          Save to notebook
        </Button>
      </Box>
    ) : (
      <Button key={SAVE_BUTTON_KEY} variant="secondary" hover={{ color: 'claude', bold: true }} onPress={() => actions.save()}>
        Save to notebook
      </Button>
    )
  const body = (
    <Box flexDirection="column" flexGrow={1}>
      <Markdown text={model.text} />
      <Box key={`${SAVE_BUTTON_KEY}-row`} justifyContent="flex-end">
        {button}
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
