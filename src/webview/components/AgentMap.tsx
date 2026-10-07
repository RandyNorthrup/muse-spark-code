import { deferred } from './DeferredSurface'
import type { AgentMapProps } from './AgentMapContent'
export type { AgentMapProps } from './AgentMapContent'

export const AgentMap = deferred<AgentMapProps>(async () => {
  const module = await import('./AgentMapContent')
  return { default: module.AgentMapContent }
}, true)
