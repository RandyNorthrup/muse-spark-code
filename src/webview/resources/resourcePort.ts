import type { ComponentType } from 'react'

/** W/M104 bind the checked status channel and host actions; no sampler is started here. */
export interface ResourceSurfacePort {
  /** Cache a snapshot between notifications (React's external-store contract). */
  getSnapshot(): unknown
  subscribe(changed: () => void): () => void
  resume(): void
  settings(): void
  show(): void
  /**
   * Window hosts (M107 pull model): the latest Show resources open the host
   * offered, naming one document's nonce, and the way back for a pull or ack.
   */
  readonly opens?: {
    offered(): { readonly seq: number; readonly nonce: string } | undefined
    send(
      message:
        | { readonly type: 'resourcePull'; readonly nonce: string }
        | { readonly type: 'resourceOpenAck'; readonly seq: number; readonly nonce: string },
    ): void
  }
}

export interface ResourceSurfaceProps {
  readonly port: ResourceSurfacePort
  readonly isInert?: boolean
}

/**
 * A separately delivered lazy surface, sharing the panel's React and language
 * state. Its View is the deferred-surface helper's: an accessible loading row,
 * and its own boundary, so a failed chunk says so in place and offers Try
 * again while the conversation and composer stay mounted.
 */
export interface ResourceSurfaceLoader {
  readonly port: ResourceSurfacePort
  readonly View: ComponentType<
    ResourceSurfaceProps & { readonly label?: string; readonly className?: string }
  >
}
