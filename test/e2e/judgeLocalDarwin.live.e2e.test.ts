// Rig-authorized native smoke: one <=1GB model; six inference attempts maximum.
// No download, account/key read, cloud call or model mutation occurs here.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  darwinPeerDependencies,
  requireDarwinInstallation,
} from '../../src/core/judge/local/darwinPeer'
import { posixPeer } from '../../src/core/judge/local/posixPeer'
import { verifyDiskModel } from '../../src/core/judge/local/model'
import { localEndpoint, requestLocal } from '../../src/core/judge/local/transport'
import { createHostLocalJudge } from '../../src/host/judge/local'
import { judgeCapabilitySchema } from '../../src/core/judge/schema'

const ROOT = path.resolve('temp/m98-j3')
const MODEL = 'tev1:0.8b-q8_0'
const endpointText = 'http://127.0.0.1:11434'
const ledgerFile = path.join(ROOT, 'calls.json')
const ledgerSchema = z.object({
  attempts: z.number().int().min(0).max(6),
  completed: z.number().int().min(0).max(6),
})
async function ledger() {
  return ledgerSchema.parse(JSON.parse(await readFile(ledgerFile, 'utf8')))
}
async function claim() {
  const counts = await ledger()
  if (counts.attempts >= 6) throw new Error('native inference ceiling reached')
  counts.attempts++
  await writeFile(ledgerFile, JSON.stringify(counts, null, 2))
}
async function settle() {
  const counts = await ledger()
  counts.completed++
  await writeFile(ledgerFile, JSON.stringify(counts, null, 2))
}
async function installation() {
  const getUid = process.getuid
  const uid = getUid?.()
  if (uid === undefined) throw new Error('missing native uid')
  const executable = path.join(ROOT, 'install/Ollama.app/Contents/Resources/ollama')
  // Digest of the independently downloaded, Apple-verified release, not of a peer's path.
  const executableDigest = createHash('sha256')
    .update(await readFile(executable))
    .digest('hex')
  const installed = {
    platform: 'darwin' as const,
    executable,
    executableDigest,
    uid,
    modelDirectory: path.join(ROOT, 'models'),
  }
  await requireDarwinInstallation(installed, new AbortController().signal)
  return installed
}

