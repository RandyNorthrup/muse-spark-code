// PORTM105 round 2: existing files through production attach/session/runtime wiring.
// Only HTTP/model responses and the user's native UI answers are simulated.
import * as acp from '@agentclientprotocol/sdk'
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { PaidUsage } from '../../src/core/paid/paidFeatures'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { createToolIo } from '../../src/host/backend/toolIo'
import { PaidUseConsent } from '../../src/core/paid/paidConsent'
import { askPaidUse } from '../../src/host/paid/paidHost'
import { confirmModal } from './helpers/vscodeViews'
import { AttachmentStore } from '../../src/core/attachments'
import { createMediaAttachments } from '../../src/host/media/mediaEntry'
import { createAttachedMedia, windowMediaAttachDeps } from '../../src/host/media/mediaHostEntry'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { createSessionUploads } from '../../src/host/backend/sessionUploads'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { createAcpAgent } from '../../src/acp/agent'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { runExec } from '../../src/runtime/exec/runExec'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { outputWriter } from './helpers/execContract'
import {
  UI_TEXT,
  SECRET_KEYS,
  MODEL_API_PRICES_PER_MILLION,
  TOKENS_PER_MILLION,
  BYTES_PER_MIB,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  ACP_PAID_OPTIONS,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { Usd } from '../../src/shared/usd'
import { fill } from '../../src/shared/l10n/text'
import { fakeModelApi, fakeModelApiClient, FAKE_MODEL_API_KEY } from './helpers/fakeModelApi'
import { fakeFilesApi } from './helpers/fakeFiles'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { scratchDirectories } from './helpers/media/scratch'
import { videoFixture, wavFixture } from './helpers/media/fixtures'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { watchSessionTurns } from './helpers/sessionTurns'

function ignoreSignals() {
  return undefined
}

const MODEL = 'muse-spark-1.3-contributor'
const scratch = scratchDirectories('m105-composition-')
const dist = scratch()
beforeAll(async () => {
  await buildModelApiBundle(dist)
})

const claimSchema = z.object({
  reservedUsd: z.string(),
  settledUsd: z.optional(z.string()),
  hasUnknownCost: z.optional(z.boolean()),
})
function claims(root: string): z.infer<typeof claimSchema>[] {
  const result: z.infer<typeof claimSchema>[] = []
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...claims(file))
    else if (entry.name === 'claim.json')
      result.push(claimSchema.parse(JSON.parse(readFileSync(file, 'utf8'))))
  }
  return result
}

function existingFiles(root: string) {
  const video = videoFixture({ soundtrack: false })
  const audio = wavFixture(2, { sampleRate: 16_000 })
  writeFileSync(path.join(root, 'clip.mp4'), video)
  writeFileSync(path.join(root, 'speech.wav'), audio)
  return { video, audio }
}

function boundary(root: string) {
  const api = fakeModelApi()
  const files = fakeFilesApi(api.fetch)
  const order: string[] = []
  const admissions: { route: string; claims: ReturnType<typeof claims> }[] = []
  const audioBodies: Buffer[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/asr/transcribe')) {
      order.push('transcription')
      admissions.push({ route: 'transcription', claims: claims(root) })
      const body = init?.body
      if (!(body instanceof ReadableStream)) throw new Error('expected streamed transcription')
      audioBodies.push(Buffer.from(await new Response(body).arrayBuffer()))
      return Response.json({ transcript: 'The Blue Llama.', audioDurationMs: 2080 })
    }
    if (url.endsWith('/responses')) {
      order.push('response')
      admissions.push({ route: 'response', claims: claims(root) })
    }
    return await files.fetch(input, init)
  }
  return { api, files, fetch, order, admissions, audioBodies }
}

