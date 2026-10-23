// The Responses body the Anthropic count suites send through the real codec
// (claude-haiku-4-5, one user message, no tools). Shared so they cannot drift.
import type { CreateResponseBody } from '../../../src/core/backends/modelapi/schemas'

export function haikuRequestBody(
  instructions: string,
  maxOutputTokens: number,
): CreateResponseBody {
  return {
    model: 'anthropic/claude-haiku-4-5',
    instructions,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Explain this repository.' }],
      },
    ],
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'none' },
    stream: true,
    store: false,
    include: [],
    prompt_cache_key: '',
    prompt_cache_retention: 'in_memory',
    max_output_tokens: maxOutputTokens,
  }
}
