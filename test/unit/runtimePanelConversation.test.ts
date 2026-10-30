// The chat in `muse-spark-code-acp panel --stdio` (M104 lane B): the packed
// agent of the shared production build runs the conversation controller the
// editor's webview talks to, over real stdio. The suite is the editor: it
// answers the runtime's requests (`surfaces/open`, `terminal/create`), opens
// the surface it was asked for, and speaks the webview's messages inside the
// panel envelopes the frozen contract defines. The person's settings are
// written through the runtime's own settings store, into the files the
// runtime reads. No provider, key or network is touched.
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { ACP_AGENT_NAME } from '../../src/shared/constants'
import { panelInitializeResultSchema } from '../../src/shared/hostApi/panel'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import path from 'node:path'
import { panelEditor } from './helpers/panelEditor'
import { createPanelRun } from './helpers/panelRun'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()
const run = createPanelRun('muse-chat-')

/** What the editor offers the runtime: everything the chat asks for in this suite. */
const OFFERED = ['lifecycle', 'ui', 'surfaces', 'terminal'] as const

beforeAll(() => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  run.prepare()
})

afterAll(async () => {
  await run.dispose()
})

/** The person's settings, written where the runtime reads them. */
async function writeSettings(values: Readonly<Record<string, string>>): Promise<void> {
  const store = new RuntimeSettingsStore({
    dataFolder: run.dataFolder,
    workspaceRoot: run.workspace,
    log: stderrLogger(() => undefined, 'warn'),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
  for (const [key, value] of Object.entries(values))
    await store.updateSetting(`museSpark.${key}`, value, 'user')
}

/** A runtime whose backend is not ready, and the chat surface it asked the editor to open. */
async function openedChat() {
  await writeSettings({
    backend: 'museCode',
    museBinaryPath: path.join(run.folder, 'no-such-muse'),
  })
  const host = run.serve(['panel', '--stdio'])
  const editor = panelEditor(host)
  panelInitializeResultSchema.parse(
    await host.request('initialize', run.initializeParams({ capabilities: [...OFFERED] })),
  )
  return { host, chat: await editor.nextSurface() }
}

describe('the chat in panel --stdio', () => {
  it('shows the sign-in gate when the backend is not ready, and starts the sign-in in the editor’s terminal', async () => {
    const { host, chat } = await openedChat()
    const init = await chat.shown('init')
    expect(init).toMatchObject({ settings: { initialPermissionMode: 'manual' } })
    const auth = await chat.shown('authState')
    expect(auth['status']).not.toBe('signedIn')
    expect(auth).toMatchObject({ backend: 'museCode', methods: ['browser'] })

    const terminalShown = Promise.withResolvers<boolean>()
    host.serve('terminal/create', () => ({ terminalId: 'terminal-1' }))
    host.serve('terminal/show', () => {
      terminalShown.resolve(true)
      return null
    })
    chat.say({ type: 'signIn', method: 'browser' })
    await terminalShown.promise
    // The key is typed in the terminal; the gate goes back to waiting for it.
    await chat.shown('authState', (payload) => payload['status'] === 'signingIn')
    await chat.shown('authState', (payload) => payload['status'] === 'signedOut')
    const create = host.asked.find((request) => request.method === 'terminal/create')
    expect(create?.params).toMatchObject({
      executable: ACP_AGENT_NAME,
      args: ['login'],
      cwd: pathToFileURL(run.workspace).href,
    })

    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await host.exited).toBe(0)
  })

  it('refuses, in the contract’s words, a frame that does not belong to a surface it holds', async () => {
    const { host, chat } = await openedChat()
    const refusal = async (code: string) => {
      const frame = await host.next((candidate) => candidate['kind'] === 'panelError')
      expect(frame).toMatchObject({ code })
      return frame
    }
    const envelope = { mhp: '1.5', kind: 'panel', surface: chat.surface, direction: 'toHost' }
    // A sequence that skips ahead, a surface nobody opened, and a frame the wrong way round.
    host.send({ ...envelope, seq: 7, payload: { type: 'inputFocusChanged', focused: true } })
    expect(await refusal('MHP_PANEL_OUT_OF_ORDER')).toMatchObject({ surface: chat.surface, seq: 7 })
    host.send({ ...envelope, surface: 'nobody-opened-this', seq: 1, payload: { type: 'ready' } })
    await refusal('MHP_PANEL_UNKNOWN_SURFACE')
    host.send({
      ...envelope,
      direction: 'toPanel',
      seq: 2,
      payload: { type: 'skillList', skills: [] },
    })
    await refusal('MHP_PANEL_WRONG_DIRECTION')
    // A surface for a session the runtime does not hold.
    host.send({
      mhp: '1.5',
      kind: 'surface',
      event: 'opened',
      surface: 'stranger',
      sessionId: 'no-such-session',
      surfaceKind: 'chat',
    })
    await refusal('MHP_PANEL_UNKNOWN_SURFACE')
    // The surface it does hold still works after the refusals.
    chat.say({ type: 'inputFocusChanged', focused: true })
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await host.exited).toBe(0)
  })
})
