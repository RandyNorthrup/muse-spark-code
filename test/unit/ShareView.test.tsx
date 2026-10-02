// @vitest-environment jsdom
// The share view (M84) renders a file anyone can write: a page at a time
// (RV84 #14), and a section that fails to render fails alone (RV84c C3).
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShareView } from '../../src/webview/components/ShareView'
import type * as TranscriptMarkdown from '../../src/core/export/transcriptMarkdown'
import type { ItemSnapshot } from '../../src/shared/agentEvents'
import { SHARE_VIEW_PAGE_ITEMS, UI_TEXT } from '../../src/shared/constants'
import { fill, formatNumber } from '../../src/shared/l10n/text'

// One item whose section throws as it renders, as the review's 400 KB share
// file did before its fence was built in a loop.
const FAILING_ITEM_ID = 'boom'

vi.mock('../../src/core/export/transcriptMarkdown', async (importOriginal) => {
  const original = await importOriginal<typeof TranscriptMarkdown>()
  return {
    ...original,
    transcriptItemMarkdown: (item: ItemSnapshot) => {
      if (item.itemId === FAILING_ITEM_ID) {
        throw new RangeError('Maximum call stack size exceeded')
      }
      return original.transcriptItemMarkdown(item)
    },
  }
})

function message(index: number): ItemSnapshot {
  return {
    itemId: `m${String(index)}`,
    kind: index % 2 === 0 ? 'userMessage' : 'agentMessage',
    status: 'completed',
    text: `Message ${String(index)}`,
  }
}

function renderShare(items: readonly ItemSnapshot[]) {
  const onSectionError = vi.fn()
  render(
    <ShareView
      title="Shared over"
      exportedAt="2026-09-28T12:00:00.000Z"
      sourceBackend="modelApi"
      modelId="muse-spark-1.3"
      redacted={false}
      items={items}
      onClose={vi.fn()}
      onOpenLink={vi.fn()}
      onCopy={vi.fn()}
      onSectionError={onSectionError}
    />,
  )
  return { dialog: screen.getByRole('dialog', { name: 'Shared over' }), onSectionError }
}

function sectionCount(dialog: HTMLElement): number {
  return dialog.querySelectorAll('.share-section').length
}

describe('ShareView', () => {
  it('renders a page of a 20,000-item file at first, and the next page on Show more (RV84 #14)', () => {
    const total = 20_000
    const { dialog } = renderShare(Array.from({ length: total }, (_, index) => message(index)))
    expect(sectionCount(dialog)).toBe(SHARE_VIEW_PAGE_ITEMS)
    expect(
      within(dialog).getByText(`Message ${String(SHARE_VIEW_PAGE_ITEMS - 1)}`),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(`Message ${String(SHARE_VIEW_PAGE_ITEMS)}`)).toBeNull()
    expect(
      within(dialog).getByText(
        fill(UI_TEXT.shareShownCount, {
          shown: formatNumber(SHARE_VIEW_PAGE_ITEMS),
          total: formatNumber(total),
        }),
      ),
    ).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.shareShowMore }))
    expect(sectionCount(dialog)).toBe(2 * SHARE_VIEW_PAGE_ITEMS)
  })

  it('shows every item and no Show more when the file fits one page', () => {
    const { dialog } = renderShare([message(0), message(1)])
    expect(sectionCount(dialog)).toBe(2)
    expect(within(dialog).queryByRole('button', { name: UI_TEXT.shareShowMore })).toBeNull()
  })

  it('keeps a section that fails to render to itself, and reports it (RV84c C3)', () => {
    // React reports the caught error on the console; the test only needs the panel.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { dialog, onSectionError } = renderShare([
      message(0),
      { itemId: FAILING_ITEM_ID, kind: 'toolCall', status: 'completed', tool: 't' },
      message(1),
    ])
    quiet.mockRestore()
    expect(within(dialog).getByText('Message 0')).toBeInTheDocument()
    expect(within(dialog).getByText('Message 1')).toBeInTheDocument()
    expect(within(dialog).getByText(UI_TEXT.shareSectionFailed)).toBeInTheDocument()
    expect(onSectionError).toHaveBeenCalledWith(expect.any(RangeError))
  })
})
