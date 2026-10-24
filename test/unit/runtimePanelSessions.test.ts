// Conversations in the runtime panel (M104 lane B): `runPanel` runs here in
// the suite's process over a pair of streams, with the editor on the other
// end. The conversation controller is the product's own, loaded from the
// shared production build; the backend is the product's own Model API host
// over a real file session store (`modelApiRig`, no key stored, a real
// providers file for its models), reported ready. A session starts and ends
// locally; no prompt is sent and no network is touched.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { runPanel } from '../../src/runtime/panel/panelEntry'
import type { RuntimeBackend } from '../../src/runtime/backends'
import { paidGrantsFile } from '../../src/runtime/dataFolder'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { createRuntimeBackend } from '../../src/runtime/runtimeEngineEntry'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { ACP_PAID_OPTIONS, UI_TEXT } from '../../src/shared/constants'
import { formatDailyBudget } from '../../src/shared/l10n/exactUsd'
import { fill } from '../../src/shared/l10n/text'
import { paidFeatureName, paidFeaturePrice } from '../../src/shared/paid'
import { panelInitializeResultSchema } from '../../src/shared/hostApi/panel'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import { modelApiRig } from './helpers/conversationPanel'
import { createEditorChatServices, writeEditorChatProvidersFile } from './helpers/editorChatRig'
import { connectMhpHost, type MhpWire } from './helpers/mhpHost'
import { panelEditor } from './helpers/panelEditor'
import { createPanelRun } from './helpers/panelRun'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()
const run = createPanelRun('muse-sessions-')
const log = stderrLogger(() => undefined, 'warn')

beforeAll(() => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  run.prepare()
})

afterAll(async () => {
  await run.dispose()
})

/** The runtime panel in this process, and the editor's end of its streams. */
async function connected(options: { readonly trusted?: boolean } = {}) {
  const folder = path.join(run.folder, 'sessions')
  mkdirSync(folder, { recursive: true })
  const { configFile, catalogFile } = writeEditorChatProvidersFile(folder)
  const { models } = createEditorChatServices(configFile, catalogFile).client
  const rig = modelApiRig(folder, undefined, undefined, { ...(models !== undefined && { models }) })
  const runtimes: RuntimeBackend[] = []
  const unsaved: (() => readonly string[])[] = []
  const toRuntime = new PassThrough()
  const fromRuntime = new PassThrough()
  const exit = runPanel(
    { workspace: run.workspace, isVerbose: false },
    {
      stdin: toRuntime,
      stdout: fromRuntime,
      table: UI_TEXT,
      locale: 'en',
      log,
      dataFolder: run.dataFolder,
      distDir: path.join(ROOT, 'dist'),
      // The product's own runtime; only the backend is the rig's host, reported ready.
      createRuntime: (options, questions, unsavedFiles) => {
        unsaved.push(unsavedFiles)
        const runtime = createRuntimeBackend({
          hostKind: 'acp',
          options,
          version: '0.19.0',
          distDir: path.join(ROOT, 'dist'),
          platform: process.platform,
          env: run.environment(),
          homeDir: run.home,
          secrets: {
            get: () => Promise.reject(new Error('this suite never reads the credential store')),
            store: () => Promise.reject(new Error('this suite never writes the credential store')),
            delete: () => Promise.reject(new Error('this suite never clears the credential store')),
          },
          runGit: () => Promise.reject(new Error('this suite has no git')),
          fetch: () => Promise.reject(new Error('no request may leave the machine')),
          sleep: () => Promise.resolve(),
          log,
          questions,
          unsavedFiles,
        })
        const ready = {
          ...runtime,
          backend: {
            kind: 'modelApi' as const,
            readiness: () => Promise.resolve({ state: 'ready' as const }),
            hostFor: () => Promise.resolve(rig.host),
          },
        }
        runtimes.push(ready)
        return Promise.resolve(ready)
      },
      runGit: () => Promise.reject(new Error('this suite has no git')),
    },
  )
  const host = connectMhpHost(toRuntime, fromRuntime)
  const editor = panelEditor(host)
  panelInitializeResultSchema.parse(
    await host.request(
      'initialize',
      run.initializeParams({
        capabilities: ['lifecycle', 'ui', 'surfaces', 'terminal'],
        trusted: options.trusted ?? true,
      }),
    ),
  )
  return { host, editor, rig, exit, runtimes, unsaved }
}

