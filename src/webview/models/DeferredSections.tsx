// The Models panel's sections stay out of the panel body's closure: the
// panel loads them on first paint through the shared deferred boundary,
// which announces loading with a status and retries a failed chunk without
// taking the panel down (the panel error boundary is never the fallback).
// The loading reserve is the section's own element with its final name,
// never the shared overlay placeholder, and its announcement is visually
// hidden (absolute, clipped): the slot's section box exists before the
// chunk arrives and is never overlaid or replaced (no flash, no jump).
import { UI_TEXT } from '../../shared/constants'
import { deferred } from '../components/DeferredSurface'
import type { SectionProps } from './sections'

/**
 * Loading keeps the section's own element: the slot holds a `<section>`
 * with the section's final accessible name before the chunk arrives and
 * the same element after it commits, so no overlay is ever painted and
 * replaced. The announcement is visually hidden (absolute, clipped) and
 * the region is marked busy, so the reserve occupies no visible box.
 */
function SectionLoading({ label }: { readonly label: string }) {
  return (
    <section aria-label={label} aria-busy="true">
      <p role="status" data-deferred-loading className="models-visually-hidden">
        {UI_TEXT.loadingOutput}
      </p>
    </section>
  )
}

const ProvidersSurface = deferred(
  async () => {
    const { ProvidersSection } = await import('./ProvidersSection')
    return { default: ProvidersSection }
  },
  false,
  () => <SectionLoading label={UI_TEXT.providersSectionTitle} />,
)

const ModelsSurface = deferred(
  async () => {
    const { ModelsSection } = await import('./ModelsSection')
    return { default: ModelsSection }
  },
  false,
  () => <SectionLoading label={UI_TEXT.modelsSectionTitle} />,
)

export function DeferredProvidersSection(props: SectionProps) {
  return <ProvidersSurface {...props} />
}

export function DeferredModelsSection(props: SectionProps) {
  return <ModelsSurface {...props} />
}
