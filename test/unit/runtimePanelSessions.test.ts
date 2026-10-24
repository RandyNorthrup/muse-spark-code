// Conversations in the runtime panel (M104 lane B), proved through the
// runtime's own connection to an editor (helpers/panelConversation.ts): the
// session a ready backend starts, the surface bound to it, a replacement when
// the conversation moves, settings and trust that rebuild it, unsaved files,
// and the paid features. No prompt is sent and no network is touched.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { paidGrantsFile } from '../../src/runtime/dataFolder'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { ACP_PAID_OPTIONS, UI_TEXT } from '../../src/shared/constants'
import { formatDailyBudget } from '../../src/shared/l10n/exactUsd'
import { fill } from '../../src/shared/l10n/text'
import { paidFeatureName, paidFeaturePrice } from '../../src/shared/paid'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import { confirmations, connectedPanel } from './helpers/panelConversation'
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

const connected = async (options: { readonly trusted?: boolean } = {}) =>
  await connectedPanel(run, options)

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
