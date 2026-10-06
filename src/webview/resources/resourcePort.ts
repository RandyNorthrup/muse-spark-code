import type { ComponentType } from 'react'

/** W/M104 bind the checked status channel and host actions; no sampler is started here. */
export interface ResourceSurfacePort {
  getSnapshot(): unknown
  subscribe(changed: () => void): () => void
  resume(): void
  settings(): void
  show(): void
}

export interface ResourceSurfaceProps {
  readonly port: ResourceSurfacePort
  readonly isInert?: boolean
}

/** A separately delivered lazy surface, sharing the panel's React and language state. */
export interface ResourceSurfaceLoader {
  readonly port: ResourceSurfacePort
  load(): Promise<{ default: ComponentType<ResourceSurfaceProps> }>
}
