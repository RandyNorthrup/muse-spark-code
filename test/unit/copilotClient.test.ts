import { setTimeout as pause } from 'node:timers/promises'
import type * as vscode from 'vscode'
import { describe, expect, it, vi } from 'vitest'
import {
  connectCopilotFromClick,
  type CopilotClientDeps,
  type CopilotPort,
} from '../../src/host/providers/copilotClient'
import {
  streamEventSchema,
  type CreateResponseBody,
} from '../../src/core/backends/modelapi/schemas'

class Text implements vscode.LanguageModelTextPart {
  public constructor(public value: string) {}
}
class Call implements vscode.LanguageModelToolCallPart {
  public constructor(
    public callId: string,
    public name: string,
    public input: object,
  ) {}
}
class Result implements vscode.LanguageModelToolResultPart {
  public constructor(
    public callId: string,
    public content: unknown[],
  ) {}
}
function message(
  role: vscode.LanguageModelChatMessageRole,
  text: string,
): vscode.LanguageModelChatMessage {
  return { role, content: text === '' ? [] : [new Text(text)], name: undefined }
}
function body(): CreateResponseBody {
  return {
    model: 'copilot/synthetic-model',
    instructions: 'stable instructions',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    tools: [
      {
        type: 'function',
        name: 'read_file',
        description: 'read',
        parameters: { type: 'object' },
        strict: false,
      },
    ],
    tool_choice: 'auto',
    max_output_tokens: 100,
    stream: true,
    store: false,
    reasoning: { effort: 'low', summary: 'auto' },
    include: ['reasoning.encrypted_content'],
    prompt_cache_key: 'stable',
    prompt_cache_retention: '24h',
  }
}
function rig(parts: readonly unknown[] = [new Text('answer')]) {
  let isConfidential = false
  let isUserInitiated = true
  let access: boolean | undefined
  const cancel = vi.fn()
  const dispose = vi.fn()
  const token: vscode.CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  }
  const model: vscode.LanguageModelChat = {
    id: 'synthetic-model',
    name: 'Synthetic Model',
    vendor: 'copilot',
    family: 'synthetic',
    version: '1',
    maxInputTokens: 1000,
    countTokens: vi.fn(() => Promise.resolve(2)),
    sendRequest: vi.fn(() =>
      Promise.resolve({
        stream: (async function* () {
          await pause(0)
          for (const part of parts) yield part
        })(),
        text: (async function* () {
          await pause(0)
          yield 'answer'
        })(),
      }),
    ),
  }
  const api: CopilotPort = {
    selectChatModels: vi.fn(() => Promise.resolve([model])),
    user: (text) => message(1, text),
    assistant: (text) => message(2, text),
    text: (text) => new Text(text),
    call: (id, name, input) => new Call(id, name, input),
    result: (id, content) => new Result(id, content),
    cancellation: () => ({ token, cancel, dispose }),
    isText: (part): part is vscode.LanguageModelTextPart => part instanceof Text,
    isCall: (part): part is vscode.LanguageModelToolCallPart => part instanceof Call,
  }
  const deps: CopilotClientDeps = {
    api,
    justification: () => 'Synthetic translated reduced/credit notice',
    failureText: (code) => `translated.${code}`,
    isConfidential: () => isConfidential,
    isUserInitiated: () => isUserInitiated,
    canSendRequest: () => access,
    recordEstimatedUsage: vi.fn(),
  }
  return {
    model,
    api,
    deps,
    cancel,
    dispose,
    confidential: (isEnabled: boolean) => {
      isConfidential = isEnabled
    },
    userInitiated: (isEnabled: boolean) => {
      isUserInitiated = isEnabled
    },
    access: (isEnabled: boolean) => {
      access = isEnabled
    },
  }
}
async function client(tester: ReturnType<typeof rig>) {
  const clients = await connectCopilotFromClick(tester.deps)
  expect(clients).toHaveLength(1)
  return clients[0]!
}
async function run(
  tester: ReturnType<typeof rig>,
  request = body(),
  signal = new AbortController().signal,
) {
  const connected = await client(tester)
  const events = []
  for await (const event of connected.streamResponse(request, signal)) {
    expect(streamEventSchema.safeParse(event).success).toBe(true)
    events.push(event)
  }
  return events
}

