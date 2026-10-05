// VS Code-only adapter. W injects this client into the ProviderRegistry;
// the tool loop, approvals, hooks and plan accounting remain in shared code.
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type {
  ConfirmedModelRequest,
  ModelApiClient,
  ResponseAttemptGuard,
  RetryBudget,
  RetryNotice,
} from '../../core/backends/modelapi/client'
import type {
  CreateResponseBody,
  FunctionOutputPart,
  InputContentPart,
  OutputItem,
  StreamEvent,
} from '../../core/backends/modelapi/schemas'

/** The M95 ProviderClient seam, absent from this base; no image-generation calls. */
type ProviderClient = Pick<
  ModelApiClient,
  | 'streamResponse'
  | 'countInputTokens'
  | 'listModels'
  | 'currentKeyDigest'
  | 'retryDelayMs'
  | 'waitBeforeRetry'
>
type CopilotFailure =
  | 'unavailable'
  | 'consent-required'
  | 'quota'
  | 'rate-limit'
  | 'request-failed'
  | 'unsupported-content'
  | 'confidential'
  | 'cancelled'
  | 'confirmation-expired'

export interface CopilotPort {
  selectChatModels(selector: vscode.LanguageModelChatSelector): Thenable<vscode.LanguageModelChat[]>
  user(content: string): vscode.LanguageModelChatMessage
  assistant(content: string): vscode.LanguageModelChatMessage
  text(value: string): vscode.LanguageModelTextPart
  call(id: string, name: string, input: object): vscode.LanguageModelToolCallPart
  result(id: string, content: unknown[]): vscode.LanguageModelToolResultPart
  cancellation(): vscode.CancellationTokenSource
  isText(part: unknown): part is vscode.LanguageModelTextPart
  isCall(part: unknown): part is vscode.LanguageModelToolCallPart
}

export interface CopilotClientDeps {
  /** Read at use time from lane 0's UI_TEXT; includes reduced and the AI-credit caveat. */
  readonly justification: () => string
  readonly failureText: (code: CopilotFailure) => string
  readonly isConfidential: () => boolean
  /** The first consent-triggering request must follow the user's click/send. */
  readonly isUserInitiated: () => boolean
  readonly canSendRequest: (model: vscode.LanguageModelChat) => boolean | undefined
  readonly recordEstimatedUsage: (model: string, input: number, output: number) => void
  readonly api?: CopilotPort
  /** 1.106+ host feature detection plus the selected model's vision capability. */
  readonly images?: {
    supports(model: vscode.LanguageModelChat): boolean
    append(message: vscode.LanguageModelChatMessage, imageUrl: string): void
  }
}

