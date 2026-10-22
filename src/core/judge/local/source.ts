import * as z from 'zod/mini'
import type { Socket } from 'node:net'
import {
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_MAX_BODY_BYTES,
  JUDGE_REQUEST_TIMEOUT_MS,
  LOCAL_JUDGE_MAX_MODELS,
} from '../../../shared/constants'
import type { JudgeRuntime } from '../engine'
import { redactSecrets } from '../../redact'
import {
  judgeCapabilitySchema,
  judgeRequestSchema,
  judgeResultSchema,
  judgeOptionLetter,
  type JudgeCapability,
  type JudgeOutcome,
  type JudgeRequest,
  type JudgeResult,
} from '../schema'
import { verifyDiskModel } from './model'
import { LOCAL_JUDGE_RECOMMENDATIONS } from './recommendations'
import { localEndpoint, requestLocal } from './transport'
import { localChatResult, localSystemOneResult } from './wire'

/** Supplied by assembly, never inferred from an answering loopback listener. */
export interface LocalJudgeConfiguration {
  readonly enabled: boolean
  readonly selection: 'explicit' | 'auto'
  readonly confidential: boolean
  readonly endpoint: string
  readonly model: string
  readonly trust: 'verified' | 'unverified'
  readonly capability: JudgeCapability
  readonly installation?: {
    readonly platform: NodeJS.Platform
    readonly certificationId: string
    readonly nativeHost: boolean
    readonly modelDirectory: string
  }
}

export interface LocalJudgeDependencies {
  configuration(): LocalJudgeConfiguration | undefined
  /** Native peer/runtime/root proof; returns an exact process generation key. */
  verifyPeer(socket: Socket, config: LocalJudgeConfiguration, signal: AbortSignal): Promise<string>
  /** Complete wire request overhead, measured by the chosen model's token counter. */
  measureTokens(body: string, config: LocalJudgeConfiguration): number
  /** Model-facing wording is supplied from the lazy model-text block by assembly. */
  chatPrompt(request: JudgeRequest): { system: string; user: string }
  /** Optional I/O seam; defaults to the actual disk verifier, never a fake. */
  verifyModel?: typeof verifyDiskModel
}

// /api/ps captured on win11 in localJudgeSystemOneCapture.json (2 attempts).
const modelIdentityFields = {
  name: z.string().check(z.minLength(1)),
  digest: z.string().check(z.regex(/^[a-f\d]{64}$/)),
}
const healthSchema = z.looseObject({
  models: z
    .array(
      z.looseObject({
        ...modelIdentityFields,
        context_length: z.int().check(z.positive()),
      }),
    )
    .check(z.maxLength(LOCAL_JUDGE_MAX_MODELS)),
})
const tagsSchema = z.looseObject({
  models: z.array(z.looseObject(modelIdentityFields)).check(z.maxLength(LOCAL_JUDGE_MAX_MODELS)),
})

function redactedValue(value: unknown): unknown {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new TypeError('invalid-local-input')
  const decoded: unknown = JSON.parse(redactSecrets(serialized))
  return decoded
}

