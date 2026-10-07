// Offline canonical inputs for M95's Meta wire regression. Expected bytes
// come from the client at main 1e93c67c, never the current client under test.
import {
  MODEL_API_MODEL_TEXT,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
} from '../../../src/shared/constants'
import { ObservationPack } from '../../../src/core/backends/modelapi/observationPack'
import type { CreateResponseBody, InputItem } from '../../../src/core/backends/modelapi/schemas'
import { TINY_PNG_BASE64 } from './fakeModelApi'

function message(text: string): InputItem {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
}

function request(input: InputItem[]): CreateResponseBody {
  return {
    model: 'muse-spark-1.3',
    input,
    instructions: 'Be brief and verify your edits.',
    tools: [
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a workspace file.',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'high', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 100,
    prompt_cache_key: 'meta-golden-session',
    prompt_cache_retention: 'in_memory',
  }
}

export function metaGoldenRequests(): readonly {
  readonly name: string
  readonly body: CreateResponseBody
}[] {
  const first = [message('Inspect the file and explain the next edit.')]
  const loop = [...first]
  for (const round of [0, 1, 2]) {
    loop.push(
      {
        type: 'reasoning',
        id: `reasoning-${String(round)}`,
        summary: [{ type: 'summary_text', text: 'Inspect before changing.' }],
        encrypted_content: `synthetic-thinking-${String(round)}`,
      },
      {
        type: 'function_call',
        call_id: `call-${String(round)}`,
        name: 'read_file',
        arguments: JSON.stringify({ path: `file-${String(round)}.ts` }),
      },
      {
        type: 'function_call_output',
        call_id: `call-${String(round)}`,
        output: `export const value = ${String(round)}`,
      },
    )
  }
  const pack = new ObservationPack()
  const longOutput: InputItem[] = [
    ...loop,
    {
      type: 'function_call_output',
      call_id: 'large',
      output: 'line\n'.repeat(OBS_PACK_THRESHOLD_CHARS),
    },
  ]
  for (let sent = 0; sent < OBS_PACK_WHOLE_SENDS; sent += 1) {
    pack.noteSent(pack.project(longOutput))
  }
  // M101 C1 intentionally re-baselines compaction; ordinary requests retain 1e93c67c bytes.
  const compact = request([...loop, message(MODEL_API_MODEL_TEXT.compactionPrompt)])
  return [
    { name: 'first-turn', body: request(first) },
    { name: 'tool-loop', body: request(loop) },
    {
      name: 'image',
      body: request([
        ...first,
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${TINY_PNG_BASE64}`,
              detail: 'auto',
            },
          ],
        },
      ]),
    },
    { name: 'packed-output', body: request(pack.project(longOutput)) },
    { name: 'compaction', body: compact },
  ]
}
