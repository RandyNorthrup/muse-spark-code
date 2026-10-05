import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLocalJudgeSource,
  type LocalJudgeConfiguration,
  type LocalJudgeDependencies,
} from '../../src/core/judge/local/source'
import { judgeCapabilitySchema, judgeRequestSchema } from '../../src/core/judge/schema'
import capture from './fixtures/localJudgeSystemOneCapture.json'
import chat from './fixtures/localJudgeCapture.json'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'
import { REDACTED_MARK } from '../../src/shared/constants'

const servers: Server[] = []
function defaultResponse(route: string): unknown {
  if (route === '/api/tags') return capture.tags
  return route === '/api/ps' ? capture.health : capture.response
}
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve()
      }),
    )
})
async function fixture(trust: 'verified' | 'unverified' = 'verified') {
  const bodies: string[] = []
  const routes: string[] = []
  let respond: (route: string, body: string) => unknown = defaultResponse
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      const route = request.url ?? ''
      routes.push(route)
      if (body) bodies.push(body)
      response.end(JSON.stringify(respond(route, body)))
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test server')
  const endpoint = `http://127.0.0.1:${String(address.port)}`
  const config: LocalJudgeConfiguration = {
    enabled: true,
    selection: 'explicit',
    confidential: false,
    endpoint,
    model: 'tev1:4b',
    trust,
    installation: {
      platform: process.platform,
      certificationId: 'test-only-fake-receipt',
      nativeHost: true,
      modelDirectory: 'test-only-root',
    },
    capability: judgeCapabilitySchema.parse({
      source: 'separate',
      providerId: 'ollama',
      model: 'tev1:4b',
      modelVersion: '0.35.1',
      endpoint,
      captureId: 'localJudgeSystemOneCapture.json',
      logprobs: { kind: 'refused' },
      stated: false,
      systemone: true,
      reasoningForced: false,
      cache: false,
      contextWindowTokens: 2050,
      minOutputTokens: 1,
    }),
  }
  const verifyPeer = vi.fn(() => Promise.resolve('one-native-generation'))
  const verifyModel = vi.fn(() =>
    Promise.resolve({ digest: capture.health.models[0]!.digest, weightBytes: 1 }),
  )
  const deps: LocalJudgeDependencies = {
    configuration: () => config,
    verifyPeer,
    verifyModel,
    measureTokens: () => 1,
    chatPrompt: (request) => ({
      system: 'Answer exactly yes or no.',
      user: JSON.stringify({ state: request.state, questions: Object.values(request.questions) }),
    }),
  }
  return {
    config,
    deps,
    verifyPeer,
    verifyModel,
    bodies,
    routes,
    setResponse: (next: typeof respond) => {
      respond = next
    },
    source: createLocalJudgeSource(deps),
  }
}
const input = judgeRequestSchema.parse(capture.request)
const signal = () => new AbortController().signal
describe('M98 J2 source policy and exact content sockets', () => {
  it('proves metadata and each content socket again after disk hashing', async () => {
    const f = await fixture()
    f.verifyPeer.mockImplementation((...args: unknown[]) => {
      const socket = args[0]
      if (!socket || typeof socket !== 'object' || !('bytesWritten' in socket))
        throw new Error('missing socket')
      expect(socket.bytesWritten).toBe(0)
      return Promise.resolve('one-native-generation')
    })
    const result = await f.source.judge(input, signal())
    expect(result.outcome).toBe('answered')
    expect(f.routes).toEqual(['/api/tags', '/api/ps', '/v1/systemone'])
    expect(f.verifyPeer).toHaveBeenCalledTimes(4)
    expect(f.verifyModel).toHaveBeenCalledTimes(1)
    expect(JSON.parse(f.bodies[0]!)).toEqual({ ...input, model: 'tev1:4b' })
  })
  it.each(['auto', 'confidential'])(
    'refuses unverified %s without opening any socket',
    async (fault) => {
      const f = await fixture('unverified')
      Object.assign(f.config, fault === 'auto' ? { selection: 'auto' } : { confidential: true })
      expect(await f.source.judge(input, signal())).toEqual({
        outcome: 'no-answer',
        reason: fault === 'auto' ? 'local-unverified' : 'confidential-refused',
      })
      expect(f.routes).toEqual([])
      expect(f.verifyPeer).not.toHaveBeenCalled()
    },
  )
  it('uses only an explicit nonconfidential unverified endpoint', async () => {
    const f = await fixture('unverified')
    const result = await f.source.judge(input, signal())
    expect(result.outcome).toBe('answered')
    expect(f.verifyPeer).not.toHaveBeenCalled()
    expect(f.verifyModel).not.toHaveBeenCalled()
  })

  it('redacts state and criteria before a possibly forwarded endpoint without changing ids', async () => {
    const f = await fixture('unverified')
    const synthetic = CURRENT_SHAPE_KEYS[0]
    const request = {
      state: { nested: [synthetic] },
      questions: {
        risk: { type: 'noul', instructions: synthetic },
        kind: { type: 'choice', instructions: 'kind', criteria: { A: synthetic, B: 'other' } },
        level: { type: 'score', instructions: 'level', criteria: [synthetic, 'other', 'last'] },
      },
    }
    f.setResponse((route, body) => {
      if (route !== '/v1/systemone') return defaultResponse(route)
      const sent = judgeRequestSchema.parse(JSON.parse(body))
      const level = sent.questions['level']
      if (level?.type !== 'score') throw new Error('missing score fixture')
      return {
        ...capture.response,
        answers: {
          ...capture.response.answers,
          level: {
            ...capture.response.answers.level,
            legend: Object.fromEntries(
              level.criteria.map((label, index) => [String(index), label]),
            ),
          },
        },
      }
    })
    const result = await f.source.judge(judgeRequestSchema.parse(request), signal())
    expect(result.outcome).toBe('answered')
    expect(f.bodies).toHaveLength(1)
    expect(f.bodies[0]).not.toContain(synthetic)
    expect(f.bodies[0]).toContain(REDACTED_MARK)
    expect(Object.keys(judgeRequestSchema.parse(JSON.parse(f.bodies[0]!)).questions)).toEqual([
      'risk',
      'kind',
      'level',
    ])
  })

  it('keeps the uncalibrated qwen recommendation out of automatic selection', async () => {
    const f = await fixture()
    Object.assign(f.config, { selection: 'auto', model: chat.chat.model })
    expect(await f.source.judge(input, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'profile-missing',
    })
    expect(f.routes).toEqual([])
  })
  it.each(['disabled', 'native', 'platform', 'receipt', 'model', 'capability', 'request-model'])(
    'refuses %s before dispatch',
    async (fault) => {
      const f = await fixture()
      switch (fault) {
        case 'disabled': {
          Object.assign(f.config, { enabled: false })
          break
        }
        case 'native': {
          Object.assign(f.config.installation!, { nativeHost: false })
          break
        }
        case 'platform': {
          Object.assign(f.config.installation!, { platform: 'other' })
          break
        }
        case 'receipt': {
          Object.assign(f.config.installation!, { certificationId: '' })
          break
        }
        case 'model': {
          Object.assign(f.config, { model: 'cloud-model' })
          break
        }
        case 'capability': {
          Object.assign(f.config.capability, { endpoint: 'http://other' })
          break
        }
      }
      const result = await f.source.judge(
        fault === 'request-model' ? { ...input, model: 'other' } : input,
        signal(),
      )
      expect(result.outcome).toBe('no-answer')
      expect(f.routes).toEqual([])
    },
  )
  it('refuses a process replacement after metadata before sending content', async () => {
    const f = await fixture()
    f.verifyPeer.mockResolvedValueOnce('generation-one').mockResolvedValue('generation-two')
    expect(await f.source.judge(input, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'local-unverified',
    })
    expect(f.bodies).toEqual([])
  })
  it('rebinds confidentiality and mode after model verification waits', async () => {
    const f = await fixture()
    f.verifyModel.mockImplementation(() => {
      Object.assign(f.config, { confidential: true })
      return Promise.resolve({ digest: capture.health.models[0]!.digest, weightBytes: 1 })
    })
    expect(await f.source.judge(input, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'local-unverified',
    })
    expect(f.bodies).toEqual([])
  })

  it('refuses mismatching disk provenance on the exact content socket', async () => {
    const f = await fixture()
    f.verifyModel.mockResolvedValue({ digest: 'b'.repeat(64), weightBytes: 1 })
    expect(await f.source.judge(input, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'local-unverified',
    })
    expect(f.bodies).toEqual([])
  })
  it.each(['empty', 'duplicates', 'digest', 'missing-context'])(
    'refuses %s loaded health',
    async (fault) => {
      const f = await fixture()
      const health = structuredClone(capture.health)
      switch (fault) {
        case 'empty': {
          health.models = []
          break
        }
        case 'duplicates': {
          health.models.push(health.models[0]!)
          break
        }
        case 'digest': {
          health.models[0]!.digest = 'a'.repeat(64)
          break
        }
        case 'missing-context': {
          Object.assign(health.models[0]!, { context_length: undefined })
          break
        }
      }
      f.setResponse((route) => (route === '/api/tags' ? capture.tags : health))
      const result = await f.source.judge(input, signal())
      expect(result.outcome).toBe('no-answer')
      expect(f.bodies).toEqual([])
    },
  )
  it('measures the complete request against loaded context before content', async () => {
    const f = await fixture()
    f.deps.measureTokens = vi.fn((body: string) => {
      expect(JSON.parse(body)).toHaveProperty('state', 'git status')
      return 2050
    })
    expect(await f.source.judge(input, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'over-context',
    })
    expect(f.bodies).toEqual([])
  })
  it('drops cancelled work before sending any content', async () => {
    const f = await fixture()
    const controller = new AbortController()
    f.verifyModel.mockImplementation(() => {
      controller.abort()
      return Promise.resolve({ digest: capture.health.models[0]!.digest, weightBytes: 1 })
    })
    expect(await f.source.judge(input, controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(f.bodies).toEqual([])
  })
  it('splits qwen questions only, with the whole state and one fresh proof per call', async () => {
    const f = await fixture()
    Object.assign(f.config, {
      model: chat.chat.model,
      capability: {
        ...f.config.capability,
        model: chat.chat.model,
        systemone: false,
        logprobs: { kind: 'topk', topK: 5 },
      },
    })
    f.setResponse((route, body) => {
      if (route === '/api/tags') return chat.tags
      if (route === '/api/ps')
        return {
          models: [
            {
              name: chat.chat.model,
              digest: chat.tags.models.find((model) => model.name === chat.chat.model)!.digest,
              context_length: 2050,
            },
          ],
        }
      if (body.includes('first option'))
        return {
          ...chat.chat,
          message: { ...chat.chat.message, content: 'B' },
          logprobs: [
            {
              ...chat.chat.logprobs[0],
              token: 'B',
              top_logprobs: [
                { token: 'A', logprob: -2 },
                { token: 'B', logprob: -1 },
              ],
            },
          ],
        }
      return chat.chat
    })
    f.verifyModel.mockResolvedValue({
      digest: chat.tags.models.find((model) => model.name === chat.chat.model)!.digest,
      weightBytes: 1,
    })
    const request = judgeRequestSchema.parse({
      state: 'whole synthetic state',
      questions: {
        one: input.questions['risk']!,
        two: {
          type: 'choice',
          instructions: 'Choose one.',
          criteria: { C: 'first option', Z: 'second option' },
        },
      },
    })
    const result = await f.source.judge(request, signal())
    expect(result.outcome).toBe('answered')
    if (result.outcome !== 'answered') throw new Error('missing answer')
    expect(Object.keys(result.result.answers)).toEqual(['one', 'two'])
    expect(result.result.answers['two']).toMatchObject({ type: 'choice', choice: 'Z' })
    expect(result.result.usage.output_tokens).toBe(2)
    expect(f.bodies).toHaveLength(2)
    for (const body of f.bodies) expect(body).toContain('whole synthetic state')
    expect(f.bodies[1]).toContain(String.raw`\"A\":\"first option\"`)
    expect(f.bodies[1]).toContain(String.raw`\"B\":\"second option\"`)
    expect(f.verifyPeer).toHaveBeenCalledTimes(6)
    expect(f.verifyModel).toHaveBeenCalledTimes(2)
  })

  it('splits SystemOne questions to fit without splitting state or losing usage', async () => {
    const f = await fixture()
    f.deps.measureTokens = (body) =>
      Object.keys(judgeRequestSchema.parse(JSON.parse(body)).questions).length > 1 ? 2050 : 1
    f.setResponse((route, body) => {
      if (route === '/api/tags') return capture.tags
      if (route === '/api/ps') return capture.health
      const part = judgeRequestSchema.parse(JSON.parse(body))
      return {
        ...capture.response,
        answers: Object.fromEntries(
          Object.entries(capture.response.answers).filter(([id]) =>
            Object.hasOwn(part.questions, id),
          ),
        ),
      }
    })
    const result = await f.source.judge(input, signal())
    expect(result.outcome).toBe('answered')
    if (result.outcome !== 'answered') throw new Error('missing split result')
    expect(Object.keys(result.result.answers)).toEqual(Object.keys(input.questions))
    expect(result.result.usage.output_tokens).toBe(capture.response.usage.output_tokens * 3)
    expect(f.bodies).toHaveLength(3)
    for (const body of f.bodies)
      expect(judgeRequestSchema.parse(JSON.parse(body)).state).toBe(input.state)
    expect(f.verifyModel).toHaveBeenCalledTimes(3)
  })
})
