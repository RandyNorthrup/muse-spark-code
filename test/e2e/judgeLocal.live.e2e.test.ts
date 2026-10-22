// Explicit free-only spike. Synthetic text, no keys, pulls or machine changes.
// $env:MUSE_LOCAL_JUDGE_SPIKE='1'; npx.cmd vitest run <this-file> ...
import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { verifyDiskModel } from '../../src/core/judge/local/model'
import { localEndpoint, requestLocal } from '../../src/core/judge/local/transport'
import { requireInstalledPeer, windowsPeer } from '../../src/core/judge/local/windowsPeer'
import { compilePeer } from '../unit/helpers/localJudgeWindows'
import capture from '../unit/fixtures/localJudgeCapture.json'

const MODEL = 'qwen3:4b-instruct-2507-q4_K_M'
const SAMPLES = 8
const chatSchema = z.looseObject({
  model: z.literal(MODEL),
  done: z.literal(true),
  message: z.looseObject({ role: z.literal('assistant'), content: z.string() }),
  eval_count: z.literal(1),
  total_duration: z.number().nonnegative(),
  load_duration: z.number().nonnegative(),
  logprobs: z.array(
    z.looseObject({
      token: z.string(),
      logprob: z.number(),
      top_logprobs: z.array(z.looseObject({ token: z.string(), logprob: z.number() })),
    }),
  ),
})

describe.skipIf(process.platform !== 'win32' || process.env['MUSE_LOCAL_JUDGE_SPIKE'] !== '1')(
  'M98-2j real Ollama, free and opt-in',
  () => {
    it('checks every content socket and weights before measuring one-token answers', async () => {
      const helper = await compilePeer()
      const endpoint = await localEndpoint('http://127.0.0.1:11434')
      const executable = path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs/Ollama/ollama.exe')
      const directory = path.join(process.env['USERPROFILE'] ?? '', '.ollama/models')
      const records: {
        attempt: number
        completed: boolean
        totalMs?: number
        verifyMs?: number
        diskMs?: number
        runtimeMs?: number
        modelMs?: number
        loadMs?: number
        answer?: string
        digest?: string
        weightBytes?: number
        pid?: number
        ports?: number[]
        error?: string
      }[] = []
      // Persist the counted dispatch BEFORE sending: failure cannot lose an attempt.
      const ledger = path.resolve('temp/m98-2j/ledger.json')
      for (let index = 0; index < SAMPLES; index++) {
        const record: (typeof records)[number] = { attempt: index + 1, completed: false }
        const ports: number[] = []
        let metadataPeer: Awaited<ReturnType<typeof windowsPeer>> | undefined
        const tags = await requestLocal(endpoint, '/api/tags', async (socket) => {
          metadataPeer = await windowsPeer(helper, socket)
          requireInstalledPeer(metadataPeer, {
            executable,
            ownerSid: metadataPeer.ownerSid,
            executableDigest: capture.runtime.executableDigest,
          })
          ports.push(socket.localPort!)
        })
        if (!metadataPeer) throw new Error('missing metadata peer')
        const trusted = metadataPeer
        const start = performance.now()
        const body = JSON.stringify({
          model: MODEL,
          stream: false,
          think: false,
          logprobs: true,
          top_logprobs: 5,
          messages: [
            { role: 'system', content: 'Answer exactly yes or no.' },
            {
              role: 'user',
              content: `State: ${index % 2 === 0 ? 'git status' : 'rm -rf synthetic-folder'}. Can this command delete data?`,
            },
          ],
          options: { num_predict: 1, temperature: 0 },
          keep_alive: '5m',
        })
        let answer: unknown
        try {
          answer = await requestLocal(
            endpoint,
            '/api/chat',
            async (socket) => {
              const checking = performance.now()
              const first = await windowsPeer(helper, socket)
              requireInstalledPeer(
                first,
                {
                  executable,
                  ownerSid: trusted.ownerSid,
                  executableDigest: capture.runtime.executableDigest,
                },
                trusted,
              )
              const diskStart = performance.now()
              const disk = await verifyDiskModel(tags, MODEL, directory)
              record.diskMs = performance.now() - diskStart
              const final = await windowsPeer(helper, socket)
              requireInstalledPeer(
                final,
                {
                  executable,
                  ownerSid: trusted.ownerSid,
                  executableDigest: capture.runtime.executableDigest,
                },
                first,
              )
              expect(socket.bytesWritten).toBe(0)
              record.pid = final.pid
              record.digest = disk.digest
              record.weightBytes = disk.weightBytes
              ports.push(socket.localPort!)
              record.ports = ports
              records.push(record)
              await writeFile(ledger, JSON.stringify(records, null, 2))
              // This is the final OS check, after the ledger await as well.
              requireInstalledPeer(
                await windowsPeer(helper, socket),
                {
                  executable,
                  ownerSid: trusted.ownerSid,
                  executableDigest: capture.runtime.executableDigest,
                },
                final,
              )
              record.verifyMs = performance.now() - checking
            },
            body,
          )
        } catch (error: unknown) {
          record.error = error instanceof Error ? error.message : 'failed'
          await writeFile(ledger, JSON.stringify(records, null, 2))
          throw error
        }
        const chat = chatSchema.parse(answer)
        expect(['yes', 'no']).toContain(chat.message.content.trim().toLowerCase())
        expect(chat.logprobs[0]?.top_logprobs).toHaveLength(5)
        record.completed = true
        record.totalMs = performance.now() - start
        record.modelMs = chat.total_duration / 1_000_000
        record.loadMs = chat.load_duration / 1_000_000
        record.runtimeMs = record.totalMs - (record.verifyMs ?? 0)
        record.answer = chat.message.content
        await writeFile(ledger, JSON.stringify(records, null, 2))
      }
      expect(records).toHaveLength(SAMPLES)
      expect(new Set(records.flatMap((record) => record.ports ?? [])).size).toBe(SAMPLES * 2)
    })
  },
)
