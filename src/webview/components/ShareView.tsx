// A local share file open read-only (M84, PLAN.md D49): the file's
// transcript in a modal that can act on nothing. Each item is rendered as its
// section of the Markdown export, so the two read alike. Copying text and
// following links stay; a code block has no Insert or Apply, and nothing here
// reaches a session, an approval or the editor.
//
// The file is anyone's, so its rendering is bounded both ways: the items come
// a page at a time (`SHARE_VIEW_PAGE_ITEMS`, Show more for the next), so a
// file of 20,000 never holds the panel for seconds (RV84 #14), and a section
// that fails to render shows that in its place, never taking the panel down
// with it (RV84c C3).

import { Component, type ReactNode, useState } from 'react'
import type { ItemSnapshot } from '../../shared/agentEvents'
import { transcriptItemMarkdown } from '../../core/export/transcriptMarkdown'
import { SHARE_VIEW_PAGE_ITEMS, UI_TEXT } from '../../shared/constants'
import { backendLabel, fill, formatDateTime, formatNumber } from '../../shared/l10n/text'
import type { BackendKind } from '../../shared/protocol'
import { MarkdownView } from './MarkdownView'
import { Modal } from './Modal'

export interface ShareViewProps {
  readonly title: string
  /** ISO 8601, as the file's schema requires. */
  readonly exportedAt: string
  readonly sourceBackend: BackendKind
  readonly modelId: string
  /** The file's own claim, which anyone can set: shown as its claim, never vouched for. */
  readonly redacted: boolean
  readonly items: readonly ItemSnapshot[]
  readonly onClose: () => void
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
  /** A section that could not be rendered, for the host's log (M39). */
  readonly onSectionError: (error: unknown) => void
}

const SHARE_TITLE_ID = 'share-preview-title'

interface SectionProps {
  readonly item: ItemSnapshot
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
}

/** One item as its section; nothing for an item the panel hides. */
function ShareSection({ item, onOpenLink, onCopy }: SectionProps) {
  const text = transcriptItemMarkdown(item)
  return text === undefined ? null : (
    <section className="share-section">
      <MarkdownView text={text} onOpenLink={onOpenLink} onCopy={onCopy} />
    </section>
  )
}

interface SectionBoundaryProps {
  readonly onError: (error: unknown) => void
  readonly children: ReactNode
}

interface SectionBoundaryState {
  readonly hasFailed: boolean
}

/** Keeps a section's render error in that section: the rest of the file still shows. */
class SectionBoundary extends Component<SectionBoundaryProps, SectionBoundaryState> {
  public static getDerivedStateFromError(): SectionBoundaryState {
    return { hasFailed: true }
  }

  public override state: SectionBoundaryState = { hasFailed: false }

  public override componentDidCatch(error: unknown): void {
    this.props.onError(error)
  }

  public override render(): ReactNode {
    return this.state.hasFailed ? (
      <section className="share-section">
        <p className="share-meta">{UI_TEXT.shareSectionFailed}</p>
      </section>
    ) : (
      this.props.children
    )
  }
}

export function ShareView({
  title,
  exportedAt,
  sourceBackend,
  modelId,
  redacted,
  items,
  onClose,
  onOpenLink,
  onCopy,
  onSectionError,
}: ShareViewProps) {
  // Kept with the items it counts: another file opened over this one starts
  // at its first page again.
  const [page, setPage] = useState({ items, count: SHARE_VIEW_PAGE_ITEMS })
  const shownCount = page.items === items ? page.count : SHARE_VIEW_PAGE_ITEMS
  const meta = fill(UI_TEXT.shareMetaLine, {
    backend: backendLabel(sourceBackend),
    time: formatDateTime(Date.parse(exportedAt)),
  })
  const shown = items.slice(0, shownCount)
  return (
    <Modal title={title} titleId={SHARE_TITLE_ID} isWide onClose={onClose}>
      <p className="share-meta">
        {meta} · {modelId}
      </p>
      <p className="share-meta">
        {redacted
          ? `${UI_TEXT.shareReadOnly} ${UI_TEXT.shareMarkedRedacted}`
          : UI_TEXT.shareReadOnly}
      </p>
      {/* A file's item ids are the sender's and may repeat, so its position is
          part of each section's key; the list only grows at its end. */}
      {shown.map((item, position) => (
        <SectionBoundary key={`${String(position)}:${item.itemId}`} onError={onSectionError}>
          <ShareSection item={item} onOpenLink={onOpenLink} onCopy={onCopy} />
        </SectionBoundary>
      ))}
      {shown.length < items.length ? (
        <div className="share-more">
          <p className="share-meta">
            {fill(UI_TEXT.shareShownCount, {
              shown: formatNumber(shown.length),
              total: formatNumber(items.length),
            })}
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setPage({ items, count: shownCount + SHARE_VIEW_PAGE_ITEMS })
            }}
          >
            {UI_TEXT.shareShowMore}
          </button>
        </div>
      ) : null}
    </Modal>
  )
}
