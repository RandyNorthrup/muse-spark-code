import { readFile } from 'node:fs/promises'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { metaGoldenBodies } from './helpers/m95MetaBodies'
import { FakeLogOutputChannel } from './helpers/fakes'

const goldenSchema = z.object({
  baseline: z.literal('1e93c67c'),
  requests: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      method: z.string(),
      headers: z.record(z.string(), z.string()),
      body: z.string(),
    }),
  ),
})

describe('Meta request goldens at 1e93c67c', () => {
  it.each(metaGoldenBodies())(
    '$name retains the original request bytes and rejects redirects',
    async (scenario) => {
      const golden = z.parse(
        goldenSchema,
        JSON.parse(
          await readFile(new URL('../fixtures/m95-meta-goldens.json', import.meta.url), 'utf8'),
        ),
      )
      const captured: unknown[] = []
      const client = new ModelApiClient({
        baseUrl: 'https://api.meta.ai/v1',
        apiKey: () => Promise.resolve('synthetic-golden-key'),
        sleep: () => Promise.resolve(),
        now: () => 0,
        random: () => 0,
        log: new FakeLogOutputChannel(),
        fetch: (input, init) => {
          const headers = new Headers(init?.headers)
          headers.delete('Authorization')
          captured.push({
            name: scenario.name,
            url: input instanceof Request ? input.url : input.toString(),
            method: init?.method,
            headers: Object.fromEntries(headers.entries()),
            body: init?.body,
          })
          expect(init?.redirect).toBe('error')
          return Promise.resolve(
            new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
          )
        },
      })
      await Array.fromAsync(client.streamResponse(scenario.body, new AbortController().signal))
      expect(captured).toEqual([golden.requests.find((request) => request.name === scenario.name)])
      expect(golden.requests).toHaveLength(metaGoldenBodies().length)
    },
  )
})
