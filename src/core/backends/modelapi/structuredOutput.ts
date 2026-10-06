// M106 O1: format selection reads only the selected model's evidence. The
// provider codec owns forced-tool encoding; no provider wire is guessed here.
import { z } from 'zod'
import type { CreateResponseBody } from './schemas'
import { STRUCTURED_OUTPUT_REPAIRS_MAX, UI_TEXT } from '../../../shared/constants'
import { compactionSummarySchema } from '../../../shared/sideCallSchemas'

/** Structural projection of M95's ModelCapabilityRecord.output.formats. */
export interface SideCallFormats {
  readonly state: 'yes' | 'no' | 'unknown'
  readonly value?: readonly (
    'text' | 'json_object' | 'json_schema' | 'strict_schema' | 'forced_tool'
  )[]
}

export type SideCallMode = 'strict_schema' | 'json_schema' | 'forced_tool' | 'text'

export interface SideCallAttempt {
  readonly mode: SideCallMode
  readonly name: string
  readonly schema: Record<string, unknown>
  readonly repair: boolean
}

/** M95 integration binds the selected full record and its captured codec. */
export interface StructuredOutputDeps {
  readonly sideCallFormats?: ((modelId: string) => SideCallFormats | undefined) | undefined
  readonly forceSideCallTool?:
    ((body: CreateResponseBody, attempt: SideCallAttempt) => CreateResponseBody) | undefined
}

export function sideCallMode(formats: SideCallFormats | undefined): SideCallMode {
  if (formats?.state !== 'yes') return 'text'
  for (const mode of ['strict_schema', 'json_schema', 'forced_tool'] as const) {
    if (formats.value?.includes(mode)) return mode
  }
  return 'text'
}

/** A fixed contract for the first request, including a user's existing git turn. */
export function sideCallContract<T>(
  formats: SideCallFormats | undefined,
  name: string,
  schema: z.ZodType<T>,
): SideCallAttempt {
  const mode = sideCallMode(formats)
  return {
    mode,
    name,
    schema: mode === 'text' ? {} : z.toJSONSchema(schema, { io: 'input' }),
    repair: false,
  }
}

/** The legacy body is returned by identity. Callers key structured bodies afterwards. */
export function sideCallBody(
  body: CreateResponseBody,
  attempt: SideCallAttempt,
  forceTool: StructuredOutputDeps['forceSideCallTool'],
): CreateResponseBody {
  if (attempt.mode === 'text') return body
  if (attempt.mode === 'forced_tool') {
    if (forceTool === undefined) throw new Error('the forced side-answer codec is unavailable')
    return forceTool(body, attempt)
  }
  return {
    ...body,
    text: {
      format: {
        type: 'json_schema',
        name: attempt.name,
        schema: attempt.schema,
        strict: attempt.mode === 'strict_schema',
      },
    },
    input: [
      ...body.input,
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({ schema: attempt.schema, repair: attempt.repair }),
          },
        ],
      },
    ],
  }
}

function decoded(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return undefined
  }
}

/** One repair, then a fresh legacy request. Invalid JSON never reaches a consumer. */
export async function structuredSideCall<T>(options: {
  readonly formats: SideCallFormats | undefined
  readonly name: string
  readonly schema: z.ZodType<T>
  readonly request: (attempt: SideCallAttempt) => Promise<string>
  readonly signal: AbortSignal
  readonly fallback: (text: string) => T
  readonly notice?: ((text: string) => void) | undefined
  readonly isTerminalError?: ((error: unknown) => boolean) | undefined
}): Promise<T> {
  const mode = sideCallMode(options.formats)
  const textAttempt: SideCallAttempt = {
    mode: 'text',
    name: options.name,
    schema: {},
    repair: false,
  }
  if (mode !== 'text') {
    try {
      const schema = z.toJSONSchema(options.schema, { io: 'input' })
      for (let repair = 0; repair <= STRUCTURED_OUTPUT_REPAIRS_MAX; repair += 1) {
        options.signal.throwIfAborted()
        try {
          const text = await options.request({
            mode,
            name: options.name,
            schema,
            repair: repair > 0,
          })
          options.signal.throwIfAborted()
          const answer = options.schema.safeParse(decoded(text))
          if (answer.success) return answer.data
        } catch (error: unknown) {
          if (options.signal.aborted || options.isTerminalError?.(error) === true) throw error
        }
        if (repair < STRUCTURED_OUTPUT_REPAIRS_MAX) options.notice?.(UI_TEXT.structuredOutputRepair)
      }
    } catch (error: unknown) {
      if (options.signal.aborted || options.isTerminalError?.(error) === true) throw error
    }
    options.notice?.(UI_TEXT.structuredOutputFallback)
  }
  options.signal.throwIfAborted()
  const text = await options.request(textAttempt)
  options.signal.throwIfAborted()
  return options.fallback(text)
}

/** M106's fixed LF rendering; the model has no authority over host snapshots. */
export function renderCompactionSummary(answer: z.infer<typeof compactionSummarySchema>): string {
  const value = compactionSummarySchema.parse(answer)
  return `## Goal\n\n${value.goal}\n\n## Constraints\n\n${value.constraints}\n\n## Progress\n\n${value.progress}\n\n## Decisions\n\n${value.decisions}\n\n## Next steps\n\n${value.nextSteps}\n\n## Critical context\n\n${value.criticalContext}`
}

/** A prose-only seam for C1: its wrapper, snapshots and retained tail stay outside. */
export async function structuredCompaction(options: {
  readonly formats: SideCallFormats | undefined
  readonly request: (attempt: SideCallAttempt) => Promise<string>
  readonly signal: AbortSignal
  readonly notice?: ((text: string) => void) | undefined
  readonly isTerminalError?: ((error: unknown) => boolean) | undefined
}): Promise<string> {
  return await structuredSideCall({
    ...options,
    name: 'compaction_summary',
    schema: compactionSummarySchema.transform(renderCompactionSummary),
    fallback: (text) => text,
  })
}
