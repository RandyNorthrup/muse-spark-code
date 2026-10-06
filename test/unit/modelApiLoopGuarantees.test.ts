// M106 L2: synthetic loop faults use the existing fake wire; no new provider shapes.
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { hookResult } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  MODEL_API_MODEL_TEXT,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  UI_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings, TINY_PNG_BASE64 } from './helpers/fakeModelApi'
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

function repeatReplies(onRequest?: (id: number) => void) {
  return Array.from({ length: 4 }, (_, id) => ({
    calls: [{ ...read(0), callId: `repeat${String(id)}` }],
    ...(onRequest !== undefined && {
      onRequest: () => {
        onRequest(id)
      },
    }),
  }))
}

function holdTextReads(rig: Awaited<ReturnType<typeof setup>>, count: number) {
  const paths = Array.from({ length: count }, (_, id) => `/ws/${String(id)}.txt`)
  const gates = paths.map(() => Promise.withResolvers<undefined>())
  const entered: string[] = []
  const original = rig.io.readFile
  rig.io.readFile = async (absolute, expected) => {
    const index = paths.indexOf(absolute)
    if (index !== -1) {
      entered.push(absolute)
      await gates[index]?.promise
    }
    return await original(absolute, expected)
  }
  return { gates, entered }
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
    const cap = vi.fn((modelId: string) =>
      modelId === 'muse-spark-1.3' ? MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS : 4096,
    )
    const rig = await setup({ modelOutputMaxTokens: cap })
    rig.api.script({ text: 'first' }, { text: 'next' })
    await send(rig)
    await send(rig)
    expect(rig.api.responseBodies().map((body) => body['max_output_tokens'])).toEqual([
      131_072, 131_072,
    ])
    expect(cap).toHaveBeenCalledExactlyOnceWith('muse-spark-1.3')
    await rig.session.setModel('muse-spark-1.2')
    rig.api.script({ text: 'Other model.' })
    await send(rig)
    expect(rig.api.responseBodies().at(-1)?.['max_output_tokens']).toBe(4096)
    await rig.session.setModel('muse-spark-1.3')
    rig.api.script({ text: 'Original model.' })
    await send(rig)
    expect(cap).toHaveBeenCalledTimes(2)
    expect(rig.api.responseBodies().at(-1)?.['max_output_tokens']).toBe(131_072)
    await rig.host.close()
  })

  it('refuses invalid model output records before dispatch', async () => {
    for (const cap of [0, -1, 1.5, Infinity, NaN]) {
      const rig = await setup({ modelOutputMaxTokens: () => cap })
      rig.api.script({ text: 'Never requested.' })
      await send(rig)
      expect(rig.api.responseBodies()).toHaveLength(0)
      expect(
        rig.events.some(
          (event) =>
            event.type === 'turnCompleted' && event.reason?.includes('invalid output.maxTokens'),
        ),
      ).toBe(true)
      await rig.host.close()
    }
  })

  it('changes only the declared output cap bytes in the first on request', async () => {
    const off = await setup({ parallelReads: () => false, outputContinuation: () => false })
    const on = await setup({
      parallelReads: () => true,
      outputContinuation: () => true,
      modelOutputMaxTokens: () => MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
    })
    off.api.script({ text: 'Done.' })
    on.api.script({ text: 'Done.' })
    await send(off)
    await send(on)
    expect(on.rawBodies[0]).toBe(
      off.rawBodies[0]?.replace('"max_output_tokens":32768', '"max_output_tokens":131072'),
    )
    await off.host.close()
    await on.host.close()
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

  it('suppresses the third unchanged text read, stops the fourth and resets for a new turn', async () => {
    const rig = await setup()
    rig.api.script(...repeatReplies(), { text: 'Never requested.' })
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(4)
    const input = JSON.stringify(rig.api.responseBodies()[3]?.['input'])
    expect(input).toContain(
      '"call_id":"repeat2","output":"' + MODEL_API_MODEL_TEXT.toolRepeatStopped + '"',
    )
    expect(notices(rig)).toContain(UI_TEXT.modelApiToolStuck)
    rig.api.script({ calls: [read(0)] }, { text: 'Fresh turn.' })
    await send(rig)
    expect(JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])).toContain(
      '"call_id":"c0","output":"Read text file',
    )
    await rig.host.close()
  })

  it('runs a changed file on the third attempt and checks again after the skipped third', async () => {
    for (const changeAt of [2, 3]) {
      const rig = await setup()
      rig.api.script(
        ...repeatReplies((id) => {
          if (id === changeAt) rig.io.files.set('/ws/0.txt', 'changed result')
        }),
        { text: 'Done.' },
      )
      await send(rig)
      expect(rig.api.responseBodies()).toHaveLength(5)
      expect(JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])).toContain('changed result')
      expect(notices(rig)).not.toContain(UI_TEXT.modelApiToolStuck)
      await rig.host.close()
    }
  })

  it('keeps repeated identical calls in one batch serial so the third can be suppressed', async () => {
    const rig = await setup()
    rig.api.script(
      {
        calls: Array.from({ length: 4 }, (_, id) => ({
          ...read(0),
          callId: `repeat${String(id)}`,
        })),
      },
      { text: 'Never requested.' },
    )
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(1)
    expect(notices(rig)).toContain(UI_TEXT.modelApiToolStuck)
    const outputs = rig.session.history().items.filter((item) => item.kind === 'toolCall')
    expect(outputs).toHaveLength(4)
    await rig.host.close()
  })

  it('runs repeated shell calls when their future result cannot be proven unchanged', async () => {
    const rig = await setup()
    rig.api.script(
      ...Array.from({ length: 4 }, (_, id) => ({
        calls: [
          { name: 'bash', arguments: '{"command":"echo result"}', callId: `shell${String(id)}` },
        ],
      })),
      { text: 'Done.' },
    )
    await send(rig)
    expect(rig.io.shellCalls).toHaveLength(4)
    expect(notices(rig)).not.toContain(UI_TEXT.modelApiToolStuck)
    await rig.host.close()
  })

  it('runs legitimate repeats when either trusted result-proof operation fails', async () => {
    for (const failure of ['observed', 'current']) {
      const rig = await setup({
        repeatResultWitness: {
          observed: () => {
            if (failure === 'observed') throw new Error('no proof')
            return 'state'
          },
          current: () =>
            failure === 'current'
              ? Promise.reject(new Error('no proof'))
              : Promise.resolve('state'),
        },
      })
      rig.api.script(...repeatReplies(), { text: 'Done.' })
      await send(rig)
      expect(rig.api.responseBodies()).toHaveLength(5)
      expect(notices(rig)).not.toContain(UI_TEXT.modelApiToolStuck)
      const replay = JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])
      for (const id of [2, 3])
        expect(replay).toContain(`"call_id":"repeat${String(id)}","output":"Read text file`)
      await rig.host.close()
    }
  })

  it('settles pre and post hooks, writes and shell barriers in call order', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'pre' }] }],
          PostToolUse: [{ hooks: [{ type: 'command', command: 'post' }] }],
        },
      }),
      'project',
      'linux',
    ).hooks
    const rig = await setup({ loadHooks: () => Promise.resolve(hooks), isHooksEnabled: () => true })
    const phases: string[] = []
    rig.io.runHook = (command, payload) => {
      const parsed: unknown = JSON.parse(payload)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('tool_use_id' in parsed) ||
        typeof parsed.tool_use_id !== 'string'
      )
        throw new Error('invalid hook payload')
      phases.push(`${command}:${parsed.tool_use_id}`)
      return Promise.resolve(hookResult(''))
    }
    const readFile = rig.io.readFile
    rig.io.readFile = async (absolute, expected) => {
      if (absolute.endsWith('.txt')) phases.push(`read:${absolute}`)
      return await readFile(absolute, expected)
    }
    rig.api.script(
      {
        calls: [
          read(0),
          read(1),
          {
            name: 'write_file',
            arguments: '{"path":"new.txt","content":"created"}',
            callId: 'write',
          },
          { name: 'bash', arguments: '{"command":"echo after"}', callId: 'shell' },
          read(2),
        ],
      },
      { text: 'Done.' },
    )
    await send(rig)
    const pre = phases.filter((phase) => phase.startsWith('pre:'))
    const post = phases.filter((phase) => phase.startsWith('post:'))
    expect(pre).toHaveLength(5)
    expect(post.map((phase) => phase.replace('post:', ''))).toEqual(
      pre.map((phase) => phase.replace('pre:', '')),
    )
    expect(phases.indexOf(pre[1] ?? '')).toBeLessThan(phases.indexOf('read:/ws/0.txt'))
    expect(phases.indexOf(pre[2] ?? '')).toBeGreaterThan(phases.indexOf(post[1] ?? ''))
    expect(rig.io.files.get('/ws/new.txt')).toBe('created')
    expect(rig.io.shellCalls).toHaveLength(1)
    await rig.host.close()
  })

  it('reserves the continuation afresh and refuses it when its budget is exhausted', async () => {
    const rig = await setup({ store: memorySessionStore(), sessionBudgetUsd: () => 0.1 })
    rig.api.script(
      {
        text: 'Partial.',
        incomplete: { reason: 'max_output_tokens' },
        usage: { input: 0, output: 100_000 },
      },
      { text: 'Never requested.' },
    )
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(1)
    expect(
      rig.events.some((event) => event.type === 'turnCompleted' && event.terminal === 'failed'),
    ).toBe(true)
    await rig.host.close()
  })

  it('does not overlap a hook-forced asking read with reads on either side', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'pre' }] }],
        },
      }),
      'project',
      'linux',
    ).hooks
    const rig = await setup({ loadHooks: () => Promise.resolve(hooks), isHooksEnabled: () => true })
    rig.io.runHook = (_command, payload) =>
      Promise.resolve(
        hookResult(
          payload.includes('1.txt')
            ? JSON.stringify({
                hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
              })
            : '',
        ),
      )
    const gate = Promise.withResolvers<undefined>()
    const entered: string[] = []
    const originalRead = rig.io.readFile
    rig.io.readFile = async (absolute, expected) => {
      if (absolute.endsWith('.txt')) entered.push(absolute)
      if (absolute === '/ws/0.txt') await gate.promise
      return await originalRead(absolute, expected)
    }
    rig.api.script({ calls: [read(0), read(1), read(2)] }, { text: 'Done.' })
    const done = rig.turnDone()
    await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
    await vi.waitFor(() => {
      expect(entered).toEqual(['/ws/0.txt'])
    })
    expect(rig.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    gate.resolve(undefined)
    await vi.waitFor(() => {
      expect(rig.events.some((event) => event.type === 'approvalRequested')).toBe(true)
    })
    const approval = rig.events.find((event) => event.type === 'approvalRequested')
    if (approval?.type !== 'approvalRequested') throw new Error('missing approval')
    expect(entered).toEqual(['/ws/0.txt'])
    await rig.session.decideApproval({
      approvalId: approval.approvalId,
      requirementId: approval.requirementId,
      choiceId: 'allow_once',
    })
    await done
    expect(entered).toEqual(['/ws/0.txt', '/ws/1.txt', '/ws/2.txt'])
    await rig.host.close()
  })

  it('reserves media in call order even when later image reads finish first', async () => {
    const capture = async (isParallel: boolean) => {
      const rig = await setup({
        parallelReads: () => isParallel,
        mediaBudgetMaxEncodedChars: TINY_PNG_BASE64.length * 2 - 1,
      })
      rig.io.binaries.set('/ws/first.png', Buffer.from(TINY_PNG_BASE64, 'base64'))
      rig.io.binaries.set('/ws/second.png', Buffer.from(TINY_PNG_BASE64, 'base64'))
      const original = rig.io.readBytes
      const gates = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
      const entered: string[] = []
      rig.io.readBytes = async (absolute, maxBytes, expected) => {
        entered.push(absolute)
        await gates[absolute.endsWith('first.png') ? 0 : 1]?.promise
        return await original(absolute, maxBytes, expected)
      }
      rig.api.script(
        {
          calls: [
            { name: 'read_file', arguments: '{"path":"first.png"}', callId: 'first' },
            { name: 'read_file', arguments: '{"path":"second.png"}', callId: 'second' },
          ],
        },
        { text: 'Done.' },
      )
      const done = rig.turnDone()
      await rig.session.sendTurn([{ type: 'text', text: 'Read images.' }])
      await vi.waitFor(() => {
        expect(entered).toHaveLength(isParallel ? 2 : 1)
      })
      for (const gate of gates.toReversed()) gate.resolve(undefined)
      await done
      const next = JSON.stringify(rig.api.responseBodies()[1]?.['input'])
      expect(next).toContain('Read image')
      expect(next).toContain(MODEL_API_MODEL_TEXT.toolMediaBudgetExceeded)
      expect(next.match(/"type":"input_image"/g)).toHaveLength(1)
      const bodies = normalizeBodies(rig.rawBodies)
      await rig.host.close()
      return bodies
    }
    expect(await capture(true)).toEqual(await capture(false))
  })

  it('forgets parallel reads stopped before settlement so a later edit still requires a read', async () => {
    const rig = await setup()
    const { gates, entered } = holdTextReads(rig, 2)
    rig.api.script({ calls: [read(0), read(1)] }, { text: 'Never requested.' })
    const done = rig.turnDone()
    await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
    await vi.waitFor(() => {
      expect(entered).toHaveLength(2)
    })
    const cancelled = rig.session.cancel()
    for (const gate of gates) gate.resolve(undefined)
    await cancelled
    await done
    const saved = rig.session.history().items.filter((item) => item.kind === 'toolCall')
    expect(saved.every((item) => item.status === 'cancelled')).toBe(true)
    rig.api.script(
      {
        calls: [
          { name: 'write_file', arguments: '{"path":"0.txt","content":"changed"}', callId: 'edit' },
        ],
      },
      { text: 'Refused.' },
    )
    await send(rig)
    expect(rig.io.files.get('/ws/0.txt')).toBe('first')
    expect(JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])).toContain(
      MODEL_API_MODEL_TEXT.fileChangedSinceRead,
    )
    await rig.host.close()
  })

  it('overlaps real read execution and returns identical raw requests with packing on', async () => {
    const capture = async (isParallel: boolean) => {
      const rig = await setup({ parallelReads: () => isParallel, observationPacking: () => true })
      rig.io.files.set(
        '/ws/0.txt',
        Array.from({ length: 500 }, (_, index) => `line ${String(index)} ${'x'.repeat(20)}`).join(
          '\n',
        ),
      )
      const { gates, entered } = holdTextReads(rig, 4)
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
      expect(raw.at(-1)).toContain('Packed output')
      await rig.host.close()
      return raw
    }
    expect(await capture(true)).toEqual(await capture(false))
  })
})
