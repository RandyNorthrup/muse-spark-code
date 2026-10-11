import type { CreateResponseBody, InputItem } from '../../../src/core/backends/modelapi/schemas'

export function metaGoldenBodies() {
  const user: InputItem = {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'Inspect the project.' }],
  }
  const base: CreateResponseBody = {
    model: 'muse-spark-1.3',
    input: [user],
    instructions: 'You are Muse Spark. Use the tools.',
    tools: [
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    reasoning: { effort: 'high', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: 100,
    prompt_cache_key: 'm95-meta-golden',
    prompt_cache_retention: '24h',
  }
  const loop: InputItem[] = [user]
  const scenarios: { readonly name: string; readonly body: CreateResponseBody }[] = [
    { name: 'first-turn', body: base },
  ]
  for (const step of ['one', 'two', 'three']) {
    loop.push(
      {
        type: 'reasoning',
        id: `reason-${step}`,
        encrypted_content: `opaque-${step}`,
        summary: [{ type: 'summary_text', text: `Inspect ${step}` }],
      },
      {
        type: 'function_call',
        id: `item-${step}`,
        call_id: `call-${step}`,
        name: 'read_file',
        arguments: '{"path":"README.md"}',
        status: 'completed',
      },
      { type: 'function_call_output', call_id: `call-${step}`, output: `File ${step}` },
    )
    scenarios.push({ name: `tool-loop-${step}`, body: { ...base, input: [...loop] } })
  }
  scenarios.push(
    {
      name: 'image',
      body: {
        ...base,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'Describe this image.' },
              { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'auto' },
            ],
          },
        ],
      },
    },
    {
      name: 'packed-output',
      body: {
        ...base,
        input: [
          ...loop.slice(0, -1),
          {
            type: 'function_call_output',
            call_id: 'call-three',
            output: 'Packed output. Use recall_output for more. handle=m95-output',
          },
        ],
      },
    },
    {
      name: 'compaction',
      body: {
        ...base,
        tools: [],
        instructions: 'Summarize the conversation for continuation.',
        input: [...loop],
      },
    },
  )

  return scenarios
}
