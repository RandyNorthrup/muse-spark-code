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
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { runPanel } from '../../src/runtime/panel/panelEntry'
import { createRuntimeBackend } from '../../src/runtime/runtimeEngineEntry'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { UI_TEXT } from '../../src/shared/constants'
import { panelInitializeResultSchema } from '../../src/shared/hostApi/panel'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import { modelApiRig } from './helpers/conversationPanel'
import { createEditorChatServices, writeEditorChatProvidersFile } from './helpers/editorChatRig'
import { connectMhpHost } from './helpers/mhpHost'
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
async function connected() {
  const folder = path.join(run.folder, 'sessions')
  mkdirSync(folder, { recursive: true })
  const { configFile, catalogFile } = writeEditorChatProvidersFile(folder)
  const { models } = createEditorChatServices(configFile, catalogFile).client
  const rig = modelApiRig(folder, undefined, undefined, { ...(models !== undefined && { models }) })
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
      createRuntime: (options, questions) => {
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
        })
        return Promise.resolve({
          ...runtime,
          backend: {
            kind: 'modelApi',
            readiness: () => Promise.resolve({ state: 'ready' }),
            hostFor: () => Promise.resolve(rig.host),
          },
        })
      },
      runGit: () => Promise.reject(new Error('this suite has no git')),
    },
  )
  const host = connectMhpHost(toRuntime, fromRuntime)
  const editor = panelEditor(host)
  panelInitializeResultSchema.parse(
    await host.request(
      'initialize',
      run.initializeParams({ capabilities: ['lifecycle', 'ui', 'surfaces', 'terminal'] }),
    ),
  )
  return { host, editor, rig, exit }
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

function settingsOf(payload: Record<string, unknown>): Record<string, unknown> {
  const settings = payload['settings']
  return typeof settings === 'object' && settings !== null
    ? (settings as Record<string, unknown>)
    : {}
}
