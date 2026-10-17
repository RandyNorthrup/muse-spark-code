import type { ToolArgumentPreview as Preview } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { formatBytes } from '../../shared/l10n/text'
import { Clipped } from './ToolBlocks'

/** Escaped text only: a preview has no file opener, approval or tool action. */
export function ToolArgumentPreview({ preview }: { readonly preview: Preview | undefined }) {
  if (preview === undefined) return null
  return (
    <section className="tool-detail" aria-label={UI_TEXT.toolArgumentPreviewLabel}>
      <span className="shell-label">{UI_TEXT.toolArgumentPreviewLabel}</span>
      {preview.text === '' ? null : <Clipped text={preview.text} className="tool-output" />}
      <p className="tool-detail-meta" role="status">
        {preview.frozen === true
          ? UI_TEXT.toolArgumentPreviewPreparing
          : UI_TEXT.toolArgumentPreviewPending}
      </p>
      {preview.bytes === undefined ? null : (
        <p className="tool-detail-meta">{formatBytes(preview.bytes)}</p>
      )}
      {preview.truncated ? (
        <p className="tool-detail-meta">{UI_TEXT.toolArgumentPreviewTruncated}</p>
      ) : null}
    </section>
  )
}