describe.skipIf(process.platform !== 'darwin' || process.env['MUSE_LOCAL_JUDGE_DARWIN'] !== '1')(
  'M98 J3 real macOS installed source',
  () => {
    it('captures one full native peer/model/transport response and health', async () => {
      const installed = await installation()
      const helper = path.resolve('native/darwin/muse-local-judge-peer')
      const native = darwinPeerDependencies(helper, installed)
      const endpoint = await localEndpoint(endpointText)
      const signal = new AbortController().signal
      const peers: unknown[] = []
      const ports: number[] = []
      const verify: Parameters<typeof requestLocal>[2] = async (socket) => {
        expect(socket.bytesWritten).toBe(0)
        peers.push(JSON.parse(await posixPeer(socket, installed, native, signal)))
        if (!socket.localPort) throw new Error('missing native client port')
        ports.push(socket.localPort)
      }
      const tags = await requestLocal(endpoint, '/api/tags', verify)
      const request = {
        model: MODEL,
        state: 'git status',
        questions: { risk: { type: 'noul', instructions: 'Can this command delete data?' } },
      }
      const start = performance.now()
      let disk: Awaited<ReturnType<typeof verifyDiskModel>> | undefined
      let verifiedMs = 0
      const response = await requestLocal(
        endpoint,
        '/v1/systemone',
        async (socket) => {
          await verify(socket)
          disk = await verifyDiskModel(tags, MODEL, installed.modelDirectory, signal)
          await verify(socket)
          await claim()
          verifiedMs = performance.now() - start
        },
        JSON.stringify(request),
        { signal, timeoutMs: 60_000 },
      )
      await settle()
      const elapsedMs = performance.now() - start
      const health = await requestLocal(endpoint, '/api/ps', verify)
      // Profile/account names and install paths are scrubbed; no judged repository text.
      const scrub = (value: unknown): unknown => {
        const decoded: unknown = JSON.parse(
          JSON.stringify(value).replaceAll(
            installed.executable,
            '<rig-install>/Ollama.app/Contents/Resources/ollama',
          ),
        )
        return decoded
      }
      await writeFile(
        path.resolve('test/unit/fixtures/localJudgeDarwinCapture.json'),
        JSON.stringify(
          {
            workspace: '/Users/<owner>/lanes/M98J3M',
            runtimeVersion: '0.35.1',
            platform: 'darwin-x64',
            releaseArchiveSha256:
              '60dba52660dc7cb4e160e914edd76b98271945941f5db40d34a507cef544970e',
            teamId: '3MU9H2V9Y9',
            executableDigest: installed.executableDigest,
            counts: await ledger(),
            request,
            response,
            tags,
            health,
            peers: scrub(peers),
            ports,
            disk,
            elapsedMs,
            verifiedMs,
            noBytesBeforeProof: true,
          },
          null,
          2,
        ) + '\n',
      )
      expect(disk?.weightBytes).toBeLessThan(1_000_000_000)
      expect(new Set(ports).size).toBe(3)
    })
    it('returns a positive through createHostLocalJudge and fresh native sockets', async () => {
      const installed = await installation()
      const capture: unknown = JSON.parse(
        await readFile(path.resolve('test/unit/fixtures/localJudgeDarwinCapture.json'), 'utf8'),
      )
      const loaded = z
        .object({
          health: z.object({
            models: z.array(z.object({ name: z.string(), context_length: z.number() })),
          }),
        })
        .parse(capture)
        .health.models.find((model) => model.name === MODEL)
      if (!loaded) throw new Error('missing captured loaded model')
      const config = {
        enabled: true,
        selection: 'explicit' as const,
        confidential: true,
        trust: 'verified' as const,
        endpoint: endpointText,
        model: MODEL,
        installation: {
          platform: 'darwin' as const,
          certificationId: 'm98-j3-macos-native-smoke',
          nativeHost: true,
          modelDirectory: installed.modelDirectory,
        },
        capability: judgeCapabilitySchema.parse({
          source: 'separate',
          providerId: 'ollama',
          model: MODEL,
          modelVersion: '0.35.1',
          endpoint: endpointText,
          captureId: 'localJudgeDarwinCapture.json',
          logprobs: { kind: 'refused' },
          stated: false,
          systemone: true,
          reasoningForced: false,
          cache: false,
          contextWindowTokens: loaded.context_length,
          minOutputTokens: 1,
        }),
      }
      let checks = 0
      const start = performance.now()
      const source = createHostLocalJudge({
        configuration: () => config,
        nativeScope: () => 'native',
        peerHelper: () => Promise.resolve(path.resolve('native/darwin/muse-local-judge-peer')),
        runtimeInstallation: () => undefined,
        posixRuntimeInstallation: () => installed,
        // A conservative byte bound for this tiny captured smoke only. Z owns the
        // exact SystemOne tokenizer/hidden-prompt accounting for product admission.
        measureTokens: (body) => Buffer.byteLength(body),
        chatPrompt: () => {
          throw new Error('not a chat model')
        },
        async verifyModel(tags, model, directory, signal) {
          const proof = await verifyDiskModel(tags, model, directory, signal)
          checks++
          // Count before the content dispatch; a refused or uncertain send still consumes the claim.
          await claim()
          return proof
        },
      })
      const outcome = await source.judge(
        {
          state: 'rm -rf synthetic-folder',
          questions: { risk: { type: 'noul', instructions: 'Can this command delete data?' } },
        },
        new AbortController().signal,
      )
      if (outcome.outcome === 'answered') await settle()
      await writeFile(
        path.join(ROOT, 'source-receipt.json'),
        JSON.stringify(
          { counts: await ledger(), elapsedMs: performance.now() - start, outcome },
          null,
          2,
        ) + '\n',
      )
      expect(outcome.outcome).toBe('answered')
      expect(checks).toBe(1)
      if (outcome.outcome !== 'answered') throw new Error('missing native judge answer')
      expect(outcome.result.model).toBe(MODEL)
      expect(outcome.result.muse['risk']).toMatchObject({
        source: 'separate',
        label: 'uncalibrated',
        reservedCostUsd: 0,
        settledCostUsd: 0,
      })
    })
  },
)
