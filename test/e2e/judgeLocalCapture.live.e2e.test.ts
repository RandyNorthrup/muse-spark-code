// One bounded free synthetic capture, before adding SystemOne/health parsers.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { localEndpoint, requestLocal } from '../../src/core/judge/local/transport'
import { requireInstalledPeer, windowsPeer } from '../../src/core/judge/local/windowsPeer'
import { JUDGE_REQUEST_TIMEOUT_MS } from '../../src/shared/constants'
import { compilePeer } from '../unit/helpers/localJudgeWindows'
import capture from '../unit/fixtures/localJudgeCapture.json'

describe.skipIf(process.platform !== 'win32' || process.env['MUSE_LOCAL_JUDGE_CAPTURE'] !== '1')(
  'M98-J2 one free SystemOne capture',
  () => {
    it('captures three answer kinds and loaded health without guessing fields', async () => {
      await mkdir(path.resolve('temp/m98-j2'), { recursive: true })
      const helper = await compilePeer()
      const endpoint = await localEndpoint('http://127.0.0.1:11434')
      const executable = path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs/Ollama/ollama.exe')
      const verify: Parameters<typeof requestLocal>[2] = async (socket) => {
        const peer = await windowsPeer(helper, socket)
        requireInstalledPeer(peer, {
          executable,
          ownerSid: peer.ownerSid,
          executableDigest: capture.runtime.executableDigest,
        })
        expect(socket.bytesWritten).toBe(0)
      }
      let previous: unknown = { inferenceAttempts: 0, metadataAttempts: 0, completed: false }
      try {
        previous = JSON.parse(
          await readFile(path.resolve('temp/m98-j2/capture-ledger.json'), 'utf8'),
        )
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      const ledger = z
        .object({
          inferenceAttempts: z.number().int().nonnegative(),
          metadataAttempts: z.number().int().nonnegative(),
          completed: z.boolean(),
        })
        .parse(previous)
      if (ledger.inferenceAttempts >= 2) throw new Error('capture ceiling reached')
      const save = () =>
        writeFile(path.resolve('temp/m98-j2/capture-ledger.json'), JSON.stringify(ledger, null, 2))
      ledger.metadataAttempts++
      await save()
      const tags = await requestLocal(endpoint, '/api/tags', verify)
      const request = {
        model: 'tev1:4b',
        state: 'git status',
        questions: {
          risk: { type: 'noul', instructions: 'Can this command delete data?' },
          kind: {
            type: 'choice',
            instructions: 'Select the command type.',
            criteria: { A: 'Read only', B: 'Deletes data' },
          },
          level: {
            type: 'score',
            instructions: 'Rate risk.',
            criteria: ['Read only', 'Changes data', 'Deletes data'],
          },
        },
      }
      ledger.inferenceAttempts++
      await save()
      const response = await requestLocal(
        endpoint,
        '/v1/systemone',
        verify,
        JSON.stringify(request),
        { timeoutMs: JUDGE_REQUEST_TIMEOUT_MS },
      )
      ledger.completed = true
      await save()
      ledger.metadataAttempts++
      await save()
      const health = await requestLocal(endpoint, '/api/ps', verify)
      await writeFile(
        path.resolve('test/unit/fixtures/localJudgeSystemOneCapture.json'),
        JSON.stringify(
          {
            workspace: 'C:/lanes/M98J2',
            runtimeVersion: '0.35.1',
            inferenceAttempts: ledger.inferenceAttempts,
            metadataAttempts: ledger.metadataAttempts,
            proof: 'runtime peer only; wire capture, not full provenance',
            request,
            response,
            tags,
            health,
          },
          null,
          2,
        ) + '\n',
      )
    })
  },
)
