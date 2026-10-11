// M105-A's lazy sound surface. E1/C bind it through AttachmentChips.renderAudio
// after W admits the optional chunk or packages a separately budgeted page.
import { lazy, Suspense } from 'react'
import type { AudioAction, AudioRouteOptions } from '../../shared/audioRouting'
import type { AttachmentSummary } from '../../shared/protocol'

const AudioAttachmentActions = lazy(() => import('./AudioAttachmentActions'))

export function AttachmentSound({
  attachment,
  options,
  onAction,
}: {
  readonly attachment: AttachmentSummary
  readonly options: AudioRouteOptions
  readonly onAction: (id: string, action: AudioAction) => void
}) {
  return (
    <>
      {options.warning !== undefined && <span role="note">{options.warning}</span>}
      {options.actions.length > 0 && (
        <Suspense fallback={null}>
          <AudioAttachmentActions
            options={options}
            selected={attachment.media?.audioAction ?? options.defaultAction}
            onAction={(action) => {
              onAction(attachment.id, action)
            }}
          />
        </Suspense>
      )}
    </>
  )
}