function nativePort(deps: CopilotClientDeps): CopilotPort {
  const lm: unknown = vscode.lm
  if (
    typeof lm !== 'object' ||
    lm === null ||
    !('selectChatModels' in lm) ||
    typeof lm.selectChatModels !== 'function'
  )
    throw new CopilotFailureError(deps.failureText('unavailable'))
  return {
    selectChatModels: (selector) => vscode.lm.selectChatModels(selector),
    user: (text) => vscode.LanguageModelChatMessage.User(text),
    assistant: (text) => vscode.LanguageModelChatMessage.Assistant(text),
    text: (text) => new vscode.LanguageModelTextPart(text),
    call: (id, name, input) => new vscode.LanguageModelToolCallPart(id, name, input),
    result: (id, content) => new vscode.LanguageModelToolResultPart(id, content),
    cancellation: () => new vscode.CancellationTokenSource(),
    isText: (part): part is vscode.LanguageModelTextPart =>
      part instanceof vscode.LanguageModelTextPart,
    isCall: (part): part is vscode.LanguageModelToolCallPart =>
      part instanceof vscode.LanguageModelToolCallPart,
  }
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

const tokenCountSchema = z.number().check(z.int(), z.gte(0))
const callInputSchema = z.record(z.string(), z.unknown())
const callPartSchema = z.object({
  callId: z.string().check(z.minLength(1)),
  name: z.string().check(z.minLength(1)),
  input: callInputSchema,
})
const errorSchema = z.object({
  code: z.optional(z.string()),
  name: z.optional(z.string()),
  cause: z.optional(z.unknown()),
})
function failureCode(error: unknown): CopilotFailure {
  const parsed = errorSchema.safeParse(error)
  const cause = errorSchema.safeParse(parsed.success ? parsed.data.cause : undefined)
  const codes = parsed.success ? [parsed.data.code, parsed.data.name] : []
  if (cause.success) codes.push(cause.data.code, cause.data.name)
  if (codes.includes('NoPermissions')) return 'consent-required'
  if (codes.includes('Blocked') || codes.includes('ChatQuotaExceeded')) return 'quota'
  if (codes.includes('ChatRateLimited')) return 'rate-limit'
  return codes.includes('NotFound') ? 'unavailable' : 'request-failed'
}

class CopilotFailureError extends Error {}

class CopilotClient implements ProviderClient {
  public readonly providerId = 'copilot'
  public readonly reduced = true
  public readonly usageAccuracy = 'estimated'
  public readonly pricing = 'plan'
  public readonly cacheControl = false
  public readonly reasoningReplay = false
  public constructor(
    public readonly model: vscode.LanguageModelChat,
    private readonly deps: CopilotClientDeps,
    private readonly api: CopilotPort,
  ) {}

  private fail(code: CopilotFailure): Error {
    return new CopilotFailureError(this.deps.failureText(code))
  }
  private check(): void {
    if (this.deps.isConfidential()) throw this.fail('confidential')
  }
  private checkConsent(): void {
    if (this.deps.canSendRequest(this.model) !== true && !this.deps.isUserInitiated())
      throw this.fail('consent-required')
  }
  private content(
    message: vscode.LanguageModelChatMessage,
    parts: readonly (InputContentPart | FunctionOutputPart)[],
  ): void {
    for (const part of parts) {
      if (part.type === 'input_text' || part.type === 'output_text')
        message.content.push(this.api.text(part.text))
      else if (part.type === 'input_image' && this.deps.images?.supports(this.model) === true)
        this.deps.images.append(message, part.image_url)
      else throw this.fail('unsupported-content')
    }
  }
  private messages(body: Omit<CreateResponseBody, 'stream'>): vscode.LanguageModelChatMessage[] {
    const messages = [this.api.user(body.instructions)]
    for (const item of body.input) {
      if (item.type === 'message') {
        const message = item.role === 'assistant' ? this.api.assistant('') : this.api.user('')
        this.content(message, item.content)
        messages.push(message)
      } else if (item.type === 'function_call' && 'call_id' in item) {
        let input: unknown
        try {
          input = JSON.parse(item.arguments)
        } catch {
          throw this.fail('unsupported-content')
        }
        const parsed = callInputSchema.safeParse(input)
        if (!parsed.success) throw this.fail('unsupported-content')
        const message = this.api.assistant('')
        message.content.push(this.api.call(item.call_id, item.name, parsed.data))
        messages.push(message)
      } else if (item.type === 'function_call_output') {
        const message = this.api.user('')
        const result = this.api.user('')
        this.content(
          result,
          typeof item.output === 'string'
            ? [{ type: 'input_text', text: item.output }]
            : item.output,
        )
        message.content.push(this.api.result(item.call_id, result.content))
        messages.push(message)
      } else if (item.type !== 'reasoning') throw this.fail('unsupported-content')
    }
    return messages
  }
  public listModels(): Promise<readonly string[]> {
    return Promise.resolve(this.deps.isConfidential() ? [] : [this.model.id])
  }
  public currentKeyDigest(): Promise<string> {
    // VS Code exposes no grant/account identity to pin a scheduled request.
    return Promise.reject(this.fail('unsupported-content'))
  }
  public retryDelayMs(_attempt: number): number {
    return 0
  }
  public async waitBeforeRetry(ms: number, signal: AbortSignal): Promise<void> {
    await pause(ms, undefined, { signal })
  }
  public async countInputTokens(body: Omit<CreateResponseBody, 'stream'>): Promise<number> {
    this.check()
    try {
      let count = 0
      for (const message of this.messages(body))
        count += tokenCountSchema.parse(await this.model.countTokens(message))
      count += tokenCountSchema.parse(await this.model.countTokens(JSON.stringify(body.tools)))
      return tokenCountSchema.parse(count)
    } catch (error) {
      if (error instanceof CopilotFailureError) throw error
      throw this.fail('request-failed')
    }
  }
  public async *streamResponse(
    body: CreateResponseBody,
    signal: AbortSignal,
    _onRetry?: (notice: RetryNotice) => void,
    _budget?: RetryBudget,
    admitAttempt?: ResponseAttemptGuard,
    confirmed?: ConfirmedModelRequest,
  ): AsyncGenerator<StreamEvent> {
    this.check()
    if (body.model !== this.model.id && body.model !== `copilot/${this.model.id}`)
      throw this.fail('unavailable')
    this.checkConsent()
    if (confirmed !== undefined) throw this.fail('confirmation-expired')
    const cancellation = this.api.cancellation()
    const abort = (): void => {
      cancellation.cancel()
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (isAborted(signal)) throw this.fail('cancelled')
      const messages = this.messages(body)
      const tools: vscode.LanguageModelChatTool[] = body.tools.map((tool) => {
        if (tool.type !== 'function') throw this.fail('unsupported-content')
        return { name: tool.name, description: tool.description, inputSchema: tool.parameters }
      })
      const inputTokens = await this.countInputTokens(body)
      if (inputTokens > this.model.maxInputTokens) throw this.fail('unsupported-content')
      this.check()
      this.checkConsent()
      if (isAborted(signal)) throw this.fail('cancelled')
      admitAttempt?.(undefined)
      admitAttempt?.onRequestStarted?.()
      const response = await this.model.sendRequest(
        messages,
        { tools, justification: this.deps.justification() },
        cancellation.token,
      )
      const id = randomUUID()
      const output: OutputItem[] = []
      const assistant = this.api.assistant('')
      let text = ''
      let outputTokens = 0
      let isIncomplete = false
      yield {
        type: 'response.created',
        response: { id, model: body.model, status: 'in_progress', output: [] },
      }
      for await (const part of response.stream) {
        if (isAborted(signal)) throw this.fail('cancelled')
        if (this.api.isText(part)) {
          const delta = z.string().parse(part.value)
          text += delta
          assistant.content.push(part)
          yield { type: 'response.output_text.delta', item_id: id, delta }
        } else if (this.api.isCall(part)) {
          const call = callPartSchema.safeParse(part)
          if (!call.success) throw this.fail('unsupported-content')
          assistant.content.push(part)
          const item: OutputItem = {
            type: 'function_call',
            id: call.data.callId,
            call_id: call.data.callId,
            name: call.data.name,
            arguments: JSON.stringify(call.data.input),
          }
          output.push(item)
          yield { type: 'response.output_item.done', item }
        } else throw this.fail('unsupported-content')
        outputTokens = tokenCountSchema.parse(
          await this.model.countTokens(assistant, cancellation.token),
        )
        if (outputTokens > body.max_output_tokens) {
          isIncomplete = true
          cancellation.cancel()
          break
        }
      }
      if (isAborted(signal)) throw this.fail('cancelled')
      if (text !== '') {
        const item: OutputItem = {
          type: 'message',
          id,
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        }
        output.unshift(item)
        yield { type: 'response.output_item.done', item }
      }
      this.deps.recordEstimatedUsage(body.model, inputTokens, outputTokens)
      const final = {
        id,
        model: body.model,
        status: isIncomplete ? 'incomplete' : 'completed',
        output,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }
      if (isIncomplete)
        yield {
          type: 'response.incomplete',
          response: { ...final, incomplete_details: { reason: 'max_output_tokens' } },
        }
      else yield { type: 'response.completed', response: final }
    } catch (error) {
      if (isAborted(signal)) throw this.fail('cancelled')
      if (error instanceof CopilotFailureError) throw error
      throw this.fail(failureCode(error))
    } finally {
      signal.removeEventListener('abort', abort)
      cancellation.cancel()
      cancellation.dispose()
    }
  }
}

/** Call only from the Providers button. Selection makes no inference request. */
function selectionFailure(deps: CopilotClientDeps, error: unknown): Error {
  return new Error(deps.failureText(failureCode(error)))
}

export async function connectCopilotFromClick(
  deps: CopilotClientDeps,
): Promise<readonly CopilotClient[]> {
  if (deps.isConfidential()) return []
  let api: CopilotPort
  let models: vscode.LanguageModelChat[]
  try {
    api = deps.api ?? nativePort(deps)
    models = await api.selectChatModels({ vendor: 'copilot' })
  } catch (error) {
    if (error instanceof CopilotFailureError) throw error
    throw selectionFailure(deps, error)
  }
  return deps.isConfidential()
    ? []
    : models
        .filter((model) => model.vendor === 'copilot')
        .map((model) => new CopilotClient(model, deps, api))
}
