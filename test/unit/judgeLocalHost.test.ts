import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, rename, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createHostLocalJudge,
  localJudgeStatus,
  type LocalJudgeHostDependencies,
} from '../../src/host/judge/local'
import { judgeCapabilitySchema } from '../../src/core/judge/schema'
import type { LocalJudgeConfiguration } from '../../src/core/judge/local/source'
import { windowsModelDirectory } from '../../src/core/judge/local/windowsPeer'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { compilePeer } from './helpers/localJudgeWindows'

describe('M98 J2 host posture and status', () => {
  it.each(['remote', 'container', 'wsl', 'unknown'] as const)(
    'refuses %s before writing even metadata',
    async (scope) => {
      let requests = 0
      const server = createServer((_request, response) => {
        requests++
        response.end('{}')
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing host test socket')
      const endpoint = `http://127.0.0.1:${String(address.port)}`
      const config: LocalJudgeConfiguration = {
        enabled: true,
        selection: 'explicit',
        trust: 'verified',
        model: 'tev1:4b',
        endpoint,
        confidential: false,
        installation: {
          platform: process.platform,
          certificationId: 'test-only',
          modelDirectory: 'test-root',
          nativeHost: true,
        },
        capability: judgeCapabilitySchema.parse({
          source: 'separate',
          providerId: 'ollama',
          model: 'tev1:4b',
          modelVersion: '0.35.1',
          endpoint,
          captureId: 'capture',
          logprobs: { kind: 'refused' },
          stated: false,
          systemone: true,
          reasoningForced: false,
          cache: false,
          contextWindowTokens: 2050,
          minOutputTokens: 1,
        }),
      }
      const peerHelperCalls: unknown[] = []
      const deps: LocalJudgeHostDependencies = {
        configuration: () => config,
        nativeScope: () => scope,
        peerHelper: () => {
          peerHelperCalls.push(true)
          return Promise.resolve('unused')
        },
        runtimeInstallation: () => undefined,
        chatPrompt: () => ({ system: 'test', user: 'test' }),
        measureTokens: () => 1,
      }
      try {
        const result = await createHostLocalJudge(deps).judge(
          { state: 'private-state', questions: { risk: { type: 'noul', instructions: 'risk' } } },
          new AbortController().signal,
        )
        expect(result).toEqual({ outcome: 'no-answer', reason: 'local-unverified' })
        expect(peerHelperCalls).toHaveLength(0)
        expect(requests).toBe(0)
        expect(localJudgeStatus({ ...config, trust: 'unverified' })).toEqual({
          label: UI_TEXT.judgeLocalUnverified,
          model: 'tev1:4b',
          trust: 'unverified',
        })
      } finally {
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve()
          }),
        )
      }
    },
  )
})

describe.skipIf(process.platform !== 'win32')('M98 J2 real Windows model-volume helper', () => {
  it('accepts a canonical fixed-volume fixture and refuses a junction root', async () => {
    await mkdir(path.resolve('temp'), { recursive: true })
    const root = await mkdtemp(path.resolve('temp/local-judge-root-'))
    const moved = `${root}-real`
    const helper = await compilePeer()
    try {
      await expect(
        windowsModelDirectory(helper, await realpath(root), new AbortController().signal),
      ).resolves.toBeUndefined()
      await rename(root, moved)
      await symlink(moved, root, 'junction')
      await expect(
        windowsModelDirectory(helper, root, new AbortController().signal),
      ).rejects.toThrow('unverified-model-root')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(moved, { recursive: true, force: true })
    }
  })
})