/** Local inference is a request-only, free advisory source; no fallback/pull path. */
export function createLocalJudgeSource(deps: LocalJudgeDependencies): JudgeRuntime {
  return {
    async judge(input, callerSignal): Promise<JudgeOutcome> {
      const config = deps.configuration()
      if (!config?.enabled) return { outcome: 'no-answer', reason: 'source-unavailable' }
      if (config.trust === 'unverified' && config.confidential)
        return { outcome: 'no-answer', reason: 'confidential-refused' }
      if (config.trust === 'unverified' && config.selection !== 'explicit')
        return { outcome: 'no-answer', reason: 'local-unverified' }
      if (
        config.trust === 'verified' &&
        (!config.installation?.nativeHost ||
          config.installation.platform !== process.platform ||
          !config.installation.certificationId)
      )
        return { outcome: 'no-answer', reason: 'local-unverified' }
      const recommendation = LOCAL_JUDGE_RECOMMENDATIONS.find((item) => item.model === config.model)
      if (!recommendation) return { outcome: 'no-answer', reason: 'capability-unavailable' }
      if (config.selection === 'auto' && recommendation.requiresCalibrationForAuto)
        return { outcome: 'no-answer', reason: 'profile-missing' }
      const initial = JSON.stringify(config)
      const deadline = AbortSignal.timeout(JUDGE_REQUEST_TIMEOUT_MS)
      const signal = AbortSignal.any([callerSignal, deadline])
      const current = () => {
        signal.throwIfAborted()
        if (JSON.stringify(deps.configuration()) !== initial)
          throw new Error('local-configuration-changed')
      }
      try {
        current()
        const parsed = judgeRequestSchema.parse(input)
        // An explicitly unverified loopback peer may forward remotely. Keep
        // question ids stable, and redact all judged data before any content.
        const request = judgeRequestSchema.parse({
          ...parsed,
          state: redactedValue(parsed.state),
          questions: Object.fromEntries(
            Object.entries(parsed.questions).map(([id, question]) => [id, redactedValue(question)]),
          ),
        })
        const capability = judgeCapabilitySchema.parse(config.capability)
        if (request.model !== undefined && request.model !== config.model)
          return { outcome: 'no-answer', reason: 'capability-unavailable' }
        if (
          capability.source !== 'separate' ||
          capability.providerId !== 'ollama' ||
          capability.model !== config.model ||
          capability.endpoint !== config.endpoint ||
          (recommendation.technique === 'systemone'
            ? !capability.systemone
            : capability.logprobs.kind !== 'topk')
        )
          return { outcome: 'no-answer', reason: 'capability-unavailable' }
        const endpoint = await localEndpoint(config.endpoint)
        current()
        let generation: string | undefined
        const peer = async (socket: Socket) => {
          current()
          if (config.trust !== 'verified') return
          const proof = await deps.verifyPeer(socket, config, signal)
          current()
          if (!proof || (generation !== undefined && proof !== generation))
            throw new Error('unverified-runtime-generation')
          generation = proof
        }
        const options = { signal, timeoutMs: JUDGE_REQUEST_TIMEOUT_MS }
        const tags = tagsSchema.parse(
          await requestLocal(endpoint, '/api/tags', peer, undefined, options),
        )
        current()
        const health = healthSchema.parse(
          await requestLocal(endpoint, '/api/ps', peer, undefined, options),
        )
        current()
        const served = tags.models.filter((item) => item.name === config.model)
        const loaded = health.models.filter((item) => item.name === config.model)
        if (
          served.length !== 1 ||
          loaded.length !== 1 ||
          !served[0]?.digest ||
          !loaded[0]?.digest ||
          served[0].digest !== loaded[0].digest
        )
          return { outcome: 'no-answer', reason: 'source-unavailable' }
        const context = Math.min(
          loaded[0].context_length,
          capability.contextWindowTokens,
          JUDGE_MAX_STATE_TOKENS,
        )
        const serialize = (part: JudgeRequest): string => {
          if (recommendation.technique === 'systemone')
            return JSON.stringify({ ...part, model: config.model })
          // The logprob technique reads contiguous A–Z tokens. Keep original
          // sparse criteria keys for the result, but address the prompt by index.
          const promptRequest: JudgeRequest = {
            ...part,
            questions: Object.fromEntries(
              Object.entries(part.questions).map(([id, question]) => [
                id,
                question.type === 'choice'
                  ? {
                      ...question,
                      criteria: Object.fromEntries(
                        Object.values(question.criteria).map((label, index) => [
                          judgeOptionLetter(index),
                          label,
                        ]),
                      ),
                    }
                  : question,
              ]),
            ),
          }
          const prompt = deps.chatPrompt(promptRequest)
          return JSON.stringify({
            model: config.model,
            stream: false,
            think: false,
            logprobs: true,
            top_logprobs: capability.logprobs.kind === 'topk' ? capability.logprobs.topK : 1,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            options: { num_predict: 1, temperature: 0 },
          })
        }
        const canFit = (part: JudgeRequest): boolean => {
          const body = serialize(part)
          const tokens = deps.measureTokens(body, config)
          if (!Number.isSafeInteger(tokens) || tokens < 0)
            throw new Error('invalid-token-measurement')
          return (
            Buffer.byteLength(body) <= JUDGE_MAX_BODY_BYTES &&
            tokens + capability.minOutputTokens * Object.keys(part.questions).length <= context
          )
        }
        const requests: JudgeRequest[] = []
        let pending: JudgeRequest['questions'] = {}
        for (const [id, question] of Object.entries(request.questions)) {
          const candidate = { ...request, questions: { ...pending, [id]: question } }
          if (recommendation.technique === 'systemone' && canFit(candidate)) {
            pending = candidate.questions
            continue
          }
          if (Object.keys(pending).length > 0) requests.push({ ...request, questions: pending })
          pending = { [id]: question }
          if (!canFit({ ...request, questions: pending }))
            return { outcome: 'no-answer', reason: 'over-context' }
          if (recommendation.technique === 'systemone') {
            continue
          }

          requests.push({ ...request, questions: pending })
          pending = {}
        }
        if (Object.keys(pending).length > 0) requests.push({ ...request, questions: pending })
        const bodies = requests.map((part) => serialize(part))
        // Admission plans ALL questions before any content, never splits the state.
        for (const [index, body] of bodies.entries()) {
          const tokens = deps.measureTokens(body, config)
          if (!Number.isSafeInteger(tokens) || tokens < 0)
            throw new Error('invalid-token-measurement')
          if (
            Buffer.byteLength(body) > JUDGE_MAX_BODY_BYTES ||
            tokens +
              capability.minOutputTokens * Object.keys(requests[index]?.questions ?? {}).length >
              context
          )
            return { outcome: 'no-answer', reason: 'over-context' }
        }
        const results: JudgeResult[] = []
        for (const [index, body] of bodies.entries()) {
          const part = requests[index]
          if (!part) throw new Error('invalid-local-batch')
          const response = await requestLocal(
            endpoint,
            recommendation.technique === 'systemone' ? '/v1/systemone' : '/api/chat',
            async (socket) => {
              await peer(socket)
              if (config.trust === 'verified') {
                const installation = config.installation
                if (!installation) throw new Error('unverified-installation')
                const model = await (deps.verifyModel ?? verifyDiskModel)(
                  tags,
                  config.model,
                  installation.modelDirectory,
                  signal,
                )
                if (model.digest !== served[0]?.digest) throw new Error('unverified-model-digest')
                await peer(socket)
              }
              current()
            },
            body,
            options,
          )
          current()
          results.push(
            recommendation.technique === 'systemone'
              ? localSystemOneResult(response, part, config.model)
              : localChatResult(response, part, config.model),
          )
        }
        const first = results[0]
        if (!first) throw new Error('missing-local-result')
        const result = {
          ...first,
          answers: Object.fromEntries(results.flatMap((item) => Object.entries(item.answers))),
          muse: Object.fromEntries(results.flatMap((item) => Object.entries(item.muse))),
          usage: {
            input_tokens: results.reduce((sum, item) => sum + item.usage.input_tokens, 0),
            output_tokens: results.reduce((sum, item) => sum + item.usage.output_tokens, 0),
          },
        }
        return { outcome: 'answered', result: judgeResultSchema.parse(result) }
      } catch (error: unknown) {
        if (callerSignal.aborted) return { outcome: 'no-answer', reason: 'cancelled' }
        if (deadline.aborted || (error instanceof Error && error.message === 'local-timeout'))
          return { outcome: 'no-answer', reason: 'timeout' }
        return {
          outcome: 'no-answer',
          reason:
            error instanceof Error &&
            (error.message.startsWith('unverified-') ||
              error.message === 'local-configuration-changed')
              ? 'local-unverified'
              : 'engine-failure',
        }
      }
    },
  }
}
