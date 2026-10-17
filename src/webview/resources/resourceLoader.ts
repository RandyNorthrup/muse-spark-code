import type { ComponentType } from 'react'
import { deferred } from '../components/DeferredSurface'
import type {
  ResourceSurfaceLoader,
  ResourceSurfacePort,
  ResourceSurfaceProps,
} from './resourcePort'

/** Create at the first governed spawn, outside React render; importing waits for mount. */
export function createResourceSurfaceLoader(
  port: ResourceSurfacePort,
  load: () => Promise<{ default: ComponentType<ResourceSurfaceProps> }>,
): ResourceSurfaceLoader {
  return { port, View: deferred(load) }
}
