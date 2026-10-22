// Shared judge fixtures: M90's captured approval envelope and the Model API
// judge request body, so the review and transport suites stop copying them.
import type { CreateResponseBody } from '../../../src/core/backends/modelapi/schemas'
import { mapNotification } from '../../../src/core/backends/musecode/mapNotification'
import type { AgentEvent } from '../../../src/shared/agentEvents'
import { raceRequested } from './stageRaceCapture'

export type CapturedApproval = Extract<AgentEvent, { type: 'approvalRequested' }>

/** M90's named live capture; no new MSP field or shape invented here. */
export function capturedApproval(): CapturedApproval {
  const params = raceRequested('s1')
  params['turnId'] = 't1'
  const mapped = mapNotification({ params, method: 'approval/requested' })
  if (
    typeof mapped !== 'string' &&
    'event' in mapped &&
    mapped.event.type === 'approvalRequested'
  ) {
    return mapped.event
  }
  throw new Error('captured approval did not map')
}

/** The Model API judge request body the transport suites send. */
export const JUDGE_MODEL_API_BODY: CreateResponseBody = {
  model: 'muse-spark-1.3',
  instructions: '',
  tools: [],
  input: [],
  tool_choice: 'auto',
  reasoning: { effort: 'medium', summary: 'auto' },
  stream: true,
  store: false,
  include: [],
  max_output_tokens: 100,
  prompt_cache_key: 'judge',
  prompt_cache_retention: 'in_memory',
}
