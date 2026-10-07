// Projected from win11's 2026-10-06 usage capture (m113-s-local-sources.md).
// Conversation fields, plan labels, account ids and credit balances are never retained.
import * as z from 'zod/mini'
import { MILLISECONDS_PER_SECOND, REPORT_MAX_ROWS } from '../../../shared/constants'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  sourceReason,
  type LocalFileIo,
  type LocalFailure,
  type SourceScrub,
} from './local'
import type { UsageFacts } from './types'
import { scrubUsage } from './session'

export type AgentUsageAgent = 'claudeCode' | 'codex'
export interface AgentUsageFile {
  readonly agent: AgentUsageAgent
  readonly file: string
  readonly io: LocalFileIo
}
export type AgentUsageFiles =
  readonly AgentUsageFile[] | ((signal: AbortSignal) => Promise<readonly AgentUsageFile[]>)
const tokens = z.number().check(z.int(), z.nonnegative())
const envelope = z.object({ type: z.string() })
const claudeUsage = z.object({
  type: z.literal('assistant'),
  timestamp: z.iso.datetime({ offset: true }),
  message: z.object({
    id: z.string(),
    model: z.string(),
    usage: z.object({
      input_tokens: tokens,
      output_tokens: tokens,
      cache_read_input_tokens: tokens,
      cache_creation_input_tokens: tokens,
    }),
  }),
})
const windowSchema = z.object({
  used_percent: z.number().check(z.minimum(0), z.maximum(100)),
  resets_at: tokens,
  window_minutes: tokens,
})
const codexUsage = z.object({
  type: z.literal('event_msg'),
  timestamp: z.iso.datetime({ offset: true }),
  payload: z.object({
    type: z.literal('token_count'),
    info: z.nullable(
      z.object({
        total_token_usage: z.object({
          input_tokens: tokens,
          cached_input_tokens: tokens,
          output_tokens: tokens,
        }),
      }),
    ),
    rate_limits: z.nullable(
      z.object({ primary: z.nullable(windowSchema), secondary: z.nullable(windowSchema) }),
    ),
  }),
})
const tokenEvent = z.object({ payload: z.object({ type: z.string() }) })