describe('conversations in the runtime panel', () => {
  it('starts a session on a ready backend, shows it, and ends with the host', async () => {
    const { host, editor, rig, exit } = await connected()
    const chat = await editor.nextSurface()
    // The surface is bound to the session the backend started, not to an id of the panel's own.
    expect(rig.host.sessionCount).toBe(1)
    expect(await chat.shown('authState')).toMatchObject({ status: 'signedIn', backend: 'modelApi' })
    expect(await chat.shown('sessionInfo')).toMatchObject({ sessionId: chat.sessionId })
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
    expect(rig.host.sessionCount).toBe(0)
  })

  it('replaces the surface when the conversation moves to a new session', async () => {
    const { host, editor, rig, exit } = await connected()
    const first = await editor.nextSurface()
    await first.shown('sessionInfo')
    first.say({ type: 'clearConversation' })
    // A surface is bound to one session for good: the old one closes, a fresh one opens.
    const second = await editor.nextSurface()
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(second.surface).not.toBe(first.surface)
    expect(editor.closed).toEqual([first.surface])
    expect(await second.shown('sessionInfo')).toMatchObject({ sessionId: second.sessionId })
    first.lifecycle('closed', { droppedMessages: 0 })
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
    expect(rig.host.sessionCount).toBe(0)
  })

  it('shows a reloaded surface the conversation again', async () => {
    const { host, editor, exit } = await connected()
    const chat = await editor.nextSurface()
    await chat.shown('historyLoaded')
    chat.lifecycle('reloaded', { stateRequest: { type: 'ready' } })
    chat.lifecycle('ready')
    // The saved request replays once the page is ready again, without a new envelope.
    expect(await chat.shown('historyLoaded')).toMatchObject({ sessionId: chat.sessionId })
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('shows every surface the person’s settings when they change', async () => {
    const { host, editor, exit } = await connected()
    const chat = await editor.nextSurface()
    await chat.shown('init', (payload) => settingsOf(payload)['autosave'] === true)
    parseMhpResult(
      'settings/update',
      await host.request('settings/update', {
        key: 'museSpark.autosave',
        value: false,
        scope: 'user',
      }),
    )
    await chat.shown('init', (payload) => settingsOf(payload)['autosave'] === false)
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('ends its conversations and starts afresh when the editor stops trusting the workspace', async () => {
    const { host, editor, exit } = await connected()
    const trusted = await editor.nextSurface()
    host.send({ jsonrpc: '2.0', method: 'workspace/didChangeTrust', params: { trusted: false } })
    // The backend is built for the new trust: the old surface closes, a fresh one opens on a new session.
    const restricted = await editor.nextSurface()
    expect(restricted.sessionId).not.toBe(trusted.sessionId)
    expect(editor.closed).toEqual([trusted.surface])
    expect(await restricted.shown('sessionInfo')).toMatchObject({ sessionId: restricted.sessionId })
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('does the same when the person changes what the backend is built from', async () => {
    const { host, editor, exit } = await connected()
    const first = await editor.nextSurface()
    parseMhpResult(
      'settings/update',
      await host.request('settings/update', {
        key: 'museSpark.shellSandbox',
        value: 'off',
        scope: 'user',
      }),
    )
    const second = await editor.nextSurface()
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(editor.closed).toEqual([first.surface])
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })
})

/** The questions the editor was asked, and the answers it gives in turn (null closes the question). */
function confirmations(
  host: MhpWire,
  answers: (string | number | null | Promise<string | number | null>)[],
) {
  interface Question {
    readonly title: string
    readonly message: string
    readonly choices: readonly { readonly id: string | number; readonly title: string }[]
  }
  const asked: Question[] = []
  const waiting: { readonly count: number; readonly resolve: () => void }[] = []
  host.serve('ui/confirm', (params) => {
    asked.push(params as Question)
    for (const waiter of waiting) if (asked.length >= waiter.count) waiter.resolve()
    return answers.shift() ?? null
  })
  return {
    asked,
    /** Resolves once the editor has been asked this many times. */
    reached: (count: number) =>
      asked.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiting.push({ count, resolve })
          }),
  }
}

describe('what the editor holds unsaved', () => {
  it('reaches the backend, so the model’s tools leave those files alone', async () => {
    const { host, editor, unsaved, exit } = await connected()
    await editor.nextSurface()
    const [unsavedFiles] = unsaved
    const file = path.join(run.workspace, 'open.ts')
    const document = { uri: pathToFileURL(file).href, version: 1, languageId: 'typescript' }
    host.send({
      jsonrpc: '2.0',
      method: 'documents/didChange',
      params: { document: { ...document, dirty: true }, text: 'let x' },
    })
    // The answer to a request comes after the notification was handled.
    await host.request('settings/get', { key: 'museSpark.autosave' })
    expect(unsavedFiles?.()).toContain(file)
    host.send({
      jsonrpc: '2.0',
      method: 'documents/didSave',
      params: { ...document, version: 2, dirty: false },
    })
    await host.request('settings/get', { key: 'museSpark.autosave' })
    expect(unsavedFiles?.()).toEqual([])
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })
})

describe('paid features in the runtime panel', () => {
  it('shows the features that are on, and names the price before one is turned back on', async () => {
    const { host, editor, exit } = await connected()
    const accepted = Promise.withResolvers<number>()
    const { asked, reached } = confirmations(host, [null, accepted.promise])
    const first = await editor.nextSurface()
    // Unset, a paid feature is on by default on the Model API (D78); each use still asks.
    expect(await first.shown('paidState')).toMatchObject({
      state: { features: ['autoCompaction', 'webSearch', 'imageGeneration', 'voice'] },
    })
    first.say({ type: 'setPaidFeature', feature: 'webSearch', isOn: false })
    const off = await editor.nextSurface()
    expect(await off.shown('paidState')).toMatchObject({
      state: { features: ['autoCompaction', 'imageGeneration', 'voice'] },
    })
    // Turning it on again names the price; closing the question leaves it off.
    off.say({ type: 'setPaidFeature', feature: 'webSearch', isOn: true })
    await reached(1)
    expect(asked[0]).toEqual({
      title: fill(UI_TEXT.paidConfirmTitle, { feature: paidFeatureName('webSearch') }),
      message: fill(UI_TEXT.paidConfirmWebSearch, { price: paidFeaturePrice('webSearch') }),
      choices: [{ id: 1, title: UI_TEXT.paidConfirmAccept }],
    })
    off.say({ type: 'setPaidFeature', feature: 'webSearch', isOn: true })
    // The first question was closed: by the time the second is asked, the first has ended with the feature still off.
    await reached(2)
    expect(
      parseMhpResult(
        'settings/get',
        await host.request('settings/get', { key: 'museSpark.modelApiWebSearch' }),
      ).result,
    ).toEqual({ value: false })
    accepted.resolve(1)
    const on = await editor.nextSurface()
    expect(await on.shown('paidState')).toMatchObject({
      state: { features: ['autoCompaction', 'webSearch', 'imageGeneration', 'voice'] },
    })
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('asks before every paid use, and keeps Always in the grants file the ACP agent reads', async () => {
    const { host, editor, runtimes, exit } = await connected()
    const { asked } = confirmations(host, [
      ACP_PAID_OPTIONS.allowOnce,
      ACP_PAID_OPTIONS.deny,
      ACP_PAID_OPTIONS.allowAlways,
    ])
    const chat = await editor.nextSurface()
    const [runtime] = runtimes
    expect(runtime).toBeDefined()
    const use = (feature: 'voice' | 'imageGeneration') =>
      runtime?.paid.allows(
        run.workspace,
        chat.sessionId,
        feature === 'voice'
          ? { feature }
          : { feature, kind: 'generate', path: 'out.png', sources: [], prompt: 'a cat' },
        false,
      )
    expect(await use('voice')).toBe(true)
    expect(await use('imageGeneration')).toBe(false)
    expect(await use('voice')).toBe(true)
    // Remembered now: the next use asks nothing.
    expect(await use('voice')).toBe(true)
    expect(asked).toHaveLength(3)
    for (const question of asked)
      expect(question.choices.map((choice) => choice.id)).toEqual([
        ACP_PAID_OPTIONS.allowOnce,
        ACP_PAID_OPTIONS.allowAlways,
        ACP_PAID_OPTIONS.deny,
      ])
    // No limit was set: the question says so, and nothing is checked against one (D208).
    expect(asked[0]?.message).toContain(UI_TEXT.paidDailyBudgetNone)
    const grants = paidGrantFile({
      file: paidGrantsFile({
        platform: process.platform,
        env: run.environment(),
        homeDir: run.home,
      }),
      log,
      sleep: () => Promise.resolve(),
    })
    expect(grants.read(run.workspace)).toEqual(new Set(['voice']))
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('names the limit the person set, and offers no Always where nothing can be kept', async () => {
    const { host, editor, runtimes, exit } = await connected({ trusted: false })
    const { asked } = confirmations(host, [ACP_PAID_OPTIONS.allowOnce, ACP_PAID_OPTIONS.allowOnce])
    const chat = await editor.nextSurface()
    const [runtime] = runtimes
    parseMhpResult(
      'settings/update',
      await host.request('settings/update', {
        key: 'museSpark.paidDailyBudgetUsd',
        value: 3,
        scope: 'user',
      }),
    )
    expect(
      await runtime?.paid.allows(run.workspace, chat.sessionId, { feature: 'voice' }, false),
    ).toBe(true)
    expect(asked[0]?.message).toContain(formatDailyBudget(3))
    expect(asked[0]?.message).not.toContain(UI_TEXT.paidDailyBudgetNone)
    expect(asked[0]?.choices.map((choice) => choice.id)).toEqual([
      ACP_PAID_OPTIONS.allowOnce,
      ACP_PAID_OPTIONS.deny,
    ])
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })
})

function settingsOf(payload: Record<string, unknown>): Record<string, unknown> {
  const settings = payload['settings']
  return typeof settings === 'object' && settings !== null
    ? (settings as Record<string, unknown>)
    : {}
}
