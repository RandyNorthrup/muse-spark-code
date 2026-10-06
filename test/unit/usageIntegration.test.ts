import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { usagePageStateSchema } from '../../src/shared/usagePage'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'
import {
  reserveRequestUsd,
  settleUsageUsd,
  type PriceCard,
} from '../../src/core/providers/priceCard'
import { createUsageRecording } from '../../src/core/usage/recording'
import { createUsageAccess, createUsageWriter } from '../../src/runtime/usage/usageServiceEntry'
import { openUsageCompanion } from '../../src/runtime/usage/usageCompanionEntry'
import {
  usageCompanionEventSchema,
  type UsageCompanionEvent,
} from '../../src/shared/usageCompanion'
import { EN } from '../../src/shared/l10n/en'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeMspHost, fakeInitializeResult, settle } from './helpers/fakeMsp'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'
import { removeFolder } from './helpers/temporaryFolders'
import { call, headers, login } from './helpers/companion'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
async function folder() {
  await mkdir('temp', { recursive: true })
  const root = await mkdtemp(path.resolve('temp', 'usage-integration-'))
  folders.push(root)
  return root
}
async function event(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<UsageCompanionEvent> {
  let text = ''
  for (;;) {
    const part = await reader.read()
    if (part.done) throw new Error('event stream ended')
    text += new TextDecoder().decode(part.value)
    const frame = /data: (.*)\n\n/.exec(text)
    if (frame?.[1] !== undefined) return usageCompanionEventSchema.parse(JSON.parse(frame[1]))
  }
}
const query = { range: '30d', groupBy: 'provider', metric: 'cost' } as const

describe('M102 integrated surfaces', () => {
  it('refuses to publish a partial read while its recorder cannot settle', async () => {
    const root = await folder()
    const access = createUsageAccess({
      dataFolder: root,
      packageRoot: path.resolve('.'),
      host: 'win11',
      locale: 'en',
      uiText: EN,
      log: new FakeLogOutputChannel(),
      beforeRead: () => Promise.reject(new Error('unsettled recorder')),
    })
    await expect(access.read(query)).rejects.toThrow('unsettled recorder')
  })
  it('settles two vendor host turns and one MSP subscription turn into exactly three calls, shared totals and an authenticated page', async () => {
    const root = await folder()
    const log = new FakeLogOutputChannel()
    const writer = await createUsageWriter({
      dataFolder: root,
      writerId: randomUUID(),
      now: Date.now,
      isEnabled: () => true,
      onWriteError: () => {
        throw new Error('journal write failed')
      },
    })
    const recording = createUsageRecording({
      client: 'Zed',
      now: Date.now,
      newId: randomUUID,
      isEnabled: () => true,
      writer: () => Promise.resolve(writer),
      log,
    })
    const api = fakeModelApi()
    const client = fakeModelApiClient(api, log)
    const card: PriceCard = {
      input: 0.000002,
      cachedInput: 0.000001,
      output: 0.000008,
      source: 'user',
    }
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({
        client,
        workspaceRoot: '/workspace',
        io: memoryToolIo({}, '/workspace'),
        log,
      }),
      now: Date.now,
      usageRecording: recording,
      models: {
        resolve: (ref) =>
          Promise.resolve({
            ref,
            client,
            origin: 'https://fake.invalid',
            policy: modelPolicyFor(ref, { pricing: { kind: 'priced', card } }),
            price: {
              reserve: (usage) => reserveRequestUsd(card, usage),
              settle: (usage) => settleUsageUsd(card, usage),
            },
            isCurrent: () => true,
          }),
      },
    })
    try {
      for (const modelId of ['muse-spark-1.3', 'openai/model']) {
        const session = await host.startSession({
          workspaceRoot: '/workspace',
          modelId,
          approvalMode: 'promptUnmatched',
        })
        const turns = watchSessionTurns(session)
        api.script({ text: 'answer', usage: { input: 100, output: 10, cached: 20 } })
        const done = turns.turnDone()
        await session.sendTurn([{ type: 'text', text: 'private prompt must not be stored' }])
        await done
      }
    } finally {
      await host.close()
    }
    const msp = fakeMspHost(fakeInitializeResult)
    msp.server.handle('session/start', () => ({
      session: { sessionId: 'subscription', modelId: 'muse-spark-1.3', status: 'idle' },
      viewCursor: '',
    }))
    msp.server.handle('turn/start', (params) => ({
      commandId: params['commandId'],
      turnId: 'turn',
      status: 'accepted',
      disposition: 'started',
      startedNewTurn: true,
    }))
    const muse = new MuseCodeHost(msp.host, log, undefined, recording)
    try {
      const session = await muse.startSession({
        workspaceRoot: '/workspace',
        modelId: 'muse-spark-1.3',
        approvalMode: 'promptUnmatched',
      })
      await session.sendTurn([{ type: 'text', text: 'private subscription prompt' }])
      msp.server.notify('turn/started', {
        sessionId: session.sessionId,
        turnId: 'turn',
        viewCursor: 'v',
      })
      msp.server.notify('session/tokenUsage', {
        sessionId: session.sessionId,
        cumulative: { promptTokens: 50, outputTokens: 5 },
      })
      msp.server.notify('turn/completed', {
        sessionId: session.sessionId,
        turnId: 'turn',
        terminal: 'completed',
      })
      msp.server.notify('usage/changed', {
        observedAtMs: Date.now(),
        tier: 'opaque',
        window: { usedPercent: 62, resetsAtMs: Date.now() + 100_000, windowDurationMins: 300 },
        weekly: { usedPercent: 80, resetsAtMs: Date.now() + 200_000 },
      })
      await settle()
    } finally {
      await muse.close()
    }
    await recording.flush()
    const journal = await writer.read()
    expect(journal.records).toHaveLength(3)
    expect(
      journal.records.map((row) => row.provider).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['meta', 'museCode', 'openai'])
    expect(journal.records.find((row) => row.provider === 'openai')?.cost).toMatchObject({
      certainty: 'computed',
      usd: 0.00026,
      source: 'user',
    })
    expect(journal.records.find((row) => row.provider === 'museCode')?.cost).toMatchObject({
      certainty: 'plan',
    })
    expect(JSON.stringify(journal)).not.toContain('private prompt')
    const access = createUsageAccess({
      dataFolder: root,
      packageRoot: path.resolve('.'),
      host: 'win11',
      locale: 'en',
      uiText: EN,
      log,
    })
    const state = await access.read(query)
    expect(state.totals.records).toBe(3)
    expect(state.totals.tokens).toMatchObject({ input: 250, output: 25, cached: 40 })
    expect(state.limits[0]?.windows).toHaveLength(2)
    const text = access.usageText(state, 'markdown', 'summary')
    expect(text).toContain('250')
    expect(text).toContain('25')
    expect(text).toContain('40')
    expect(text).toContain('62')
    expect(text).toContain('API-equivalent')
    const exported: unknown = JSON.parse(await access.export(query, 'json'))
    const exportState = z.object({ state: usagePageStateSchema }).parse(exported).state
    expect(exportState.totals).toEqual(state.totals)
    expect(exportState.limits).toEqual(state.limits)
    await mkdir(path.join(root, 'dist', 'webview'), { recursive: true })
    await writeFile(path.join(root, 'dist', 'webview', 'usage.js'), 'window.usageLoaded = true')
    await writeFile(path.join(root, 'dist', 'webview', 'usage.css'), ':root { color: white }')
    const panel = await openUsageCompanion({
      usage: access,
      assetsFolder: path.join(root, 'dist', 'webview'),
      locale: 'en',
      uiText: EN,
      log,
    })
    const controller = new AbortController()
    try {
      expect(await call(panel, '/usage.js')).toHaveProperty('status', 401)
      const code = new URLSearchParams(new URL(panel.launchUrl()).hash.slice(1)).get('k')
      const loggedIn = await call(panel, '/session', 'POST', JSON.stringify({ code }))
      expect(loggedIn.status).toBe(200)
      expect(loggedIn.headers['set-cookie']).toBeUndefined()
      const token = loggedIn.headers.authorization?.slice('Bearer '.length)
      if (token === undefined) throw new Error('missing bearer')
      const page = await call(panel, '/', 'GET', undefined, headers(panel, token))
      expect(page.status).toBe(200)
      expect(page.body).toContain('data-host-bridge="http"')
      expect(page.body).not.toContain(token)
      const stream = await fetch(new URL('/events', panel.url), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: new URL(panel.url).origin,
          'X-Muse-Panel': '1',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      if (stream.body === null) throw new Error('missing event body')
      const reader = stream.body.getReader()
      const reply = event(reader)
      expect(
        await call(
          panel,
          '/post',
          'POST',
          JSON.stringify({ type: 'request', id: '1', message: { type: 'usage/query', query } }),
          headers(panel, token),
        ),
      ).toHaveProperty('status', 202)
      const message = await reply
      if (message.type !== 'reply') throw new Error('missing service reply')
      const streamed = message.messages.find((item) => item.type === 'usage/state')
      if (streamed?.type !== 'usage/state') throw new Error('missing state')
      expect(streamed.state.totals).toEqual(state.totals)
      expect(streamed.state.limits).toEqual(state.limits)
      const downloaded = event(reader)
      await call(
        panel,
        '/post',
        'POST',
        JSON.stringify({
          type: 'request',
          id: '2',
          message: { type: 'usage/export', requestId: 'export', format: 'json', query },
        }),
        headers(panel, token),
      )
      const download = await downloaded
      if (download.type !== 'reply' || download.download === undefined)
        throw new Error('missing download')
      const downloadedJson: unknown = JSON.parse(download.download.content)
      expect(z.object({ state: usagePageStateSchema }).parse(downloadedJson).state.totals).toEqual(
        state.totals,
      )
      const sentinels = ['budget-journal', 'paid-daily', 'tab-spend']
      for (const name of sentinels) {
        await mkdir(path.join(root, name))
        await writeFile(path.join(root, name, 'keep'), 'unchanged')
      }
      for (const isApproved of [false, true]) {
        const confirmation = event(reader)
        const deleting = call(
          panel,
          '/post',
          'POST',
          JSON.stringify({
            type: 'request',
            id: 'delete',
            message: { type: 'usage/deleteHistory', requestId: 'delete' },
          }),
          headers(panel, token),
        )
        const prompt = await confirmation
        if (prompt.type !== 'confirm') throw new Error('missing confirmation')
        expect(prompt.count).toBe(state.history.recordCount)
        const otherToken = await login(panel)
        const answer = { type: 'confirm', id: prompt.id, count: prompt.count, approved: isApproved }
        expect(
          await call(panel, '/post', 'POST', JSON.stringify(answer), headers(panel, otherToken)),
        ).toHaveProperty('status', 500)
        expect(
          await call(
            panel,
            '/post',
            'POST',
            JSON.stringify({ ...answer, count: 2 }),
            headers(panel, token),
          ),
        ).toHaveProperty('status', 500)
        const result = event(reader)
        expect(
          await call(panel, '/post', 'POST', JSON.stringify(answer), headers(panel, token)),
        ).toHaveProperty('status', 202)
        expect(await deleting).toHaveProperty('status', 202)
        const completed = await result
        if (completed.type !== 'reply') throw new Error('missing delete result')
        expect(completed.messages).toContainEqual({
          type: 'usage/result',
          requestId: 'delete',
          action: 'deleteHistory',
          outcome: isApproved ? 'completed' : 'cancelled',
        })
        const remaining = await access.read(query)
        expect(remaining.totals.records).toBe(isApproved ? 0 : 3)
      }
      for (const name of sentinels)
        expect(await readFile(path.join(root, name, 'keep'), 'utf8')).toBe('unchanged')
      controller.abort()
      reader.releaseLock()
    } finally {
      controller.abort()
      await panel.close()
    }
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('honours persisted history-off while preserving stored totals and live windows', async () => {
    const root = await folder()
    const access = createUsageAccess({
      dataFolder: root,
      packageRoot: path.resolve('.'),
      host: 'win11',
      locale: 'en',
      uiText: EN,
      log: new FakeLogOutputChannel(),
    })
    await access.setHistory?.(false)
    const writer = await createUsageWriter({
      dataFolder: root,
      writerId: randomUUID(),
      now: Date.now,
      isEnabled: () => true,
      onWriteError: () => undefined,
    })
    writer.noteUsage(
      { input_tokens: 10 },
      {
        id: randomUUID(),
        at: Date.now(),
        client: 'cli',
        startedAt: Date.now(),
        backend: 'modelApi',
        provider: 'meta',
        model: 'muse-spark-1.3',
        kind: 'turn',
        outcome: 'completed',
      },
    )
    await writer.flush()
    const stored = await writer.read()
    const state = await access.read(query)
    expect(stored.records).toEqual([])
    expect(state.history.enabled).toBe(false)
    expect(await readdir(root)).toContain('usage-settings.json')
  })
})
