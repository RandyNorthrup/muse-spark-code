// Fake-only browser harness for E3's lazy controls and accessibility receipts.
import { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { CompanionMedia } from '../../../../src/webview/media/entry'
import { companionMediaTransport } from '../../../../src/webview/media/transport'
import { UI_TEXT } from '../../../../src/shared/constants'
import type { BrowserRecordingPreview } from '../../../../src/webview/media/recordingPort'

export const COMPANION_BROWSER_ENTRY = 'test/unit/helpers/media/companionBrowser.tsx'

function mount() {
  const container = document.querySelector('#root')
  if (!(container instanceof HTMLElement)) throw new Error('Missing harness root')
  createRoot(container).render(
    <Suspense fallback={<p>{UI_TEXT.loadingOutput}</p>}>
      <CompanionMedia
        attachmentEpoch={0}
        onAttached={() => {
          container.dataset['attached'] = 'true'
        }}
        transport={companionMediaTransport(() => ({
          endpoint: `${location.origin}/upload`,
          origin: location.origin,
          bearer: 'test-window-token',
          customHeader: { name: 'x-muse-guard', value: '1' },
          metadataHeader: 'x-muse-media',
        }))}
        recorder={{
          available: () => ({ ok: true }),
          start: (_options, countdown) => {
            const result = Promise.withResolvers<BrowserRecordingPreview>()
            countdown(10)
            return Promise.resolve({
              result: result.promise,
              stop: () => {
                result.resolve({
                  name: 'recording.mp4',
                  blob: new Blob(['fake-preview'], { type: 'video/mp4' }),
                  dispose: () => {
                    container.dataset['disposed'] = 'true'
                  },
                })
              },
              cancel: () => {
                result.reject(new Error('Fake capture cancelled'))
              },
            })
          },
        }}
      />
    </Suspense>,
  )
}

if (typeof document !== 'undefined') mount()