/** Allow only the captured usage-bearing session paths, never arbitrary user files. */
export function isAgentUsagePath(agent: AgentUsageAgent, file: string): boolean {
  const normalized = file.replaceAll('\\', '/').toLowerCase()
  if (
    normalized
      .split('/')
      .some(
        (part) =>
          part === '..' ||
          part === '' ||
          /^(?:\.?credentials?|auth|secrets?|tokens?)(?:\.|$)/u.test(part) ||
          part.startsWith('.env'),
      )
  )
    return false
  return agent === 'claudeCode'
    ? /^projects\/[^/]+\/(?:subagents\/)?[^/]+\.jsonl$/u.test(normalized)
    : /^sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[^/]+\.jsonl$/u.test(normalized)
}
function emptyUsage(): UsageFacts {
  return {
    period: 'session',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    costUsd: null,
    certainty: 'unknown',
    breakdown: [],
    limits: [],
  }
}
function parseUsage(
  agent: AgentUsageAgent,
  text: string,
  asOf: string,
): { usage: UsageFacts; observedAt: string } {
  let usage = emptyUsage()
  let observedAt: string | undefined
  const messages = new Map<string, z.infer<typeof claudeUsage>>()
  const codexEvents: z.infer<typeof codexUsage>[] = []
  for (const line of text.split(/\r?\n/u)) {
    if (line === '') continue
    const raw: unknown = JSON.parse(line)
    const type = envelope.parse(raw).type
    if (agent === 'claudeCode' && type === 'assistant') {
      const entry = claudeUsage.parse(raw)
      entry.timestamp = new Date(entry.timestamp).toISOString()
      const previous = messages.get(entry.message.id)
      if (
        Date.parse(entry.timestamp) <= Date.parse(asOf) &&
        (previous === undefined ||
          codeUnitCompare(
            `${entry.timestamp}/${JSON.stringify(entry.message)}`,
            `${previous.timestamp}/${JSON.stringify(previous.message)}`,
          ) > 0)
      )
        messages.set(entry.message.id, entry)
    } else if (
      agent === 'codex' &&
      type === 'event_msg' &&
      tokenEvent.parse(raw).payload.type === 'token_count'
    ) {
      const entry = codexUsage.parse(raw)
      entry.timestamp = new Date(entry.timestamp).toISOString()
      if (Date.parse(entry.timestamp) <= Date.parse(asOf)) codexEvents.push(entry)
    }
    if (messages.size > REPORT_MAX_ROWS || codexEvents.length > REPORT_MAX_ROWS)
      throw new LocalSourceError('limit')
  }
  if (agent === 'codex') {
    let hasUsage = false
    const orderedEvents = codexEvents.toSorted(
      (a, b) =>
        Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
        codeUnitCompare(JSON.stringify(a.payload), JSON.stringify(b.payload)),
    )
    for (const entry of orderedEvents) {
      if (entry.payload.info !== null) {
        const totals = entry.payload.info.total_token_usage
        usage = {
          ...usage,
          inputTokens: totals.input_tokens,
          outputTokens: totals.output_tokens,
          cachedTokens: totals.cached_input_tokens,
        }
        hasUsage = true
      }
      if (entry.payload.rate_limits !== null) {
        usage = {
          ...usage,
          limits: ['primary', 'secondary'].flatMap((key) => {
            const window =
              key === 'primary'
                ? entry.payload.rate_limits?.primary
                : entry.payload.rate_limits?.secondary
            return window == null
              ? []
              : [
                  {
                    key,
                    used: window.used_percent,
                    limit: 100,
                    resetsAt: new Date(window.resets_at * MILLISECONDS_PER_SECOND).toISOString(),
                  },
                ]
          }),
        }
      }
      observedAt = entry.timestamp
    }
    if (!hasUsage) throw new LocalSourceError('missing')
  } else {
    for (const entry of messages.values()) {
      const tokens = entry.message.usage
      usage = {
        ...usage,
        inputTokens:
          usage.inputTokens +
          tokens.input_tokens +
          tokens.cache_read_input_tokens +
          tokens.cache_creation_input_tokens,
        outputTokens: usage.outputTokens + tokens.output_tokens,
        cachedTokens: (usage.cachedTokens ?? 0) + tokens.cache_read_input_tokens,
      }
      const previous = usage.breakdown.find((row) => row.key === entry.message.model)
      const row = {
        key: entry.message.model,
        inputTokens:
          (previous?.inputTokens ?? 0) +
          tokens.input_tokens +
          tokens.cache_read_input_tokens +
          tokens.cache_creation_input_tokens,
        outputTokens: (previous?.outputTokens ?? 0) + tokens.output_tokens,
        costUsd: null,
        certainty: 'unknown',
      }
      usage = {
        ...usage,
        breakdown: [
          ...usage.breakdown.filter((item) => item.key !== row.key),
          { ...row, certainty: 'unknown' },
        ],
      }
      if (observedAt === undefined || Date.parse(entry.timestamp) > Date.parse(observedAt))
        observedAt = entry.timestamp
    }
  }
  if (observedAt === undefined) throw new LocalSourceError('missing')
  return { usage, observedAt }
}
export function agentUsageSource(
  enabled: readonly AgentUsageAgent[],
  files: AgentUsageFiles,
  scrub: SourceScrub,
) {
  return localSource('agentUsage', async ({ signal, asOf }) => {
    if (enabled.length === 0) throw new LocalSourceError('disabled')
    const selectedFiles = typeof files === 'function' ? await files(signal) : files
    if (selectedFiles.length > REPORT_MAX_ROWS) throw new LocalSourceError('limit')
    if (
      new Set(selectedFiles.map((file) => `${file.agent}/${file.file.replaceAll('\\', '/')}`))
        .size !== selectedFiles.length
    )
      throw new LocalSourceError('invalid')
    const rows: { agent: string; file: string; usage: UsageFacts }[] = []
    const failures: LocalFailure[] = []
    let observedAt: string | undefined
    const orderedFiles = selectedFiles.toSorted((a, b) =>
      codeUnitCompare(`${a.agent}/${a.file}`, `${b.agent}/${b.file}`),
    )
    for (const file of orderedFiles) {
      if (!enabled.includes(file.agent)) continue
      try {
        if (!isAgentUsagePath(file.agent, file.file)) throw new LocalSourceError('refused')
        const parsed = parseUsage(
          file.agent,
          await file.io.read(file.file.replaceAll('\\', '/'), signal),
          asOf,
        )
        rows.push({
          agent: file.agent,
          file: scrub(
            `~/${file.agent === 'codex' ? '.codex' : '.claude'}/${file.file.replaceAll('\\', '/')}`,
          ),
          usage: scrubUsage(parsed.usage, scrub),
        })
        if (observedAt === undefined || Date.parse(parsed.observedAt) < Date.parse(observedAt))
          observedAt = parsed.observedAt
      } catch (error) {
        failures.push(error instanceof LocalSourceError ? error.code : 'invalid')
      }
    }
    if (observedAt === undefined || rows.length === 0)
      throw new LocalSourceError(failures[0] ?? 'missing')
    if (enabled.some((agent) => rows.every((row) => row.agent !== agent))) failures.push('missing')
    return {
      data: rows,
      observedAt,
      ...(failures.length > 0 && { partial: sourceReason(failures[0] ?? 'failed') }),
    }
  })
}
