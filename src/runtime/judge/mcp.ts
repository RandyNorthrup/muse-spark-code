import * as z from 'zod/mini'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { Logger } from '../../host/logger'
import { handleMcpMessage, mcpRequestKeys, type McpTool } from '../../core/mcp'
import {
  isZodParseError,
  judgeOutcomeSchema,
  judgeRequestSchema,
  type JudgeOutcome,
} from '../../core/judge/schema'
import {
  ACP_AGENT_NAME,
  EXEC_EXIT,
  EXEC_FORCE_WRITE_MS,
  IDE_MCP_SERVER_INFO,
  JUDGE_MAX_BODY_BYTES,
  MCP_CANCELLED_NOTIFICATION,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { JudgeCliIo } from './commands'
import { JudgeCliInputError } from './args'

type JudgeCall = (request: unknown, signal: AbortSignal) => Promise<JudgeOutcome>
const toolErrorSchema = z.object({ isError: z.literal(true) })
const cancelledNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.optional(z.never()),
  method: z.literal(MCP_CANCELLED_NOTIFICATION),
  params: z.object({ requestId: z.union([z.string(), z.number()]) }),
})

function judgeTool(judge: JudgeCall, fail: (code: number) => void): McpTool {
  return {
    name: 'judge',
    description: fill(UI_TEXT.judgeNoAnswer, { reason: 'advisory-only' }),
    inputSchema: z.toJSONSchema(judgeRequestSchema),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async call(raw, signal) {
      const request = judgeRequestSchema.safeParse(raw)
      if (!request.success) {
        fail(EXEC_EXIT.usage)
        throw new Error(UI_TEXT.execRequestShape)
      }
      let outcome: JudgeOutcome
      try {
        outcome = judgeOutcomeSchema.parse(await judge(request.data, signal))
      } catch (error: unknown) {
        if (error instanceof JudgeCliInputError) {
          fail(EXEC_EXIT.usage)
          throw error
        }
        if (signal.aborted) {
          outcome = { outcome: 'no-answer', reason: 'cancelled' }
        } else if (isZodParseError(error)) {
          outcome = { outcome: 'no-answer', reason: 'engine-failure' }
        } else {
          throw error
        }
      }
      if (outcome.outcome === 'no-answer') {
        fail(EXEC_EXIT.failed)
        throw new Error(fill(UI_TEXT.judgeNoAnswer, { reason: outcome.reason }))
      }
      const text = JSON.stringify(outcome.result)
      if (Buffer.byteLength(text) > JUDGE_MAX_BODY_BYTES) {
        fail(EXEC_EXIT.failed)
        throw new Error(UI_TEXT.execRequestShape)
      }
      return text
    },
  }
}

/**
Newline-delimited MCP stdio. A single bounded queue serializes inference,
while cancellation notifications interrupt active AND queued calls.
*/
export async function runJudgeMcp(
  io: JudgeCliIo,
  judge: JudgeCall,
  signal: AbortSignal,
  log?: Logger,
): Promise<number> {
  let code: number = EXEC_EXIT.ok
  const output = { hasFailed: false }
  const hasOutputFailed = () => output.hasFailed
  const fail = (next: number) => {
    code = next
  }
  const toolFailure = { hasFailed: false }
  const hasToolFailed = () => toolFailure.hasFailed
  const tools = [
    judgeTool(judge, (next) => {
      toolFailure.hasFailed = true
      fail(next)
    }),
  ]
  const active = new Map<string, Set<AbortController>>()
  let pending = Buffer.alloc(0)
  let queuedBytes = 0
  let work = Promise.resolve()
  const abort = () => {
    io.stdin.destroy(new Error(UI_TEXT.execInterrupted))
  }
  signal.addEventListener('abort', abort, { once: true })
  const submit = (line: string) => {
    const keys = mcpRequestKeys(line)
    // The shared key extractor also reads malformed envelopes. A cancellation
    // side effect requires the complete captured JSON-RPC notification first.
    if (
      keys.cancelled !== undefined &&
      cancelledNotificationSchema.safeParse(JSON.parse(line)).success
    ) {
      const controllers = active.get(keys.cancelled) ?? []
      for (const controller of controllers) controller.abort()
    }
    const controller = new AbortController()
    if (keys.request !== undefined) {
      const controllers = active.get(keys.request) ?? new Set<AbortController>()
      controllers.add(controller)
      active.set(keys.request, controllers)
    }
    const size = Buffer.byteLength(line)
    queuedBytes += size
    const processLine = async (previous: Promise<void>) => {
      await previous
      try {
        if (hasOutputFailed()) return
        signal.throwIfAborted()
        toolFailure.hasFailed = false
        const result = await handleMcpMessage(
          line,
          tools,
          { name: ACP_AGENT_NAME, version: IDE_MCP_SERVER_INFO.version },
          AbortSignal.any([signal, controller.signal]),
        )
        if (hasOutputFailed()) return
        if (result.kind === 'response') {
          let body = result.body
          if (Object.hasOwn(body, 'error')) {
            fail(EXEC_EXIT.usage)
            body = {
              ...body,
              error: {
                code: z.object({ code: z.number() }).parse(body['error']).code,
                message: UI_TEXT.execRequestShape,
              },
            }
          }
          const toolResult = toolErrorSchema.safeParse(body['result'])
          if (toolResult.success && !hasToolFailed()) {
            fail(EXEC_EXIT.usage)
            body = {
              ...body,
              result: {
                isError: true,
                content: [{ type: 'text', text: UI_TEXT.execRequestShape }],
              },
            }
          }
          io.stdout.write(`${JSON.stringify(body)}\n`)
          if (!(await io.stdout.flush(EXEC_FORCE_WRITE_MS))) {
            output.hasFailed = true
            fail(EXEC_EXIT.failed)
            io.stdin.destroy()
          }
        }
      } catch (error: unknown) {
        log?.warn(`Judge MCP line failed: ${failureForLog(error)}`)
        fail(EXEC_EXIT.failed)
      } finally {
        queuedBytes -= size
        if (keys.request !== undefined) {
          const controllers = active.get(keys.request)
          controllers?.delete(controller)
          if (controllers?.size === 0) active.delete(keys.request)
        }
      }
    }
    work = processLine(work)
  }
  try {
    for await (const raw of io.stdin) {
      signal.throwIfAborted()
      if (typeof raw !== 'string' && !Buffer.isBuffer(raw))
        throw new TypeError(UI_TEXT.execRequestShape)
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      if (chunk.length > JUDGE_MAX_BODY_BYTES - pending.length - queuedBytes) {
        throw new Error(UI_TEXT.execFileTooLarge)
      }
      pending = Buffer.concat([pending, chunk])
      let lf = pending.indexOf('\n')
      while (lf !== -1) {
        const line = new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, lf))
        pending = pending.subarray(lf + 1)
        if (line !== '') submit(line)
        lf = pending.indexOf('\n')
      }
    }
    if (pending.length > 0) throw new Error(UI_TEXT.execRequestShape)
    await work
    return code
  } catch (error: unknown) {
    if (!output.hasFailed) throw error
    log?.warn(`Judge MCP loop failed: ${failureForLog(error)}`)
    return EXEC_EXIT.failed
  } finally {
    output.hasFailed = true
    signal.removeEventListener('abort', abort)
    for (const controllers of active.values())
      for (const controller of controllers) controller.abort()
  }
}
