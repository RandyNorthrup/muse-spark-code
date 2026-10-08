import { lazy, type ComponentType } from 'react'

/** W/M104 bind the checked status channel and host actions; no sampler is started here. */
export interface ResourceSurfacePort {
  /** Cache a snapshot between notifications (React's external-store contract). */
  getSnapshot(): unknown
  subscribe(changed: () => void): () => void
  resume(): void
  settings(): void
  show(): void
}

export interface ResourceSurfaceProps {
  readonly port: ResourceSurfacePort
  readonly isInert?: boolean
  /** Each increase opens the popover (the window's Show resources command). */
  readonly openRequest?: number
}

/** A separately delivered lazy surface, sharing the panel's React and language state. */
export interface ResourceSurfaceLoader {
  readonly port: ResourceSurfacePort
  readonly View: ComponentType<ResourceSurfaceProps>
}

/** Create at the first governed spawn, outside React render; importing waits for mount. */
export function createResourceSurfaceLoader(
  port: ResourceSurfacePort,
  load: () => Promise<{ default: ComponentType<ResourceSurfaceProps> }>,
): ResourceSurfaceLoader {
  return { port, View: lazy(load) }
}