function expectDelivery(b: ReturnType<typeof boundary>, video: Uint8Array, audio?: Uint8Array) {
  const hasAudio = audio !== undefined
  const maximumBytes = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB
  expect(video.length).toBeLessThanOrEqual(maximumBytes)
  if (audio !== undefined) expect(audio.length).toBeLessThanOrEqual(maximumBytes)
  const bodies = b.api.responseBodies()
  expect(bodies).toHaveLength(1)
  expect(b.files.uploads).toHaveLength(1)
  const upload = b.files.uploads[0]!
  expect(upload).toMatchObject({
    name: 'clip.mp4',
    mime: 'video/mp4',
    bytes: video.length,
    expirySeconds: 604_800,
  })
  const input = JSON.stringify(bodies[0]?.['input'])
  expect(input).toContain(`{"type":"input_video","file_id":"${upload.fileId}"}`)
  if (hasAudio) expect(input).toContain('The Blue Llama.')
  expect(input.match(/"type":"input_video"/gu)).toHaveLength(1)
  expect(input).not.toContain('input_audio')
  expect(input).not.toContain('base64')
  expect(b.audioBodies).toHaveLength(hasAudio ? 1 : 0)
  if (hasAudio) {
    expect(b.audioBodies[0]?.includes(Buffer.from(audio))).toBe(true)
    const asr = b.admissions.find((item) => item.route === 'transcription')!
    expect(
      asr.claims
        .filter((claim) => claim.settledUsd === undefined)
        .some((claim) => claim.reservedUsd === '0.0001'),
    ).toBe(true)
  }
  const response = b.admissions.find((item) => item.route === 'response')!
  const rate = MODEL_API_PRICES_PER_MILLION.contributor
  const bound = Usd.from(rate.input).times(5502).divide(TOKENS_PER_MILLION)
  expect(
    response.claims
      .filter((claim) => claim.settledUsd === undefined)
      .some((claim) => Usd.from(claim.reservedUsd).compare(bound) >= 0),
  ).toBe(true)
}

function expectSettlement(root: string, hasAudio = true) {
  const settled = claims(root)
  const rate = MODEL_API_PRICES_PER_MILLION.contributor
  const responseCost = Usd.from(rate.input)
    .times(2800)
    .add(Usd.from(rate.output).times(64))
    .divide(TOKENS_PER_MILLION)
    .toAmount()
  expect(settled.filter((claim) => claim.settledUsd === undefined)).toEqual([])
  expect(settled.some((claim) => claim.settledUsd === responseCost)).toBe(true)
  if (hasAudio)
    expect(
      settled.some((claim) => claim.reservedUsd === '0.0001' && claim.settledUsd === '0.0001'),
    ).toBe(true)
}

function runtimeFixture(root: string, b: ReturnType<typeof boundary>, hasVoice: boolean) {
  const homeDir = path.join(root, 'home')
  mkdirSync(homeDir)
  const parsed = parseCommandLine([
    '--backend',
    'modelApi',
    '--trust-workspace',
    '--allow-contributor-models',
    ...(hasVoice ? ['--muse-voice'] : []),
  ])
  if (parsed.command !== 'serve') throw new Error('expected serve options')
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  const deps = {
    options: parsed.options,
    version: 'test',
    distDir: dist,
    platform: process.platform,
    env: {},
    homeDir,
    secrets,
    runGit: () => Promise.resolve(''),
    fetch: b.fetch,
    sleep: () => Promise.resolve(),
    log: new FakeLogOutputChannel(),
  }
  return { runtime: createRuntimeBackend(deps), deps }
}

