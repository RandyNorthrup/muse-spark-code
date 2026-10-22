// One first-turn Responses request body for codec tests: the shared
// skeleton (one read tool, auto choice, streamed, unstored, the
// in-memory cache hint) with the per-scenario model, input,
// instructions, effort, includes and budgets filled in.
import type { CreateResponseBody, IncludeField } from '../../../src/core/backends/modelapi/schemas'

export function makeTurnBody(options: {
  readonly model: string
  readonly input: CreateResponseBody['input']
  readonly instructions: string
  readonly toolName: string
  readonly effort: string
  readonly include: readonly IncludeField[]
  readonly maxOutputTokens: number
  readonly promptCacheKey: string
}): CreateResponseBody {
  return {
    model: options.model,
    input: options.input,
    instructions: options.instructions,
    tools: [
      {
        type: 'function',
        name: options.toolName,
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: options.effort, summary: 'auto' },
    stream: true,
    store: false,
    include: options.include,
    max_output_tokens: options.maxOutputTokens,
    prompt_cache_key: options.promptCacheKey,
    prompt_cache_retention: 'in_memory',
  }
}
