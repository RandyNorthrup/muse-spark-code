import { lazy, Suspense } from 'react'
import { UI_TEXT } from '../../shared/constants'
import type { ResourcesSectionProps } from './ResourcesSection'

const ResourcesSection = lazy(() => import('./ResourcesSection'))

/** M102's UsageApp mounts this boundary only when its Resources section is opened. */
export function LazyResourcesSection(props: ResourcesSectionProps) {
  return (
    <Suspense fallback={<p role="status">{UI_TEXT.resourceHistory}</p>}>
      <ResourcesSection {...props} />
    </Suspense>
  )
}