function editorFixture(
  root: string,
  b: ReturnType<typeof boundary>,
  action: 'transcribe' | 'sendAudio',
) {
  let selectedAction = action
  const attached = createAttachedMedia()
  const log = new FakeLogOutputChannel()
  const usage = new PaidUsage(log)
  const io = createToolIo({
    platform: process.platform,
    systemRoot: undefined,
    listFiles: () => Promise.resolve(['clip.mp4', 'speech.wav']),
    env: () => ({}),
    searchWorkerPath: path.join(dist, 'searchWorker.js'),
    log: () => undefined,
    unsavedFiles: () => [],
  })
  const paidPopup: (
    message: string,
    options: vscode.MessageOptions,
    ...items: vscode.MessageItem[]
  ) => Thenable<vscode.MessageItem | undefined> = vscode.window.showWarningMessage
  const consent = new PaidUseConsent({
    isOn: (feature) => feature === 'voice',
    canRemember: () => false,
    readGrants: () => new Set(),
    writeGrants: () => Promise.resolve(),
    log,
    ask: async (request, canRemember) => {
      b.order.push('consent')
      vi.mocked(paidPopup).mockImplementation((_message, _options, ...items) =>
        Promise.resolve(items.find((item) => item.title === UI_TEXT.allowOnce)),
      )
      return await askPaidUse(request, canRemember, Usd.from(1).toAmount())
    },
  })
  const ledgerDir = path.join(root, 'uploads')
  const daily = createRuntimeDailyBudget({
    dataFolder: root,
    now: Date.now,
    sleep: () => Promise.resolve(),
  })
  const store = createFileSessionStore({
    directory: path.join(root, 'sessions'),
    log,
    now: Date.now,
    sleep: () => Promise.resolve(),
    retentionDays: () => 0,
    uploads: createSessionUploads({
      uploadLedgerDir: ledgerDir,
      currentAccountId: () => manager.accountId(),
      filesClient: () => fakeModelApiClient({ ...b.api, fetch: b.fetch }, log),
    }),
  })
  const manager = new ModelApiBackendManager(
    fakeManagerDeps({ ...b.api, fetch: b.fetch }, log, {
      workspaceRoot: root,
      newId: randomUUID,
      now: Date.now,
      getApiKey: () => Promise.resolve(FAKE_MODEL_API_KEY),
      bundlePath: path.join(dist, 'modelApi.js'),
      store,
      uploadLedgerDir: ledgerDir,
      attachedMedia: attached,
      confirmContributorModel: () => Promise.resolve(true),
      isPaidFeatureOn: (feature) => feature === 'voice',
      notePaidUse: (feature, units, price) => {
        usage.add(feature, units, price)
      },
      io,
      mediaAudioAction: () => selectedAction,
      sessionBudgetUsd: () => Usd.from(1).toAmount(),
      allowsPaidUse: (request, requiresAsking) => consent.allows(request, requiresAsking),
      reservePaidExtra: async (cost, signal) => {
        const claim = await daily.reserve(cost, signal)
        return {
          reservedUsd: claim.reservedUsd,
          check: () => {
            claim.check(Usd.from(1).toAmount())
          },
          settle: claim.settle,
        }
      },
    }),
  )
  const port = createMediaAttachments(
    windowMediaAttachDeps({
      settings: () => ({
        mediaMaxUploadMiB: 200,
        screenRecordingMaxSeconds: 120,
        mediaAudioAction: selectedAction,
      }),
      open: {
        canonicalRelativePath: (file) =>
          Promise.resolve({
            canonical: path.relative(root, file).replaceAll('\\', '/'),
            checkedAbsolute: file,
          }),
        recordingTempRoot: path.join(root, 'recordings'),
      },
      attached,
      isVoiceOn: () => true,
      table: EN,
      locale: 'en',
    }),
    EN,
    'en',
  )
  return {
    manager,
    port,
    store,
    log,
    paidPopup,
    usage,
    setAudioAction: (next: typeof action) => {
      selectedAction = next
    },
  }
}

async function attachExisting(
  t: Awaited<ReturnType<typeof editorFixture>>,
  root: string,
  name: string,
) {
  const token = t.port.issue({ name, fsPath: path.join(root, name), relativePath: name })
  const prepared = await t.port.prepare(token, 'modelApi', MODEL)
  if (!prepared.ok) return prepared
  const store = new AttachmentStore(randomUUID, undefined, prepared.attachment.store)
  const added = store.addMedia(name, prepared.attachment.info)
  if (!added.ok) throw new Error(added.reason)
  return {
    ok: true as const,
    parts: store.partsFor([added.attachment.id]),
    summary: added.attachment,
  }
}

