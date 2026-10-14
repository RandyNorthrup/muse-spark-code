import type { AgentEvent } from '../../shared/agentEvents'
import type { TurnPart } from '../agent/agentBackend'
import { type RenderedPlaybookBrief } from './playbookBrief'

export type PanelDispatchKind = 'subagent' | 'delegate' | 'bestOfN' | 'team' | 'node' | 'watchdog'

export interface PanelPlaybookPort {
  dispatch<T>(
    kind: PanelDispatchKind,
    sessionId: string | undefined,
    targetId: string | undefined,
    effect: (signal: AbortSignal, brief: RenderedPlaybookBrief) => Promise<T>,
  ): Promise<T>
  review(sessionId: string, files: readonly string[]): PanelPlaybookReview
}

export interface PanelPlaybookReview {
  readonly isClosed: boolean
  parts(parts: readonly TurnPart[]): readonly TurnPart[]
  observe(event: AgentEvent): void
  bind(turnId: string): void
  cancel(): void
}
