import { loadUiTable } from '../../src/host/l10n'
import { readFileSync } from 'node:fs'
import { UI_TEXT, GLOBAL_STATE_KEYS } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import { fakeManagerDeps } from '../unit/helpers/modelApiManager'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import { Usd } from '../../src/shared/usd'
import type { PaidUseRequest } from '../../src/shared/paid'
import * as acp from '@agentclientprotocol/sdk'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ACCOUNT_REQUEST_CERTIFICATION, ACP_CONFIG_IDS } from '../../src/shared/constants'
import { createAcpAgent } from '../../src/acp/agent'
import { createModelsPanelFeatures } from '../../src/host/models/modelsPanelEntry'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { modelAccountsMessageSchema } from '../../src/shared/modelAccountsProtocol'
import {
  accountComposition,
  ACCOUNT_TEST_KEYS,
  watchSessionTurns,
} from '../unit/helpers/accountComposition'
import { buildModelApiBundle } from '../unit/helpers/modelApiBundle'
import { removeFolder } from '../unit/helpers/temporaryFolders'
import { EventEmitter, FakeUri, window } from '../unit/mocks/vscode'
import type * as vscode from 'vscode'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { vi } from 'vitest'

/** Test-only VS Code state for the paid-features rig. */
function memento(data: Map<string, unknown>) {
  return {
    keys: () => Array.from(data, ([key]) => key),
    get: (key: string) => data.get(key),
    update: (key: string, value: unknown) => {
      data.set(key, value)
      return Promise.resolve()
    },
  }
}

/** A modal item's label: a plain string, or a `MessageItem`'s title. */
function titleOf(item: unknown): string {
  return typeof item === 'string' ? item : (item as vscode.MessageItem).title
}

/** Answers the next paid popup with the button titled `title`, or closes it. */
function answerWith(title: string | undefined): void {
  vi.mocked(window.showWarningMessage).mockImplementationOnce(
    (_message: string, _options: vscode.MessageOptions, ...items: vscode.MessageItem[]) =>
      Promise.resolve(items.find((item) => titleOf(item) === title)),
  )
}

/** The Models panel's test surface: posts into `messages`, reads `postMessage`. */
class CompositionWebviewPanel implements vscode.WebviewPanel {
  private readonly incoming = new EventEmitter<unknown>()
  private readonly disposed = new EventEmitter<void>()
  private readonly viewStateChanges =
    new EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>()
  public readonly webview: vscode.Webview & {
    readonly messages: EventEmitter<unknown>
    readonly postMessage: ReturnType<typeof vi.fn>
  } = {
    options: {},
    html: '',
    cspSource: 'vscode-webview://fake',
    messages: this.incoming,
    onDidReceiveMessage: this.incoming.event,
    postMessage: vi.fn((_message: unknown): Thenable<boolean> => Promise.resolve(true)),
    asWebviewUri: (localResource: vscode.Uri) => new FakeUri(`webview${localResource.path}`),
  }
  public readonly options: vscode.WebviewPanelOptions = {}
  public viewColumn: vscode.ViewColumn | undefined = undefined
  public active = true
  public visible = true
  public readonly onDidDispose = this.disposed.event
  public readonly onDidChangeViewState = this.viewStateChanges.event
  public readonly reveal = vi.fn((): void => {
    this.visible = true
  })

  public constructor(
    public readonly viewType: string,
    public title: string,
  ) {}

  public dispose(): void {
    this.disposed.fire()
  }
}

const rigs: Awaited<ReturnType<typeof accountComposition>>[] = []
const dist = { folder: '' }
beforeAll(async () => {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = true
  dist.folder = mkdtempSync(path.join(tmpdir(), 'cm1082-dist-'))
  await buildModelApiBundle(dist.folder)
})
afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    await rig.dispose()
    await removeFolder(rig.folder)
  }
  setUiText(EN, 'en')
})
afterAll(async () => {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
  await removeFolder(dist.folder)
})
async function rig(isEditor = false) {
  const t = await accountComposition(dist.folder, isEditor)
  rigs.push(t)
  return t
}

async function heldRequest(t: Awaited<ReturnType<typeof rig>>) {
  const { arrived, release } = holdReply(t)
  const pending = t.send()
  await arrived.promise
  return { pending, release }
}
function claimsStayOnA(t: Awaited<ReturnType<typeof rig>>) {
  expect(t.headers()).toEqual([`Bearer ${ACCOUNT_TEST_KEYS[0]}`, `Bearer ${ACCOUNT_TEST_KEYS[1]}`])
  expect(t.totals('default')).toMatchObject({ requests: 1, reservedUsd: '0', uncertainUsd: '0' })
  expect(t.totals('work')).toMatchObject({ requests: 1, reservedUsd: '0', uncertainUsd: '0' })
  expect(Number(t.totals('default').settledUsd)).toBeGreaterThan(0)
}

