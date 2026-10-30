// Conversations in the runtime panel (M104 lane B), proved through the
// runtime's own connection to an editor (helpers/panelConversation.ts): the
// session a ready backend starts, the surface bound to it, a replacement when
// the conversation moves, settings and trust that rebuild it, unsaved files,
// and the paid features. No prompt is sent and no network is touched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { PLAN_MARKDOWN } from '../../src/core/plans/planMarkdown'
import { PlanStore } from '../../src/core/plans/planStore'
import { createPlanIo } from '../../src/host/planFeatures'
import { paidGrantsFile } from '../../src/runtime/dataFolder'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { ACP_PAID_OPTIONS, OUTPUT_TAB_ID_LENGTH, UI_TEXT } from '../../src/shared/constants'
import { formatDailyBudget } from '../../src/shared/l10n/exactUsd'
import { fill } from '../../src/shared/l10n/text'
import { paidFeatureName, paidFeaturePrice } from '../../src/shared/paid'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import {
  confirmations,
  connectedPanel,
  type ConnectedPanelOptions,
} from './helpers/panelConversation'
import type { MhpWire } from './helpers/mhpHost'
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

const connected = async (options: ConnectedPanelOptions = {}) => await connectedPanel(run, options)

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

  it('asks again for every feature when the person says so', async () => {
    const { host, editor, runtimes, exit } = await connected()
    const { asked } = confirmations(host, [
      ACP_PAID_OPTIONS.allowAlways,
      ACP_PAID_OPTIONS.allowOnce,
    ])
    const chat = await editor.nextSurface()
    // The state the surface was first shown, set aside so the next one is the answer to Ask again.
    await chat.shown('paidState')
    const [runtime] = runtimes
    const use = () =>
      runtime?.paid.allows(
        run.workspace,
        chat.sessionId,
        {
          feature: 'imageGeneration',
          kind: 'generate',
          path: 'out.png',
          sources: [],
          prompt: 'a cat',
        },
        false,
      )
    // Always is kept after the first answer: the second use asks nothing.
    expect(await use()).toBe(true)
    expect(await use()).toBe(true)
    expect(asked).toHaveLength(1)
    chat.say({ type: 'forgetPaidUse' })
    expect(await chat.shown('paidState')).toMatchObject({ state: { alwaysAllowed: [] } })
    expect(await use()).toBe(true)
    expect(asked).toHaveLength(2)
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('flags on the backend a feature whose price the person accepts at the start review', async () => {
    const reviewRun = createPanelRun('muse-sessions-review-')
    reviewRun.prepare()
    // The person set the feature on in their settings file, but its price
    // was never accepted: the start review asks, as VS Code's does (D30).
    mkdirSync(reviewRun.dataFolder, { recursive: true })
    writeFileSync(
      path.join(reviewRun.dataFolder, 'settings.json'),
      `${JSON.stringify({ modelApiWebSearch: true }, null, 2)}\n`,
    )
    try {
      let questions: ReturnType<typeof confirmations> | undefined
      const { host, editor, runtimes, exit } = await connectedPanel(reviewRun, {
        beforeInitialize: (wire) => {
          questions = confirmations(wire, [1, ACP_PAID_OPTIONS.allowOnce])
        },
      })
      const chat = await editor.nextSurface()
      expect(questions?.asked[0]).toMatchObject({
        title: fill(UI_TEXT.paidConfirmTitle, { feature: paidFeatureName('webSearch') }),
      })
      expect(await chat.shown('paidState')).toMatchObject({
        state: { features: ['autoCompaction', 'webSearch', 'imageGeneration', 'voice'] },
      })
      // The backend the conversation bills through has the feature flagged:
      // an accepted price at the review is not left showing on but denied.
      const runtime = runtimes.at(-1)
      expect(runtime?.paid.isOn('webSearch')).toBe(true)
      expect(
        await runtime?.paid.allows(
          reviewRun.workspace,
          chat.sessionId,
          {
            feature: 'imageGeneration',
            kind: 'generate',
            path: 'out.png',
            sources: [],
            prompt: 'a cat',
          },
          false,
        ),
      ).toBe(true)
      parseMhpResult('shutdown', await host.request('shutdown', {}))
      expect(await exit).toBe(0)
    } finally {
      await reviewRun.dispose()
    }
  })

  it('offers no paid feature the person never set on the Muse Code backend (D78)', async () => {
    const codeRun = createPanelRun('muse-sessions-code-')
    codeRun.prepare()
    try {
      const { host, editor, exit } = await connectedPanel(codeRun, { backendKind: 'museCode' })
      const chat = await editor.nextSurface()
      // Unset, a paid feature is on by default only on the Model API; on
      // Muse Code it is unavailable until the person sets it (D78).
      expect(await chat.shown('paidState')).toMatchObject({ state: { features: [] } })
      parseMhpResult('shutdown', await host.request('shutdown', {}))
      expect(await exit).toBe(0)
    } finally {
      await codeRun.dispose()
    }
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

/** The first file the runtime asks the editor to open, as a URI. */
function firstOpened(host: MhpWire): Promise<string> {
  const opened = Promise.withResolvers<string>()
  host.serve('editor/open', (params) => {
    opened.resolve((params as { uri: string }).uri)
    return null
  })
  return opened.promise
}

describe('the tasks tab', () => {
  it('opens as a tasks surface of the conversation, comes forward when pressed again, brings the chat forward, and closes with its session', async () => {
    const { host, editor, exit } = await connected()
    const focused: string[] = []
    const waiting: (() => void)[] = []
    host.serve('surfaces/focus', (params) => {
      focused.push((params as { surfaceId: string }).surfaceId)
      for (const wake of waiting.splice(0)) wake()
      return null
    })
    /** Resolves once the editor has been asked to bring this many surfaces forward. */
    const focusedCount = async (count: number): Promise<void> => {
      while (focused.length < count)
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
        })
    }
    const chat = await editor.nextSurface()
    await chat.shown('sessionInfo')
    chat.say({ type: 'hostAction', action: 'openTasksTab' })
    const tasks = await editor.nextSurface({ type: 'tasksReady' })
    expect(editor.opened.at(-1)).toEqual({
      kind: 'tasks',
      placement: 'tab',
      sessionId: chat.sessionId,
    })
    expect(tasks.sessionId).toBe(chat.sessionId)
    expect(await tasks.shown('tasksState')).toEqual({
      type: 'tasksState',
      conversation: UI_TEXT.untitledConversation,
      items: [],
      ended: false,
      canMoveToWindow: false,
    })
    // Pressed again, the open tab comes forward: no second tab.
    const openedSoFar = editor.opened.length
    chat.say({ type: 'hostAction', action: 'openTasksTab' })
    await focusedCount(1)
    expect(focused).toEqual([tasks.surface])
    expect(editor.opened).toHaveLength(openedSoFar)
    // "Open the conversation" brings the chat of the same session to the front.
    tasks.say({ type: 'revealConversation' })
    await focusedCount(2)
    expect(focused).toEqual([tasks.surface, chat.surface])
    // An MHP surface is bound to one session for good: both go when the conversation moves on.
    chat.say({ type: 'clearConversation' })
    const next = await editor.nextSurface()
    expect(next.sessionId).not.toBe(chat.sessionId)
    expect(editor.closed).toEqual(expect.arrayContaining([chat.surface, tasks.surface]))
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })
})

describe('what the person opens from the chat', () => {
  it('shows a tool row’s full output in a tab of the editor, and removes the file with the connection', async () => {
    const { host, editor, exit } = await connected({ offers: ['editor'] })
    const opened = firstOpened(host)
    const chat = await editor.nextSurface()
    await chat.shown('sessionInfo')
    const text = 'first line\nsecond line\n'
    const itemId = 'item-0123456789ab'
    chat.say({ type: 'openOutput', itemId, label: 'bash', text })
    // The editor is asked to open a file of the data folder holding exactly the text.
    const file = fileURLToPath(await opened)
    const title = fill(UI_TEXT.toolOutputTitle, {
      tool: 'bash',
      id: itemId.slice(-OUTPUT_TAB_ID_LENGTH),
    })
    expect(path.basename(file)).toBe(`${title}.txt`)
    expect(file.startsWith(run.dataFolder)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(text)
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
    expect(existsSync(file)).toBe(false)
  })

  it('lists the saved plans in the editor’s pick and opens the one chosen', async () => {
    const store = new PlanStore({
      workspaceRoot: run.workspace,
      platform: process.platform,
      io: createPlanIo({ log, now: () => Date.now() }),
      markdown: () => PLAN_MARKDOWN,
    })
    const saved = await store.save({
      title: 'Tidy the parser',
      savedAt: new Date(0),
      text: '# Tidy the parser\n\n1. Read it\n2. Simplify it\n',
    })
    const { host, editor, exit } = await connected({ offers: ['editor'] })
    const picks: { title: string; items: { id: string; title: string }[] }[] = []
    host.serve('ui/pick', (params) => {
      const asked = params as (typeof picks)[number]
      picks.push(asked)
      // The plan first, then what to do with it: open.
      const row =
        picks.length === 1
          ? asked.items[0]
          : asked.items.find((item) => item.title === UI_TEXT.planOpen)
      return row === undefined ? null : [row.id]
    })
    const opened = firstOpened(host)
    const chat = await editor.nextSurface()
    await chat.shown('sessionInfo')
    chat.say({ type: 'showPlans' })
    expect(fileURLToPath(await opened)).toBe(path.join(run.workspace, saved.relativePath))
    expect(picks[0]?.items.map((item) => item.title)).toContain('Tidy the parser')
    expect(picks).toHaveLength(2)
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('says how to sign out, which only the person can do where the sign-in is kept', async () => {
    const { host, editor, exit } = await connected()
    const chat = await editor.nextSurface()
    await chat.shown('sessionInfo')
    chat.say({ type: 'signOut' })
    expect(await chat.shown('notice', (payload) => payload['level'] === 'error')).toMatchObject({
      text: expect.stringContaining(UI_TEXT.signOutInTerminal),
    })
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