async function execFiles(
  root: string,
  b: ReturnType<typeof boundary>,
  attachments: readonly string[],
) {
  const parsed = parseCommandLine([
    'exec',
    '--backend',
    'modelApi',
    '--model',
    MODEL,
    '--allow-contributor-models',
    '--max-budget-usd',
    '1',
    ...attachments.flatMap((name) => ['--attach', name]),
    '--output',
    'jsonl',
    'Describe these files.',
  ])
  if (parsed.command !== 'exec') throw new Error('expected exec options')
  const homeDir = path.join(root, 'home')
  mkdirSync(homeDir)
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  const out = outputWriter()
  const err = outputWriter()
  const life = createLifecycle({
    processStartMs: Date.now(),
    timeoutMs: 60_000,
    now: Date.now,
    setTimer: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onSignal: () => ignoreSignals,
    forceFinish: () => undefined,
    exit: () => {
      throw new Error('unexpected exit')
    },
  })
  try {
    const code = await runExec(life, {
      options: parsed.options,
      version: 'test',
      distDir: dist,
      platform: process.platform,
      env: {},
      homeDir,
      processCwd: root,
      stdin: new PassThrough(),
      stdout: out,
      stderr: err,
      storeSecrets: secrets,
      runGit: () => Promise.resolve(''),
      fetch: b.fetch,
      sleep: () => Promise.resolve(),
      now: Date.now,
      readFile: (file) => Promise.resolve(new Uint8Array(readFileSync(file))),
      randomHex: () => randomUUID().replaceAll('-', ''),
      log: new FakeLogOutputChannel(),
    })
    return { code, out: out.chunks.join(''), err: err.chunks.join('') }
  } finally {
    life.dispose()
  }
}