describe('Copilot VS Code client', () => {
  it('selects only from the click, marks the client reduced/plan/estimated, and does not request in the background', async () => {
    const tester = rig()
    expect(tester.api.selectChatModels).not.toHaveBeenCalled()
    const connected = await client(tester)
    expect(tester.api.selectChatModels).toHaveBeenCalledWith({ vendor: 'copilot' })
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
    expect(connected).toMatchObject({
      providerId: 'copilot',
      reduced: true,
      pricing: 'plan',
      usageAccuracy: 'estimated',
      cacheControl: false,
      reasoningReplay: false,
    })
    await expect(connected.listModels()).resolves.toEqual(['synthetic-model'])
  })

  it('maps instructions to the first user message and preserves ordered tool calls/results without reasoning replay', async () => {
    const tester = rig([new Text('Checking'), new Call('call-1', 'read_file', { path: 'a.ts' })])
    const request: CreateResponseBody = {
      ...body(),
      input: [
        ...body().input,
        { type: 'reasoning', encrypted_content: 'synthetic-reasoning' },
        {
          type: 'function_call',
          call_id: 'previous',
          name: 'read_file',
          arguments: '{"path":"b.ts"}',
        },
        { type: 'function_call_output', call_id: 'previous', output: 'tool answer' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'previous answer' }],
        },
      ],
    }
    const events = await run(tester, request)
    expect(tester.model.sendRequest).toHaveBeenCalledWith(
      [
        message(1, 'stable instructions'),
        message(1, 'hello'),
        {
          role: 2,
          content: [new Call('previous', 'read_file', { path: 'b.ts' })],
          name: undefined,
        },
        { role: 1, content: [new Result('previous', [new Text('tool answer')])], name: undefined },
        message(2, 'previous answer'),
      ],
      {
        tools: [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
        justification: tester.deps.justification(),
      },
      expect.anything(),
    )
    expect(events).toContainEqual({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        id: 'call-1',
        call_id: 'call-1',
        name: 'read_file',
        arguments: '{"path":"a.ts"}',
      },
    })
    expect(events.at(-1)).toMatchObject({
      type: 'response.completed',
      response: { usage: { input_tokens: 12, output_tokens: 2 } },
    })
    expect(tester.deps.recordEstimatedUsage).toHaveBeenCalledWith(request.model, 12, 2)
  })

  it.each([
    'Blocked',
    'ChatQuotaExceeded',
    'ChatRateLimited',
    'NoPermissions',
    'NotFound',
    'Unknown',
  ])('translates %s without exposing the service message', async (code) => {
    const tester = rig()
    vi.mocked(tester.model.sendRequest).mockRejectedValueOnce(
      Object.assign(new Error('synthetic private account details'), { code }),
    )
    const translated: Record<string, string> = {
      Blocked: 'quota',
      ChatQuotaExceeded: 'quota',
      ChatRateLimited: 'rate-limit',
      NoPermissions: 'consent-required',
      NotFound: 'unavailable',
      Unknown: 'request-failed',
    }
    await expect(run(tester)).rejects.toThrow(`translated.${translated[code] ?? 'request-failed'}`)
    expect(tester.cancel).toHaveBeenCalled()
    expect(tester.dispose).toHaveBeenCalledOnce()
    expect(tester.deps.recordEstimatedUsage).not.toHaveBeenCalled()
  })

  it('translates nested quota errors during the stream', async () => {
    const tester = rig()
    vi.mocked(tester.model.sendRequest).mockResolvedValueOnce({
      stream: (async function* () {
        await pause(0)
        yield new Text('partial')
        throw Object.assign(new Error('private', { cause: { name: 'ChatQuotaExceeded' } }), {
          code: 'Unknown',
        })
      })(),
      text: (async function* () {
        await pause(0)
        yield 'partial'
      })(),
    })
    await expect(run(tester)).rejects.toThrow('translated.quota')
  })

  it('blocks first-use consent from a background request but allows a previously granted request', async () => {
    const tester = rig()
    tester.userInitiated(false)
    await expect(run(tester)).rejects.toThrow('translated.consent-required')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
    tester.access(true)
    await run(tester)
    expect(tester.model.sendRequest).toHaveBeenCalledOnce()
  })

  it('rechecks consent after asynchronous token counting before dispatch', async () => {
    const tester = rig()
    tester.access(true)
    tester.userInitiated(false)
    vi.mocked(tester.model.countTokens).mockImplementationOnce(() => {
      tester.access(false)
      return Promise.resolve(2)
    })
    await expect(run(tester)).rejects.toThrow('translated.consent-required')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
  })

  it.each([
    Object.assign(new Text('synthetic'), { value: 1 }),
    Object.assign(new Call('id', 'tool', {}), { callId: 1 }),
    new Call('id', '', {}),
    Object.assign(new Call('id', 'tool', {}), { input: [] }),
  ])('validates SDK response parts before use', async (part) => {
    await expect(run(rig([part]))).rejects.toThrow(
      /translated\.(request-failed|unsupported-content)/,
    )
  })

  it('hides models in a confidential workspace and refuses an already-held client when the setting changes', async () => {
    const tester = rig()
    const connected = await client(tester)
    tester.confidential(true)
    await expect(connectCopilotFromClick(tester.deps)).resolves.toEqual([])
    expect(tester.api.selectChatModels).toHaveBeenCalledOnce()
    await expect(
      connected.streamResponse(body(), new AbortController().signal).next(),
    ).rejects.toThrow('translated.confidential')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
  })

  it('rechecks confidentiality after token counting before admission and dispatch', async () => {
    const tester = rig()
    vi.mocked(tester.model.countTokens).mockImplementationOnce(() => {
      tester.confidential(true)
      return Promise.resolve(2)
    })
    await expect(run(tester)).rejects.toThrow('translated.confidential')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
  })

  it('feature-detects image support for the selected model, refusing unsupported input before dispatch', async () => {
    const tester = rig()
    const request: CreateResponseBody = {
      ...body(),
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,c3ludGhldGlj',
              detail: 'auto',
            },
          ],
        },
      ],
    }
    await expect(run(tester, request)).rejects.toThrow('translated.unsupported-content')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
    const append = vi.fn((msg: vscode.LanguageModelChatMessage, url: string) => {
      msg.content.push(new Text(`synthetic-image:${url}`))
    })
    const unsupported = await connectCopilotFromClick({
      ...tester.deps,
      images: { supports: () => false, append },
    })
    await expect(
      unsupported[0]!.streamResponse(request, new AbortController().signal).next(),
    ).rejects.toThrow('translated.unsupported-content')
    expect(append).not.toHaveBeenCalled()
    const supported = await connectCopilotFromClick({
      ...tester.deps,
      images: { supports: () => true, append },
    })
    const imageStream = supported[0]!.streamResponse(request, new AbortController().signal)
    for await (const _event of imageStream) {
      /* consume */
    }
    expect(append).toHaveBeenCalledWith(expect.anything(), 'data:image/png;base64,c3ludGhldGlj')
  })

  it.each([
    'files',
    'hosted-tool',
    'search-history',
    'invalid-tool-call',
    'invalid-tool-input',
    'unknown-response',
  ])('refuses unsupported %s instead of dropping it', async (kind) => {
    const tester = rig(kind === 'unknown-response' ? [{ type: 'synthetic-unknown' }] : undefined)
    let request = body()
    switch (kind) {
      case 'files': {
        request = {
          ...request,
          input: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_file', filename: 'a.pdf', file_data: 'synthetic' }],
            },
          ],
        }
        break
      }
      case 'hosted-tool': {
        request = { ...request, tools: [{ type: 'web_search' }] }
        break
      }
      case 'search-history': {
        request = { ...request, input: [{ type: 'web_search_call', status: 'completed' }] }
        break
      }
      case 'invalid-tool-call':
      case 'invalid-tool-input': {
        {
          request = {
            ...request,
            input: [
              {
                type: 'function_call',
                name: 'read_file',
                call_id: 'id',
                arguments: kind === 'invalid-tool-call' ? '{broken' : '[]',
              },
            ],
          }
          // No default
        }
        break
      }
    }
    await expect(run(tester, request)).rejects.toThrow('translated.unsupported-content')
  })

  it.each([-1, 0.5, NaN, Infinity])('refuses invalid token counts %s', async (count) => {
    const tester = rig()
    vi.mocked(tester.model.countTokens).mockResolvedValueOnce(count)
    await expect(run(tester)).rejects.toThrow('translated.request-failed')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
  })

  it('uses the current translation for justification and failure text', async () => {
    const tester = rig()
    let language = 'initial'
    const deps = { ...tester.deps, justification: () => language, failureText: () => language }
    const clients = await connectCopilotFromClick(deps)
    const connected = clients[0]!
    language = 'changed'
    const translatedStream = connected.streamResponse(body(), new AbortController().signal)
    for await (const _event of translatedStream) {
      /* consume */
    }
    expect(tester.model.sendRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ justification: 'changed' }),
      expect.anything(),
    )
    tester.confidential(true)
    await expect(connected.countInputTokens(body())).rejects.toThrow('changed')
    await expect(connected.listModels()).resolves.toEqual([])
  })

  it('cancels on Stop, including an already-aborted signal, and cleans up when the consumer closes', async () => {
    const tester = rig()
    const controller = new AbortController()
    controller.abort()
    await expect(run(tester, body(), controller.signal)).rejects.toThrow('translated.cancelled')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
    const connected = await client(tester)
    const stream = connected.streamResponse(body(), new AbortController().signal)
    await stream.next()
    await stream.return(undefined)
    expect(tester.cancel).toHaveBeenCalled()
    expect(tester.dispose).toHaveBeenCalledTimes(2)
  })

  it('bridges Stop to VS Code while sendRequest is pending', async () => {
    const tester = rig()
    const controller = new AbortController()
    const requestStarted = Promise.withResolvers<boolean>()
    const pending = Promise.withResolvers<vscode.LanguageModelChatResponse>()
    vi.mocked(tester.model.sendRequest).mockImplementationOnce(() => {
      requestStarted.resolve(true)
      return pending.promise
    })
    const stream = run(tester, body(), controller.signal)
    const failed = expect(stream).rejects.toThrow('translated.cancelled')
    await requestStarted.promise
    controller.abort()
    expect(tester.cancel).toHaveBeenCalledOnce()
    pending.reject(new Error('synthetic cancellation'))
    await failed
    expect(tester.dispose).toHaveBeenCalledOnce()
  })

  it('ends a response at the output cap and marks it incomplete with estimated usage', async () => {
    const tester = rig([new Text('first'), new Text('must not arrive')])
    const events = await run(tester, { ...body(), max_output_tokens: 1 })
    expect(events.at(-1)).toMatchObject({
      type: 'response.incomplete',
      response: {
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'first' }] }],
      },
    })
    expect(tester.cancel).toHaveBeenCalled()
  })

  it('calls admission and request observation once adjacent to sendRequest', async () => {
    const tester = rig()
    const order: string[] = []
    const connected = await client(tester)
    const admission = Object.assign(
      vi.fn(() => {
        order.push('admit')
      }),
      {
        onRequestStarted: () => {
          order.push('started')
        },
      },
    )
    const original = vi.mocked(tester.model.sendRequest).getMockImplementation()!
    vi.mocked(tester.model.sendRequest).mockImplementation((...args) => {
      order.push('send')
      return original(...args)
    })
    const admittedStream = connected.streamResponse(
      body(),
      new AbortController().signal,
      undefined,
      undefined,
      admission,
    )
    for await (const _event of admittedStream) {
      /* consume */
    }
    expect(order).toEqual(['admit', 'started', 'send'])
    expect(admission).toHaveBeenCalledWith(undefined)
  })

  it('refuses a stale scheduled confirmation and a mismatched model before dispatch', async () => {
    const tester = rig()
    const connected = await client(tester)
    const confirmed = {
      modelId: body().model,
      keyDigest: 'synthetic',
      isStillAllowed: () => false,
      onRequestStarted: vi.fn(),
    }
    await expect(
      connected
        .streamResponse(
          body(),
          new AbortController().signal,
          undefined,
          undefined,
          undefined,
          confirmed,
        )
        .next(),
    ).rejects.toThrow('translated.confirmation-expired')
    await expect(
      connected
        .streamResponse(body(), new AbortController().signal, undefined, undefined, undefined, {
          ...confirmed,
          isStillAllowed: () => true,
        })
        .next(),
    ).rejects.toThrow('translated.confirmation-expired')
    await expect(run(tester, { ...body(), model: 'copilot/other-model' })).rejects.toThrow(
      'translated.unavailable',
    )
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
  })

  it('refuses requests exceeding the selected model window before dispatch', async () => {
    const tester = rig()
    vi.mocked(tester.model.countTokens).mockResolvedValue(600)
    await expect(run(tester)).rejects.toThrow('translated.unsupported-content')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
  })

  it('refuses identity-dependent automation because VS Code exposes no account identity', async () => {
    const connected = await client(rig())
    await expect(connected.currentKeyDigest()).rejects.toThrow('translated.unsupported-content')
    expect(connected.retryDelayMs(0)).toBe(0)
    const controller = new AbortController()
    controller.abort()
    await expect(connected.waitBeforeRetry(1, controller.signal)).rejects.toThrow()
  })

  it('reports an unavailable native API without a stub or inference call', async () => {
    const tester = rig()
    const { api: _api, ...deps } = tester.deps
    await expect(connectCopilotFromClick(deps)).rejects.toThrow('translated.unavailable')
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
  })

  it('filters foreign vendors and rechecks confidentiality after model selection', async () => {
    const tester = rig()
    vi.mocked(tester.api.selectChatModels).mockResolvedValueOnce([
      { ...tester.model, vendor: 'other' },
    ])
    await expect(connectCopilotFromClick(tester.deps)).resolves.toEqual([])
    vi.mocked(tester.api.selectChatModels).mockImplementationOnce(() => {
      tester.confidential(true)
      return Promise.resolve([tester.model])
    })
    await expect(connectCopilotFromClick(tester.deps)).resolves.toEqual([])
    expect(tester.model.sendRequest).not.toHaveBeenCalled()
  })

  it('returns no model on an empty selection and sanitizes selection failures', async () => {
    const tester = rig()
    vi.mocked(tester.api.selectChatModels).mockResolvedValueOnce([])
    await expect(connectCopilotFromClick(tester.deps)).resolves.toEqual([])
    vi.mocked(tester.api.selectChatModels).mockRejectedValueOnce(new Error('private'))
    await expect(connectCopilotFromClick(tester.deps)).rejects.toThrow('translated.request-failed')
  })
})
