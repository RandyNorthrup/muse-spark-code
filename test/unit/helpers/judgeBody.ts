import type { CreateResponseBody } from '../../../src/core/backends/modelapi/schemas'

/** Existing M98 normalized main-body fixture shared by dispatch and owned-source suites. */
export function judgeBody(): CreateResponseBody {
  return {
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
}
