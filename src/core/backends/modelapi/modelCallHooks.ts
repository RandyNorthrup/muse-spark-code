// M51: local Model API analog of Muse Code 1.3.0's captured PreLLMCall and
// PostLLMCall stdin. Keep only bounded summaries; no request body, media data
// URLs, API key or full response enters a hook process.

import {
  HOOK_MODEL_CONTENT_PARTS_MAX,
  HOOK_MODEL_MESSAGE_SUMMARIES_MAX,
  HOOK_MODEL_OUTPUT_PREVIEW_CHARS,
  HOOK_MODEL_TEXT_PREVIEW_CHARS,
  HOOK_MODEL_TOOL_DESCRIPTION_CHARS,
  HOOK_MODEL_TOOL_SUMMARIES_MAX,
} from '../../../shared/constants'
import {
  isMessageItem,
  messageText,
  type CreateResponseBody,
  type InputContentPart,
  type InputItem,
  type ResponseObject,
  type ToolDefinition,
} from './schemas'
import { replayProducer } from './sessionStore'
import { redactHookText } from './toolHookPayload'

interface TextSummary {
  readonly type: 'text'
  readonly text: string
}

interface MessageSummary {
  readonly role: string
  readonly content: readonly TextSummary[]
}

interface ToolSummary {
  readonly name: string
  readonly description: string
  readonly has_parameters: boolean
  readonly strict: boolean
}

function preview(text: string, limit: number): string {
  const safe = redactHookText(text)
  let result = ''
  let count = 0
  for (const character of safe) {
    if (count >= limit) {
      break
    }
    result += character
    count += 1
  }
  return result
}

function textPart(part: InputContentPart): TextSummary | undefined {
  return part.type === 'input_text' || part.type === 'output_text'
    ? { type: 'text', text: preview(part.text, HOOK_MODEL_TEXT_PREVIEW_CHARS) }
    : undefined
}

function messageSummary(item: InputItem): MessageSummary | undefined {
  if (item.type !== 'message') {
    return undefined
  }
  return {
    role: item.role,
    content: item.content
      .flatMap((part) => {
        const text = textPart(part)
        return text === undefined ? [] : [text]
      })
      .slice(-HOOK_MODEL_CONTENT_PARTS_MAX),
  }
}

function messageSummaries(body: CreateResponseBody): readonly MessageSummary[] {
  return body.input
    .flatMap((item) => {
      const summary = messageSummary(item)
      return summary === undefined ? [] : [summary]
    })
    .slice(-HOOK_MODEL_MESSAGE_SUMMARIES_MAX)
}

function toolSummary(tool: ToolDefinition): ToolSummary {
  return tool.type === 'function'
    ? {
        name: tool.name,
        description: preview(tool.description, HOOK_MODEL_TOOL_DESCRIPTION_CHARS),
        has_parameters: true,
        strict: tool.strict,
      }
    : { name: tool.type, description: '', has_parameters: false, strict: false }
}

function toolSummaries(body: CreateResponseBody): readonly ToolSummary[] {
  return body.tools.slice(0, HOOK_MODEL_TOOL_SUMMARIES_MAX).map((tool) => toolSummary(tool))
}

function requestFields(body: CreateResponseBody, requestId: string, attempt: number, step: number) {
  const messages = messageSummaries(body)
  const tools = toolSummaries(body)
  return {
    provider: replayProducer(body.model).provider,
    model: body.model,
    request_id: requestId,
    attempt,
    step,
    messages,
    message_count: messages.length,
    tools,
    tool_count: tools.length,
  }
}

/** The captured pre-call keys: bounded request summaries and provider options. */
export function preModelCallFields(
  body: CreateResponseBody,
  requestId: string,
  attempt: number,
  step: number,
): Readonly<Record<string, unknown>> {
  return {
    ...requestFields(body, requestId, attempt, step),
    options: { [`${replayProducer(body.model).provider}.reasoning.effort`]: body.reasoning.effort },
  }
}

/** The captured successful post-call keys, with usage and output preview. */
export function postModelCallFields(
  body: CreateResponseBody,
  response: ResponseObject,
  requestId: string,
  attempt: number,
  step: number,
  sessionId: string,
): Readonly<Record<string, unknown>> {
  const inputMessages = messageSummaries(body)
  const messages: readonly MessageSummary[] = [
    {
      role: 'developer',
      content: [{ type: 'text', text: preview(body.instructions, HOOK_MODEL_TEXT_PREVIEW_CHARS) }],
    },
    ...inputMessages.slice(-(HOOK_MODEL_MESSAGE_SUMMARIES_MAX - 1)),
  ]
  const tools = toolSummaries(body)
  const outputText = response.output
    .filter(isMessageItem)
    .map((item) => messageText(item))
    .join('')
  const usage = response.usage
  return {
    provider: replayProducer(body.model).provider,
    model: body.model,
    request_id: requestId,
    attempt,
    step,
    status: 'success',
    response_id: response.id,
    usage:
      usage === null || usage === undefined
        ? null
        : {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0,
            reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
          },
    finish_reason: null,
    error: null,
    output_text_preview: preview(outputText, HOOK_MODEL_OUTPUT_PREVIEW_CHARS),
    tool_call_count: response.output.filter((item) => item.type === 'function_call').length,
    messages,
    message_count: messages.length,
    tools,
    tool_count: tools.length,
    options: {
      [`${replayProducer(body.model).provider}.reasoning.effort`]: body.reasoning.effort,
      [`${replayProducer(body.model).provider}.session_id`]: sessionId,
    },
  }
}