describe('production account composition', () => {
  it('VS Code Models panel queues an in-flight switch; original payer settles and next request uses B', async () => {
    const t = await rig(true)
    const panel = new CompositionWebviewPanel('models', 'Models')
    window.createWebviewPanel.mockReturnValue(panel)
    const features = createModelsPanelFeatures(
      {
        accounts: t.editor,
        secrets: t.secrets,
        extensionUri: new FakeUri(t.folder),
        l10n: { table: EN, locale: 'en' },
        log: t.log,
        globalState: { get: () => undefined, update: () => Promise.resolve() },
        suggestedProviderSetting: () => '',
        isRemote: false,
        setComposerModel: () => Promise.resolve(),
      },
      createModelsPanelSeam({
        configFile: path.join(t.folder, 'panel-providers.json'),
        subscriptionModels: () => Promise.resolve([]),
      }),
    )
    features.openPanel()
    const held = await heldRequest(t)
    panel.webview.messages.fire({
      type: 'modelAccounts/request',
      requestId: 1,
      request: { type: 'accounts/use', provider: 'meta', account: 'work' },
    })
    await vi.waitFor(() => {
      expect(
        panel.webview.postMessage.mock.calls.some(([value]) => {
          const parsed = modelAccountsMessageSchema.safeParse(value)
          return (
            parsed.success &&
            parsed.data.type === 'modelAccounts/reply' &&
            'currentAccount' in parsed.data.value &&
            parsed.data.value.currentAccount === 'work'
          )
        }),
      ).toBe(true)
    })
    expect(t.totals('default').reservedUsd).not.toBe('0')
    expect(t.totals('work').requests).toBe(0)
    held.release.resolve(undefined)
    await held.pending
    await t.send()
    claimsStayOnA(t)
    panel.dispose()
  })

  it('CLI thresholds hand next request to B with a translated notice; held pool never launches', async () => {
    await loadUiTable({
      language: 'fr',
      readExtensionFile: (segments) =>
        Promise.resolve(readFileSync(path.join(process.cwd(), ...segments), 'utf8')),
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })
    const t = await rig()
    await t.command([
      'thresholds',
      '--provider',
      'meta',
      '--account',
      'default',
      '--thresholds',
      '{"requests":{"day":1}}',
    ])
    const notices: string[] = []
    const { AcpAccounts } = await import('../../src/acp/accounts')
    const observer = new AcpAccounts(
      t.session.sessionId,
      t.services.sessions('meta'),
      () => undefined,
      (text) => {
        notices.push(text)
      },
    )
    await observer.start()
    await t.send()
    await t.send()
    claimsStayOnA(t)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('B')
    expect(notices[0]).toContain(
      fill(UI_TEXT.accounts.swapNotice, {
        provider: 'meta',
        account: 'B',
        previous: UI_TEXT.accounts.defaultLabel,
        threshold: 'requests: 1 (day)',
      }),
    )
    expect(UI_TEXT.accounts.swapNotice).not.toBe(EN.accounts.swapNotice)
    t.services.hold(true)
    await t.send()
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      type: 'turnCompleted',
      terminal: 'failed',
    })
    expect(t.headers()).toHaveLength(2)
    observer.dispose()
  })

  it('VS Code paid worker re-asks for B once, never inherits A consent, and dispatches through the real manager', async () => {
    const t = await rig(true)
    vi.mocked(window.showWarningMessage).mockReset()
    const paid = createPaidFeatures({
      globalState: memento(new Map([[GLOBAL_STATE_KEYS.paidConfirmations, ['bestOfN']]])),
      workspaceState: memento(new Map()),
      isSettingOn: (feature) => feature === 'bestOfN',
      isKeyStored: () => true,
      canRememberPaidUse: () => true,
      dailyBudgetUsd: () => Usd.from(1).toAmount(),
      accountPaid: { billing: t.editor.billing, folder: path.join(t.folder, 'paid') },
      log: t.log,
    })
    const question: PaidUseRequest = {
      feature: 'bestOfN',
      modelId: 'muse-spark-1.3',
      prompt: 'hello',
      attempts: 2,
      requestCeilingPerAttempt: 1,
    }
    answerWith(UI_TEXT.paidAllowAlways)
    expect(await paid.consent.allows(question)).toBe(true)
    expect(await paid.consent.allows(question)).toBe(true)
    expect(window.showWarningMessage).toHaveBeenCalledOnce()
    await t.command([
      'thresholds',
      '--provider',
      'meta',
      '--account',
      'default',
      '--thresholds',
      '{"requests":{"day":0}}',
    ])
    answerWith(UI_TEXT.paidAllowAlways)
    const manager = new ModelApiBackendManager(
      fakeManagerDeps(t.api, t.log, {
        workspaceRoot: t.folder,
        bundlePath: 'source',
        loadBundle: () => modelApiEntry,
        newId: () => crypto.randomUUID(),
        now: Date.now,
        getApiKey: () => Promise.resolve(ACCOUNT_TEST_KEYS[0]),
        createAccountRequests: t.editor.requests,
        allowsPaidUse: (request, requiresAsking) => paid.consent.allows(request, requiresAsking),
      }),
    )
    const host = await manager.buildAttemptHost(
      t.folder,
      Object.assign(() => undefined, { paidRequest: question }),
    )
    try {
      const session = await host.startSession({
        workspaceRoot: t.folder,
        modelId: 'muse-spark-1.3',
        approvalMode: 'onRequest',
      })
      const watched = watchSessionTurns(session)
      for (let n = 0; n < 2; n += 1) {
        const done = watched.turnDone()
        await session.sendTurn([{ type: 'text', text: 'hello' }])
        await done
        expect(watched.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
          terminal: 'completed',
        })
      }
      expect(window.showWarningMessage).toHaveBeenCalledTimes(2)
      expect(t.headers()).toEqual([
        `Bearer ${ACCOUNT_TEST_KEYS[1]}`,
        `Bearer ${ACCOUNT_TEST_KEYS[1]}`,
      ])
      expect(t.totals('work').requests).toBe(2)
    } finally {
      await host.close()
      await manager.dispose()
    }
  })

  it('ACP config selection during a live prompt keeps A settlement and chooses B at next request', async () => {
    const t = await rig()
    const updates: acp.SessionUpdate[] = []
    const agent = createAcpAgent({
      questions: 'decline',
      backend: t.runtime.backend,
      paid: t.runtime.paid,
      accounts: t.services.sessions('meta'),
      version: 'test',
      defaultCwd: t.folder,
      options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
      signIn: {
        id: 'key',
        name: 'Fixture key',
        description: 'Fixture',
        args: [],
        command: 'fixture',
      },
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })
    const client = acp
      .client({ name: 'account-editor' })
      .onNotification('session/update', ({ params }) => {
        updates.push(params.update)
      })
    await client.connectWith(agent, async (connection) => {
      await connection.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const { sessionId } = await connection.request('session/new', {
        cwd: t.folder,
        mcpServers: [],
      })
      const { arrived, release } = holdReply(t)
      const send = () =>
        connection.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: 'hello' }],
        })
      const pending = send()
      await arrived.promise
      await connection.request('session/set_config_option', {
        sessionId,
        configId: ACP_CONFIG_IDS.account,
        value: 'work',
      })
      release.resolve(undefined)
      await pending
      await send()
      claimsStayOnA(t)
      await t.command([
        'thresholds',
        '--provider',
        'meta',
        '--account',
        'default',
        '--thresholds',
        '{"requests":{"day":1}}',
      ])
      await connection.request('session/set_config_option', {
        sessionId,
        configId: ACP_CONFIG_IDS.account,
        value: 'default',
      })
      await send()
      expect(t.headers()).toHaveLength(3)
      expect(
        updates.some(
          (update) =>
            update.sessionUpdate === 'agent_message_chunk' &&
            update.content.type === 'text' &&
            update.content.text.includes('B'),
        ),
      ).toBe(true)
      t.services.hold(true)
      await expect(send()).rejects.toThrow()
      expect(t.headers()).toHaveLength(3)
      expect(updates.length).toBeGreaterThan(0)
    })
  })
})

function holdReply(t: Awaited<ReturnType<typeof rig>>) {
  const arrived = Promise.withResolvers<undefined>(),
    release = Promise.withResolvers<undefined>()
  t.api.script({
    text: 'held',
    hold: release.promise,
    onRequest: () => {
      arrived.resolve(undefined)
    },
    usage: { input: 10, output: 2 },
  })
  return { arrived, release }
}
