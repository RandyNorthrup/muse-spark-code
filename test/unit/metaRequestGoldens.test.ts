import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { metaGoldenRequests } from './helpers/metaGoldenRequests'

describe('Meta request bytes with BYO unused', () => {
  it.each(metaGoldenRequests())(
    'keeps $name byte-identical to its baseline (compaction: M101 C1; others: main 1e93c67c)',
    async ({ name, body }) => {
      let sent: unknown
      const client = new ModelApiClient({
        ...fakeModelApiClientSettings(new FakeLogOutputChannel()),
        fetch: (_url, init) => {
          sent = init?.body
          return Promise.resolve(
            new Response('data: [DONE]\n\n', {
              headers: { 'content-type': 'text/event-stream' },
            }),
          )
        },
      })
      await Array.fromAsync(client.streamResponse(body, new AbortController().signal))
      expect(sent).toBe(readFileSync(`test/fixtures/m95-int/meta/${name}.request.txt`, 'utf8'))
    },
  )
})
