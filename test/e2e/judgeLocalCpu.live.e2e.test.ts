// FIXM98J2 opt-in CPU receipt: existing model only, no pull/removal or cloud.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { verifyDiskModel } from '../../src/core/judge/local/model'
import { localEndpoint, requestLocal } from '../../src/core/judge/local/transport'
import {
  requireInstalledPeer,
  windowsModelDirectory,
  windowsPeer,
} from '../../src/core/judge/local/windowsPeer'
import { localChatResult } from '../../src/core/judge/local/wire'
import type { JudgeRequest } from '../../src/core/judge/schema'
import { JUDGE_REQUEST_TIMEOUT_MS } from '../../src/shared/constants'
import { compilePeer } from '../unit/helpers/localJudgeWindows'
import capture from '../unit/fixtures/localJudgeCapture.json'

const MODEL = 'qwen3:4b-instruct-2507-q4_K_M'
const SAMPLES = 3 // One cold + two warm; brief ceiling is four, no retry.
// These fields are already captured in localJudgeSystemOneCapture.json.
const healthSchema = z.looseObject({
  models: z.array(z.looseObject({ name: z.string(), size_vram: z.number().nonnegative() })),
})
// Duration fields are captured by the original free local chat spike.
const timingSchema = z.looseObject({
  total_duration: z.number().nonnegative(),
  load_duration: z.number().nonnegative(),
})

describe.skipIf(process.platform !== 'win32' || process.env['MUSE_LOCAL_JUDGE_CPU'] !== '1')(
  'FIXM98J2 counted CPU-only local latency',
  () => {
    it('measures cold and warm CPU inference with fresh native and full disk proof', async () => {
      const folder = path.resolve('temp/fixm98j2-cpu')
      await mkdir(folder, { recursive: true })
      const ledger = path.join(folder, 'receipt.json')
      try {
        await readFile(ledger)
        throw new Error('CPU receipt already exists; no additional calls authorized')
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      const helper = await compilePeer()
      const endpoint = await localEndpoint('http://127.0.0.1:11434')
      const directory = path.join(process.env['USERPROFILE'] ?? '', '.ollama/models')
      const signal = new AbortController().signal
      let generation: Awaited<ReturnType<typeof windowsPeer>> | undefined
      const peer: Parameters<typeof requestLocal>[2] = async (socket) => {
        await windowsModelDirectory(helper, directory, signal)
        const actual = await windowsPeer(helper, socket)
        requireInstalledPeer(
          actual,
          {
            executable: path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs/Ollama/ollama.exe'),
            ownerSid: actual.callerSid,
            executableDigest: capture.runtime.executableDigest,
          },
          generation,
        )
        generation = actual
        expect(socket.bytesWritten).toBe(0)
      }
      const records: {
        attempt: number
        status: 'uncertain' | 'returned'
        totalMs?: number
        verifyMs?: number
        diskMs?: number
        httpMs?: number
        modelMs?: number
        loadMs?: number
        digest?: string
        weightBytes?: number
        cpuResidence?: z.infer<typeof healthSchema>
      }[] = []
      let metadataAttempts = 0
      const save = () =>
        writeFile(
          ledger,
          JSON.stringify(
            {
              workspace: 'C:/lanes/FIXM98J2',
              model: MODEL,
              endpoint: 'http://127.0.0.1:11434',
              inferenceCeiling: 4,
              plannedAttempts: SAMPLES,
              inferenceAttempts: records.length,
              metadataAttempts,
              paidCostUsd: 0,
              records,
            },
            null,
            2,
          ),
        )
      const health = async () => {
        metadataAttempts++
        await save()
        return healthSchema.parse(await requestLocal(endpoint, '/api/ps', peer))
      }
      const initialHealth = await health()
      expect(initialHealth.models).toEqual([]) // No GPU model at the start.
      metadataAttempts++
      await save()
      const tags = await requestLocal(endpoint, '/api/tags', peer)
      for (let index = 0; index < SAMPLES; index++) {
        const record: (typeof records)[number] = { attempt: index + 1, status: 'uncertain' }
        const started = performance.now()
        const state = index % 2 === 0 ? 'git status' : 'rm -rf synthetic-folder'
        const request: JudgeRequest = {
          state,
          questions: { risk: { type: 'noul', instructions: 'Can this command delete data?' } },
        }
        const response = await requestLocal(
          endpoint,
          '/api/chat',
          async (socket) => {
            const verifying = performance.now()
            await peer(socket)
            const diskStart = performance.now()
            const disk = await verifyDiskModel(tags, MODEL, directory, signal)
            record.diskMs = performance.now() - diskStart
            record.digest = disk.digest
            record.weightBytes = disk.weightBytes
            await peer(socket)
            if (records.length >= SAMPLES) throw new Error('CPU inference ceiling reached')
            records.push(record)
            await save() // Count before any inference bytes, including uncertain sends.
            await peer(socket)
            record.verifyMs = performance.now() - verifying
          },
          JSON.stringify({
            model: MODEL,
            stream: false,
            think: false,
            logprobs: true,
            top_logprobs: 5,
            messages: [
              { role: 'system', content: 'Answer exactly yes or no.' },
              { role: 'user', content: `State: ${state}. Can this command delete data?` },
            ],
            options: { num_gpu: 0, num_predict: 1, temperature: 0 },
            keep_alive: '5m',
          }),
          { timeoutMs: JUDGE_REQUEST_TIMEOUT_MS },
        )
        record.totalMs = performance.now() - started
        record.httpMs = record.totalMs - (record.verifyMs ?? 0)
        record.status = 'returned'
        await save()
        const timings = timingSchema.parse(response)
        record.modelMs = timings.total_duration / 1_000_000
        record.loadMs = timings.load_duration / 1_000_000
        expect(localChatResult(response, request, MODEL).muse['risk']?.settledCostUsd).toBe(0)
        record.cpuResidence = await health()
        await save()
        expect(record.cpuResidence.models).toEqual([
          expect.objectContaining({ name: MODEL, size_vram: 0 }),
        ])
        expect(record.totalMs).toBeLessThan(JUDGE_REQUEST_TIMEOUT_MS)
      }
      expect(records).toHaveLength(SAMPLES)
    })
  },
)
