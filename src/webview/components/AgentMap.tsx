// App's deferred modal owns loading, failure, retry and dismissal.
import { createElement, lazy } from 'react'
import type { AgentMapProps } from './AgentMapContent'
export type { AgentMapProps } from './AgentMapContent'
const Content = lazy(() => import('./AgentMapContent'))
export function AgentMap(props: AgentMapProps) {
  return createElement(Content, props)
}
