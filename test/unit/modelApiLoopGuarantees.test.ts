// M106 L2: synthetic loop faults use the existing fake wire; no new provider shapes.
import { describe, expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  MODEL_API_MODEL_TEXT,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  UI_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'

const ROOT = '/ws'
const read = (id: number) => ({
  name: 'read_file',
  arguments: JSON.stringify({ path: `${String(id)}.txt` }),
  callId: `c${String(id)}`,
})

async function setup(overrides: Partial<ModelApiHostDeps> = {}) {
  const log = new FakeLogOutputChannel()
  const api = fakeModelApi()
  const rawBodies: string[] = []
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: (input, init) => {
      if (
        typeof init?.body === 'string' &&
        (input instanceof Request ? input.url : String(input)).endsWith('/responses')
      )
        rawBodies.push(init.body)
      return api.fetch(input, init)
    },
  })
  const io = memoryToolIo(
    { '0.txt': 'first', '1.txt': 'second', '2.txt': 'third', '3.txt': 'fourth' },
    ROOT,
  )
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log }),
    ...overrides,
  })
  const watched = await startWatchedSession(host, ROOT, 'allowAll')
  return { api, io, host, rawBodies, ...watched }
}

async function send(rig: Awaited<ReturnType<typeof setup>>) {
  const done = rig.turnDone()
  await rig.session.sendTurn([{ type: 'text', text: 'Work.' }])
  await done
}

const notices = (rig: Awaited<ReturnType<typeof setup>>) =>
  rig.events.filter((event) => event.type === 'backendNotice').map((event) => event.text)

// The fake alone generates these direct item IDs; all other raw bytes stay intact.
function normalizeBodies(raw: readonly string[]): string[] {
  const ids = new Map<string, string>()
  return raw.map((body) =>
    body.replaceAll(/"id":"((?:fc|rs|msg|ws)_[0-9]+)"/g, (_match: string, id: string) => {
      const replacement = ids.get(id) ?? `item${String(ids.size)}`
      ids.set(id, replacement)
      return `"id":"${replacement}"`
    }),
  )
}

describe('M106 loop guarantees', () => {
  it('uses the selected per-model output cap and fixes it for that model', async () => {
    const cap = vi.fn(() => MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS)
    const rig = await setup({ modelOutputMaxTokens: cap })
    rig.api.script({ text: 'first' }, { text: 'next' })
    await send(rig)
    await send(rig)
    expect(rig.api.responseBodies().map((body) => body['max_output_tokens'])).toEqual([
      131_072, 131_072,
    ])
    expect(cap).toHaveBeenCalledExactlyOnceWith('muse-spark-1.3')
    await rig.host.close()
  })

  it('continues once, preserves partial text and pairs cut-short calls with errors without executing', async () => {
    const rig = await setup()
    rig.api.script(
      {
        text: 'Partial.',
        calls: [
          { name: 'write_file', arguments: '{"path":"new.txt","content":"unsafe"}', callId: 'cut' },
        ],
        incomplete: { reason: 'max_output_tokens' },
      },
      { text: 'Still partial.', incomplete: { reason: 'max_output_tokens' } },
      { text: 'Never requested.' },
    )
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(2)
    expect(rig.io.files.has('/ws/new.txt')).toBe(false)
    const next = JSON.stringify(rig.api.responseBodies()[1]?.['input'])
    expect(next).toContain('Partial.')
    expect(next).toContain(
      '"call_id":"cut","output":"Error: response.incomplete: max_output_tokens"',
    )
    expect(next).toContain(MODEL_API_MODEL_TEXT.continuationPrompt)
    expect(notices(rig)).toContain(UI_TEXT.modelApiContinuing)
    expect(notices(rig)).toContain(UI_TEXT.modelApiContinuationLimit)
    expect(
      rig.events.filter((event) => event.type === 'itemStarted' && event.item.kind === 'toolCall'),
    ).toEqual([])
    await rig.host.close()
  })

  it('does not continue other incomplete reasons, and keeps the off request at the legacy cap', async () => {
    for (const reason of ['max_output_tokens', 'content_filter']) {
      const rig = await setup({ outputContinuation: () => false, parallelReads: () => false })
      rig.api.script({ text: 'Partial.', incomplete: { reason } })
      await send(rig)
      expect(rig.api.responseBodies()).toHaveLength(1)
      expect(rig.api.responseBodies()[0]?.['max_output_tokens']).toBe(32_768)
      expect(notices(rig)).not.toContain(UI_TEXT.modelApiContinuing)
      await rig.host.close()
    }
    const rig = await setup()
    rig.api.script({ incomplete: { reason: 'content_filter' } })
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(1)
    await rig.host.close()
  })

  it('overlaps real read execution and returns identical raw requests with packing on', async () => {
    const capture = async (isParallel: boolean) => {
      const rig = await setup({ parallelReads: () => isParallel, observationPacking: () => true })
      const gates = Array.from({ length: 4 }, () => Promise.withResolvers<undefined>())
      const entered: string[] = []
      const originalRead = rig.io.readFile
      // Mutate the injected in-memory adapter used by context and tools alike.
      rig.io.readFile = async (absolute, expected) => {
        const index = ['/ws/0.txt', '/ws/1.txt', '/ws/2.txt', '/ws/3.txt'].indexOf(absolute)
        if (index !== -1) {
          entered.push(absolute)
          await gates[index]?.promise
        }
        return await originalRead(absolute, expected)
      }
      rig.api.script(
        { calls: [read(0), read(1), read(2), read(3)] },
        { text: 'Read.' },
        { text: 'Again.' },
        { text: 'Packed.' },
      )
      const done = rig.turnDone()
      await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
      await vi.waitFor(() => {
        expect(entered).toHaveLength(isParallel ? 4 : 1)
      })
      for (const gate of gates.toReversed()) gate.resolve(undefined)
      await done
      await send(rig)
      await send(rig)
      const raw = normalizeBodies(rig.rawBodies)
      await rig.host.close()
      return raw
    }
    expect(await capture(true)).toEqual(await capture(false))
  })
})
