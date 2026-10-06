import type { ToolArgumentPreview as Preview } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { Clipped } from './ToolBlocks'

/** Escaped text only: a preview has no file opener, approval or tool action. */
export function ToolArgumentPreview({ preview }: { readonly preview: Preview }) {
  return (
    <section className="tool-detail" aria-label={UI_TEXT.toolArgumentPreviewLabel}>
      <span className="shell-label">{UI_TEXT.toolArgumentPreviewLabel}</span>
      {preview.text === '' ? null : <Clipped text={preview.text} className="tool-output" />}
      <p className="tool-detail-meta" role="status">
        {UI_TEXT.toolArgumentPreviewPending}
      </p>
      {preview.truncated ? (
        <p className="tool-detail-meta">{UI_TEXT.toolArgumentPreviewTruncated}</p>
      ) : null}
    </section>
  )
}
