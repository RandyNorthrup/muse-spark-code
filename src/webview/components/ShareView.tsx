// A local share file open read-only (M84, PLAN.md D49): the file's
// transcript in a modal that can act on nothing. Each item is rendered as its
// section of the Markdown export, so the two read alike. Copying text and
// following links stay; a code block has no Insert or Apply, and nothing here
// reaches a session, an approval or the editor.

import type { ItemSnapshot } from '../../shared/agentEvents'
import { transcriptItemMarkdown } from '../../core/export/transcriptMarkdown'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime } from '../../shared/l10n/text'
import { backendLabel } from '../../shared/palette'
import type { BackendKind } from '../../shared/protocol'
import { MarkdownView } from './MarkdownView'
import { Modal } from './Modal'

export interface ShareViewProps {
  readonly title: string
  /** ISO 8601, as the file's schema requires. */
  readonly exportedAt: string
  readonly sourceBackend: BackendKind
  readonly modelId: string
  readonly redacted: boolean
  readonly items: readonly ItemSnapshot[]
  readonly onClose: () => void
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
}

const SHARE_TITLE_ID = 'share-preview-title'

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
}: ShareViewProps) {
  const meta = fill(UI_TEXT.shareMetaLine, {
    backend: backendLabel(sourceBackend),
    time: formatDateTime(Date.parse(exportedAt)),
  })
  // A file's item ids are the sender's and may repeat, so its position is
  // part of each section's key; the list is rendered once and never reordered.
  const sections = items.flatMap((item, position) => {
    const text = transcriptItemMarkdown(item)
    return text === undefined ? [] : [{ key: `${String(position)}:${item.itemId}`, text }]
  })
  return (
    <Modal title={title} titleId={SHARE_TITLE_ID} isWide onClose={onClose}>
      <p className="share-meta">
        {meta} · {modelId}
      </p>
      <p className="share-meta">
        {redacted ? `${UI_TEXT.shareReadOnly} ${UI_TEXT.shareRedacted}` : UI_TEXT.shareReadOnly}
      </p>
      {sections.map((section) => (
        <section key={section.key} className="share-section">
          <MarkdownView text={section.text} onOpenLink={onOpenLink} onCopy={onCopy} />
        </section>
      ))}
    </Modal>
  )
}
