// The Models panel's sections stay out of the panel body's closure: the
// panel loads them on first paint through the shared deferred boundary,
// which announces loading with a status and retries a failed chunk without
// taking the panel down (the panel error boundary is never the fallback).
import { deferred } from '../components/DeferredSurface'
import type { SectionProps } from './sections'

const ProvidersSurface = deferred(async () => {
  const { ProvidersSection } = await import('./ProvidersSection')
  return { default: ProvidersSection }
}, false)

const ModelsSurface = deferred(async () => {
  const { ModelsSection } = await import('./ModelsSection')
  return { default: ModelsSection }
}, false)

export function DeferredProvidersSection(props: SectionProps) {
  return <ProvidersSurface {...props} />
}

export function DeferredModelsSection(props: SectionProps) {
  return <ModelsSurface {...props} />
}
