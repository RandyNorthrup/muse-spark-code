// The Models panel's sections stay out of the panel body's closure: the
// panel loads them on first paint through the shared deferred boundary,
// which announces loading with a status and retries a failed chunk without
// taking the panel down (the panel error boundary is never the fallback).
// The loading announcement reserves no visible box: it is a visually hidden
// status (absolute, clipped), never the shared overlay placeholder, so the
// content slot paints nothing that the section later replaces (no flash, no
// jump). The visible sequence matches a synchronously rendered panel.
import { UI_TEXT } from '../../shared/constants'
import { deferred } from '../components/DeferredSurface'
import type { SectionProps } from './sections'

/** Loading is said to assistive tech without occupying the section's box. */
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