describe('M105 production existing-file composition', () => {
  it('VS Code attaches video plus audio; consent and exact claims precede transcription and model delivery (2,3,5,6,7)', async () => {
    const root = scratch()
    const bytes = existingFiles(root)
    const b = boundary(root)
    vi.mocked(confirmModal).mockResolvedValue(UI_TEXT.media.send)
    const t = editorFixture(root, b, 'transcribe')
    try {
      const video = await attachExisting(t, root, 'clip.mp4')
      const audio = await attachExisting(t, root, 'speech.wav')
      if (!video.ok || !audio.ok) throw new Error('expected admitted existing files')
      expect(JSON.stringify([video.summary, audio.summary])).not.toContain(root)
      const host = await t.manager.ensureHost()
      const session = await host.startSession({
        workspaceRoot: root,
        modelId: MODEL,
        approvalMode: 'allowAll',
      })
      const h = watchSessionTurns(session)
      b.api.script({
        text: 'Saw the clip and heard the transcript.',
        usage: { input: 2800, output: 64 },
      })
      const done = h.turnDone()
      await session.sendTurn([
        { type: 'text', text: 'Describe these files.' },
        ...video.parts,
        ...audio.parts,
      ])
      await done
      expect(
        h.events.findLast((event) => event.type === 'turnCompleted'),
        JSON.stringify([h.events, t.log.error.mock.calls, t.log.warn.mock.calls]),
      ).toMatchObject({
        terminal: 'completed',
      })
      expectDelivery(b, bytes.video, bytes.audio)
      expect(t.usage.current.voiceSeconds).toBe(2)
      expect([video.summary.sizeBytes, audio.summary.sizeBytes]).toEqual([
        bytes.video.length,
        bytes.audio.length,
      ])
      expect(JSON.stringify(vi.mocked(t.paidPopup).mock.calls)).toContain('$0.18')
      expect(JSON.stringify(vi.mocked(t.paidPopup).mock.calls)).toContain('$1.00')
      expectSettlement(root)
      expect(b.order.indexOf('consent')).toBeLessThan(b.order.indexOf('transcription'))
    } finally {
      t.port.clear()
      await t.manager.dispose()
    }
  })

  it('sendAudio explicitly refuses Meta audio at attach without silently transcribing (4,6,7)', async () => {
    vi.mocked(confirmModal).mockResolvedValue(UI_TEXT.media.send)
    const root = scratch()
    existingFiles(root)
    const b = boundary(root)
    const t = editorFixture(root, b, 'sendAudio')
    try {
      const audio = await attachExisting(t, root, 'speech.wav')
      expect(audio).toEqual({
        ok: false,
        reason: fill(UI_TEXT.media.audioUnsupported, { model: MODEL }),
      })
      expect(b.order).toEqual([])
      expect(b.api.responseBodies()).toEqual([])
      expect(b.files.uploads).toEqual([])
    } finally {
      t.port.clear()
      await t.manager.dispose()
    }
  })

  it.each([true, false])(
    'ACP session/prompt carries video/audio with linked video=%s and the inverse embedded form (2,3,5,6,8)',
    async (linkedVideo) => {
      const root = scratch()
      const bytes = existingFiles(root)
      const b = boundary(root)
      const { runtime } = runtimeFixture(root, b, true)
      const permissions: acp.RequestPermissionRequest[] = []
      const agent = createAcpAgent({
        backend: runtime.backend,
        paid: runtime.paid,
        ...(runtime.media !== undefined && { media: runtime.media }),
        version: 'test',
        defaultCwd: root,
        options: { canBypass: false, allowsContributorModels: true, initialMode: 'manual' },
        signIn: { id: 'test', name: 'test', description: 'test', args: [], command: 'test' },
        log: new FakeLogOutputChannel(),
        questions: 'decline',
      })
      const client = acp
        .client({ name: 'media-composition' })
        .onRequest('session/request_permission', (context) => {
          permissions.push(context.params)
          b.order.push('consent')
          return { outcome: { outcome: 'selected', optionId: ACP_PAID_OPTIONS.allowOnce } }
        })
      try {
        await client.connectWith(agent, async (c) => {
          await c.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
          const { sessionId } = await c.request('session/new', { cwd: root, mcpServers: [] })
          await c.request('session/set_config_option', {
            sessionId,
            configId: 'model',
            value: MODEL,
          })
          b.api.script({ text: 'Saw and transcribed.', usage: { input: 2800, output: 64 } })
          const result = await c.request('session/prompt', {
            sessionId,
            prompt: [
              { type: 'text', text: 'Describe these files.' },
              ...(linkedVideo
                ? [
                    {
                      type: 'resource_link' as const,
                      name: 'clip.mp4',
                      uri: pathToFileURL(path.join(root, 'clip.mp4')).href,
                      mimeType: 'video/mp4',
                    },
                    {
                      type: 'audio' as const,
                      mimeType: 'audio/wav',
                      data: Buffer.from(bytes.audio).toString('base64'),
                    },
                  ]
                : [
                    {
                      type: 'resource' as const,
                      resource: {
                        uri: pathToFileURL(path.join(root, 'clip.mp4')).href,
                        mimeType: 'video/mp4',
                        blob: Buffer.from(bytes.video).toString('base64'),
                      },
                    },
                    {
                      type: 'resource_link' as const,
                      name: 'speech.wav',
                      uri: pathToFileURL(path.join(root, 'speech.wav')).href,
                      mimeType: 'audio/wav',
                    },
                  ]),
            ],
          })
          expect(result.stopReason).toBe('end_turn')
        })
        expectDelivery(b, bytes.video, bytes.audio)
        expect(permissions).toHaveLength(1)
        expect(JSON.stringify(permissions)).toContain('$0.18')
        expect(b.order.indexOf('consent')).toBeLessThan(b.order.indexOf('transcription'))
        expectSettlement(root)
      } finally {
        await runtime.close()
      }
    },
  )

  it('exec repeats existing-file attachments and explicitly refuses audio without a voice flag (4,6,9)', async () => {
    const root = scratch()
    existingFiles(root)
    const b = boundary(root)
    const { code, out, err } = await execFiles(root, b, ['clip.mp4', 'speech.wav'])
    expect(code).toBe(2)
    expect(out + err).toContain(fill(UI_TEXT.media.audioUnsupported, { model: MODEL }))
    expect(b.api.responseBodies()).toEqual([])
    expect(b.files.uploads).toEqual([])
    expect(b.audioBodies).toEqual([])
    expect(out).not.toContain(Buffer.from(wavFixture(2, { sampleRate: 16_000 })).toString('base64'))
  })
  it('exec delivers an existing video through the runtime and settles its exact run claim (2,3,5,9)', async () => {
    const root = scratch()
    const bytes = existingFiles(root)
    const b = boundary(root)
    b.api.script({ text: 'Saw the clip.', usage: { input: 2800, output: 64 } })
    const result = await execFiles(root, b, ['clip.mp4'])
    expect(result.code, result.err + result.out).toBe(0)
    expectDelivery(b, bytes.video)
    expectSettlement(root, false)
    expect(result.out).toContain('"status":"completed"')
    expect(result.out).not.toContain(Buffer.from(bytes.video).toString('base64'))
  })
  it('a sendAudio setting change after attach refuses at the production session instead of transcribing (4,6)', async () => {
    const root = scratch()
    existingFiles(root)
    const b = boundary(root)
    vi.mocked(confirmModal).mockResolvedValue(UI_TEXT.media.send)
    const t = editorFixture(root, b, 'transcribe')
    try {
      const audio = await attachExisting(t, root, 'speech.wav')
      if (!audio.ok) throw new Error('expected admitted audio')
      t.setAudioAction('sendAudio')
      const host = await t.manager.ensureHost()
      const session = await host.startSession({
        workspaceRoot: root,
        modelId: MODEL,
        approvalMode: 'allowAll',
      })
      const h = watchSessionTurns(session)
      const done = h.turnDone()
      await session.sendTurn(audio.parts)
      await done
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
        reason: fill(UI_TEXT.media.audioUnsupported, { model: MODEL }),
      })
      expect(b.order).toEqual([])
      expect(b.files.uploads).toEqual([])
    } finally {
      t.port.clear()
      await t.manager.dispose()
    }
  })
  it('capped first-turn audio preparation waits for the owned session save (5,6; deterministic guard regression)', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const store = memorySessionStore()
    const save = store.save
    store.save = async (snapshot) => {
      // A controlled delayed write: preparation must await it, regardless of disk timing.
      await new Promise<void>((resolve) => setImmediate(resolve))
      await save(snapshot)
    }
    const prepareAudioMessage = vi.fn<NonNullable<ModelApiHostDeps['prepareAudioMessage']>>(
      (request) => {
        expect(
          store.saved.has(request.sessionId),
          'initial session record must be durable before audio preparation',
        ).toBe(true)
        return Promise.resolve({
          parts: [{ type: 'text', text: 'The Blue Llama.' }],
          modelId: request.modelId,
          assertCurrent: () => undefined,
        })
      },
    )
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({
        client: fakeModelApiClient(api, log),
        workspaceRoot: '/ws',
        io: memoryToolIo({}, '/ws'),
        log,
      }),
      store,
      sessionBudgetUsd: () => Usd.from(1).toAmount(),
      prepareAudioMessage,
    })
    try {
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'allowAll',
      })
      const h = watchSessionTurns(session)
      const done = h.turnDone()
      await session.sendTurn([
        {
          type: 'media',
          token: 'existing-audio',
          name: 'speech.wav',
          sha256: '0'.repeat(64),
          info: { kind: 'audio', mediaType: 'audio/wav', sizeBytes: 64_044, durationSeconds: 2 },
        },
      ])
      await done
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      expect(prepareAudioMessage).toHaveBeenCalledTimes(1)
    } finally {
      await host.close()
    }
  })
})
