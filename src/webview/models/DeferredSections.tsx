// The Models panel's sections stay out of the panel body's closure: the
// panel loads them on first paint through the shared deferred boundary,
// which announces loading with a status and retries a failed chunk without
// taking the panel down (the panel error boundary is never the fallback).
// While a chunk is in flight the slot holds no section and no overlay
// placeholder: only the visually hidden loading announcement (absolute,
// clipped, contributing no box). The first `<section>` the slot paints is
// the real one, so a stand-in box is never swapped for the content box
// (RVMODELSPLIT2 P2: the old reserve painted an empty `<section>` whose
// 0 px box jumped to the content box on commit) and the harness
// `.models-panel section` waiter cannot fire before the content exists
// (RVMODELSPLIT2 P2: wizard scenarios started on the empty reserve and
// threw on the missing "Pick a provider" button). Exact equality between
// a pre-load box and the content box is not achievable here — the content
// height depends on the host state that arrives after mount, which no
// fallback can know — so the slot claims no box at all until commit, and
// the committed section is never replaced (see the layout test).
import { UI_TEXT } from '../../shared/constants'
import { deferred } from '../components/DeferredSurface'
import type { SectionProps } from './sections'

/**
 * Loading paints no section: the slot holds only the visually hidden
 * loading announcement until the real section commits. The marker keeps
 * `data-deferred-loading` so the visual capture still waits out the chunk
 * and assistive tech still hears the loading status.
 */
function SectionLoading() {
  return (
    <p role="status" data-deferred-loading className="models-visually-hidden">
      {UI_TEXT.loadingOutput}
    </p>
  )
}

const ProvidersSurface = deferred(
  async () => {
    const { ProvidersSection } = await import('./ProvidersSection')
    return { default: ProvidersSection }
  },
  false,
  () => <SectionLoading />,
)

const ModelsSurface = deferred(
  async () => {
    const { ModelsSection } = await import('./ModelsSection')
    return { default: ModelsSection }
  },
  false,
  () => <SectionLoading />,
)

export function DeferredProvidersSection(props: SectionProps) {
  return <ProvidersSurface {...props} />
}

export function DeferredModelsSection(props: SectionProps) {
  return <ModelsSurface {...props} />
}
