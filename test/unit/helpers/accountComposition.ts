import { createConfiguredProviderServices } from '../../../src/core/providers/configured'
// Real account/manager composition. Synthetic SecretStorage and captured model
// responses stand in for external boundaries; metadata and journal use disk.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRuntimeAccountServices } from '../../../src/runtime/providers/runtimeServices'
import { createEditorAccountServices } from '../../../src/host/providers/editorAccounts'
import { runAccountsCommand } from '../../../src/runtime/providers/accountsCommand'
import { parseAccountsCommand } from '../../../src/runtime/providers/accountArgs'
import { createRuntimeBackend } from '../../../src/runtime/backends'
import { parseCommandLine } from '../../../src/runtime/cliArgs'
import { agentDataFolder } from '../../../src/runtime/dataFolder'
import { ModelApiBackendManager } from '../../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../../src/host/backend/modelApiEntry'
import { AccountRequestJournal } from '../../../src/runtime/providers/accountRequestJournal'
import { accountPeriodRange } from '../../../src/core/accounts/thresholds'
import { MODEL_API_BASE_URL, ACCOUNT_REQUEST_STORE } from '../../../src/shared/constants'
import { memorySecrets, FakeLogOutputChannel } from './fakes'
import { CURRENT_SHAPE_KEYS } from './modelApiKeys'
import { fakeModelApi } from './fakeModelApi'
import { fakeManagerDeps } from './modelApiManager'
import { watchSessionTurns } from './sessionTurns'

export const ACCOUNT_TEST_MODEL = 'muse-spark-1.3'
export { CURRENT_SHAPE_KEYS as ACCOUNT_TEST_KEYS } from './modelApiKeys'

export async function accountComposition(distDir: string, isEditor = false) {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'cm1082-composition-')))
  const env = { XDG_DATA_HOME: folder, LOCALAPPDATA: folder }
  const dataDir = agentDataFolder({ platform: process.platform, env, homeDir: folder })
  const secrets = memorySecrets()
  const services = createRuntimeAccountServices({ dataDir, secrets })
  const log = new FakeLogOutputChannel()
  const api = fakeModelApi({ keys: CURRENT_SHAPE_KEYS })
  api.models = [ACCOUNT_TEST_MODEL]
  api.script({ text: 'done', usage: { input: 10, output: 2 } })
  const command = async (args: string[]) => {
    const parsed = parseAccountsCommand(args)
    if (parsed === undefined) throw new Error('invalid fixture CLI arguments')
    return await runAccountsCommand(parsed, {
      ...services.commands,
      print: () => undefined,
      printError: (text) => {
        throw new Error(text)
      },
    })
  }
  await command(['add', '--provider', 'meta', '--account', 'work', '--label', 'B'])
  for (const [account, secret] of [
    ['default', CURRENT_SHAPE_KEYS[0]],
    ['work', CURRENT_SHAPE_KEYS[1]],
  ] as const) {
    await services.store.setCredential('meta', account, {
      v: 1,
      auth: 'apiKey',
      provider: 'meta',
      account,
      origin: new URL(MODEL_API_BASE_URL).origin,
      secret,
    })
  }
  let sessionId: string | undefined
  const notices: string[] = []
  const editor = createEditorAccountServices({
    dataDir,
    secrets,
    session: () => sessionId,
    settings: () => ({ isSwapOn: true, isParallelOn: true }),
    promptForApiKey: () => Promise.resolve(CURRENT_SHAPE_KEYS[1]),
    askPolicy: () => Promise.resolve('confirm'),
    notice: (_session, text) => {
      notices.push(text)
    },
  })
  const options = parseCommandLine([
    '--backend',
    'modelApi',
    '--trust-workspace',
    '--image-generation',
  ])
  if (options.command !== 'serve') throw new Error('missing fixture serve options')
  const runtime = services.exec.create(
    {
      options: options.options,
      version: 'test',
      distDir,
      platform: process.platform,
      env,
      homeDir: folder,
      secrets,
      runGit: () => Promise.reject(new Error('fixture workspace has no git')),
      fetch: api.fetch,
      sleep: () => Promise.resolve(),
      log,
    },
    { account: 'default', isInteractive: false, hasPoolFlag: true },
    createRuntimeBackend,
  ).runtime
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, log, {
      workspaceRoot: folder,
      bundlePath: 'modelApiEntry',
      loadBundle: () => modelApiEntry,
      getApiKey: () => Promise.resolve(CURRENT_SHAPE_KEYS[0]),
      createAccountRequests: editor.requests,
      createProviderClient: (meta) =>
        Promise.resolve(
          createConfiguredProviderServices(meta, {
            configFile: path.join(folder, 'panel-providers.json'),
            catalogFile: path.join(folder, 'catalog.json'),
            secrets,
          }).client,
        ),
      newId: () => randomUUID(),
      now: Date.now,
    }),
  )
  const host = isEditor ? await manager.ensureHost() : await runtime.backend.hostFor(folder)
  const session = await host.startSession({
    workspaceRoot: folder,
    modelId: ACCOUNT_TEST_MODEL,
    approvalMode: 'onRequest',
  })
  sessionId = session.sessionId
  const watched = watchSessionTurns(session)
  const send = async () => {
    const done = watched.turnDone()
    await session.sendTurn([{ type: 'text', text: 'hello' }])
    await done
  }
  const journal = new AccountRequestJournal(
    path.join(dataDir, ACCOUNT_REQUEST_STORE.directory),
    Date.now,
  )
  return {
    log,
    folder,
    dataDir,
    services,
    editor,
    runtime,
    manager,
    host,
    session,
    api,
    secrets,
    notices,
    command,
    send,
    events: watched.events,
    headers: () =>
      api.requests
        .filter((request) => request.path === '/responses')
        .map((request) => request.headers['Authorization'] ?? request.headers['authorization']),
    totals: (account: string) =>
      journal.read({ provider: 'meta', account, ...accountPeriodRange('day', Date.now()) }),
    dispose: async () => {
      await manager.dispose()
      await runtime.close()
      editor.dispose()
      services.dispose()
    },
    setSession: (value: string | undefined) => {
      sessionId = value
    },
  }
}
