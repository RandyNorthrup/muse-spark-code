// Fake-only adapter check. Native proof itself is exercised in the other Mac suites.
import { once } from 'node:events'
import { createServer } from 'node:http'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createHostLocalJudge } from '../../src/host/judge/local'
import { judgeCapabilitySchema, judgeRequestSchema } from '../../src/core/judge/schema'
import { darwinPeerDependencies } from '../../src/core/judge/local/darwinPeer'
import { posixPeer } from '../../src/core/judge/local/posixPeer'
import capture from './fixtures/localJudgeDarwinCapture.json'

const native = vi.hoisted(() => ({
  acquireProcess: () => Promise.reject(new Error('fake adapter seam only')),
  verifyLocalVolume: () => Promise.reject(new Error('fake adapter seam only')),
}))
vi.mock('../../src/core/judge/local/darwinPeer', () => ({
  darwinPeerDependencies: vi.fn(() => native),
}))
vi.mock('../../src/core/judge/local/posixPeer', () => ({
  posixPeer: vi.fn(() => Promise.resolve('fake-adapter-generation')),
}))

describe.skipIf(process.platform !== 'darwin')('M98 macOS host native default', () => {
  it('creates the real platform adapter lazily when no override is supplied', async () => {
    const server = createServer((request, response) => {
      let value: unknown = capture.response
      if (request.url === '/api/tags') value = capture.tags
      else if (request.url === '/api/ps') value = capture.health
      response.end(JSON.stringify(value))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing adapter test socket')
    const endpoint = `http://127.0.0.1:${String(address.port)}`
    const installed = {
      platform: 'darwin' as const,
      executable: '/fake/Ollama.app/Contents/Resources/ollama',
      executableDigest: capture.executableDigest,
      uid: capture.peers[0]!.uid,
      modelDirectory: path.resolve('temp/fake-model-root'),
    }
    const configuration = {
      enabled: true,
      selection: 'explicit' as const,
      confidential: true,
      trust: 'verified' as const,
      endpoint,
      model: capture.request.model,
      installation: {
        platform: 'darwin' as const,
        certificationId: 'fake-adapter-only',
        nativeHost: true,
        modelDirectory: installed.modelDirectory,
      },
      capability: judgeCapabilitySchema.parse({
        source: 'separate',
        providerId: 'ollama',
        model: capture.request.model,
        modelVersion: capture.runtimeVersion,
        endpoint,
        captureId: 'localJudgeDarwinCapture.json',
        logprobs: { kind: 'refused' },
        stated: false,
        systemone: true,
        reasoningForced: false,
        cache: false,
        contextWindowTokens: 2050,
        minOutputTokens: 1,
      }),
    }
    const peerHelper = vi.fn(() => Promise.resolve('/packaged/native-helper'))
    const source = createHostLocalJudge({
      configuration: () => configuration,
      nativeScope: () => 'native',
      peerHelper,
      runtimeInstallation: () => undefined,
      posixRuntimeInstallation: () => installed,
      measureTokens: () => 1,
      chatPrompt: () => {
        throw new Error('unused chat prompt')
      },
      verifyModel: () => Promise.resolve(capture.disk),
    })
    try {
      expect(darwinPeerDependencies).not.toHaveBeenCalled()
      const outcome = await source.judge(
        judgeRequestSchema.parse(capture.request),
        new AbortController().signal,
      )
      expect(outcome.outcome).toBe('answered')
      expect(darwinPeerDependencies).toHaveBeenCalledTimes(4)
      expect(peerHelper).toHaveBeenCalledWith('darwin')
      for (const call of vi.mocked(posixPeer).mock.calls) expect(call[2]).toBe(native)
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve()
        }),
      )
    }
  })
})
