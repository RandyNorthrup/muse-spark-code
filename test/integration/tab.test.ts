// Tab's quiet paths through the real provider and the real activation
// (M94 acceptance 1-5, 8, 13-15, 17-18): real documents in a real VS Code,
// the real engine with a stream that throws when called (a quiet path
// sends nothing), the real spend gate over a real ledger, the real keyed
// consent over an in-memory paid seam, real hooks over the committed
// fixtures, and the real lazy bundle required from the installed
// extension. Zero network: every path here quiets or finds no suggestion.
// Runs inside the Extension Development Host (see .vscode-test.mjs).
import * as assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'
import { createTabEngine, type TabStream } from '../../src/core/tab/tabEngine'
import { createTabHooks } from '../../src/core/tab/tabHooks'
import { requireFile } from '../../src/host/lazyBundle'
import type { Logger } from '../../src/host/logger'
import {
  createTabActivation,
  deferredRefresh,
  TAB_BUNDLE_FILE,
  TAB_COMMAND_IDS,
  type TabActivationDeps,
  type TabOutcome,
  type TabProviderDeps,
  type TabQuietReason,
} from '../../src/host/tab/tabBundle'
import type { TabConsentDeps, TabConsentScope } from '../../src/host/tab/tabConsent'
import { createTabByoResolutions } from '../../src/host/tab/tabByo'
import { createTabLedger } from '../../src/host/tab/tabLedger'
import { createTabProvider } from '../../src/host/tab/tabProvider'
import { createTabSpendGate } from '../../src/host/tab/tabSpendGate'
import { createTabStatusItem } from '../../src/host/tab/tabStatusItem'
import {
  EXTENSION_QUALIFIED_ID,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
} from '../../src/shared/constants'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import { fixtureHookRun } from '../unit/helpers/tabHookScripts'
import { queuedTabAsk, quietTabServices } from '../unit/helpers/tabQuietFixtures'
import { realGit } from '../unit/helpers/realGit'
import { removeFolder } from '../unit/helpers/temporaryFolders'

const MODEL = 'muse-spark-1.3'
const SECRET_LINE = 'const password = "hunter22";'

const silentLog: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/** The production answer for a Tab model, from its real policy. */
function recordMaxOutputTokens(model: string): number {
  return modelPolicyFor(model).output.maxTokens ?? MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS
}

/** A quiet path must never reach the stream: the send attempt throws. */
function quietPathSent(): never {
  throw new Error('a quiet path sent a request')
}

/** A stream that throws when called: a quiet path must never reach it. */
function throwingStream(): TabStream {
  return quietPathSent
}

/** A stream that answers nothing: the request finds no suggestion. */
async function* emptyStream(): AsyncIterable<never> {
  // No events: the reply is empty and reports no usage.
}

interface ProviderState {
  tabTrigger: 'automatic' | 'onInvoke'
  tabLanguages: Record<string, boolean>
  isPaidOn: boolean
  isKeyStored: boolean
  isTrusted: boolean
  snoozedUntil: number | undefined
  budgetUsd: UsdAmount
  isCopilotExtensionPresent: boolean
  copilotEnable: unknown
  disableAIFeatures: unknown
  answers: (TabConsentScope | undefined)[]
}

function stateOf(overrides: Partial<ProviderState> = {}): ProviderState {
  return {
    tabTrigger: 'automatic',
    tabLanguages: {},
    isPaidOn: true,
    isKeyStored: false,
    isTrusted: true,
    snoozedUntil: undefined,
    budgetUsd: Usd.from(10).toAmount(),
    isCopilotExtensionPresent: false,
    copilotEnable: undefined,
    disableAIFeatures: undefined,
    answers: [],
    ...overrides,
  }
}

interface ProviderWorld {
  provider: ReturnType<typeof createTabProvider>
  outcomes: TabOutcome[]
  asked: string[]
  warns: string[]
  sent: string[]
  dispose: () => void
}

/** The paid-on consent fixture, asking from the state's queued answers. */
function consentDepsOf(
  asked: string[],
  answers: (TabConsentScope | undefined)[],
  log: Logger,
): Omit<TabConsentDeps, 'priceOf'> {
  return {
    ask: queuedTabAsk(asked, answers),
    isOn: () => true,
    isRemembered: () => false,
    windowOnceToken: () => 'token-1',
    revocations: () => 0,
    readAlways: () => undefined,
    writeAlways: () => Promise.resolve(),
    log,
  }
}

function providerFor(
  root: string,
  spendRoot: string,
  windowId: string,
  state: ProviderState,
  stream: TabStream,
  hooks: TabProviderDeps['hooks'],
): ProviderWorld {
  const outcomes: TabOutcome[] = []
  const asked: string[] = []
  const warns: string[] = []
  const sent: string[] = []
  const log: Logger = {
    trace: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warns.push(message)
    },
    error: () => undefined,
  }
  const ledger = createTabLedger({
    directory: spendRoot,
    windowId,
    now: () => Date.now(),
    sleep: () => Promise.resolve(),
    log,
  })
  const spend = createTabSpendGate({
    ledger,
    budgetUsd: () => state.budgetUsd,
    now: () => Date.now(),
    onTotalChanged: () => undefined,
    log,
  })
  const engine = createTabEngine({
    stream,
    onSent: (model) => {
      sent.push(model)
    },
    onUsage: () => undefined,
  })
  const provider = createTabProvider({
    settings: () => ({
      tabModel: MODEL,
      tabMaxOutputTokens: 0,
      tabLanguages: state.tabLanguages,
      tabMultiline: 'auto',
      tabTrigger: state.tabTrigger,
      tabWithCopilot: 'yield',
    }),
    recordMaxOutputTokens,
    // This suite drives Meta tiers only; a bring-your-own reference never resolves here.
    byo: createTabByoResolutions(() =>
      Promise.reject(new Error('no bring-your-own model in this suite')),
    ),
    isPaidOn: () => state.isPaidOn,
    isKeyStored: () => state.isKeyStored,
    isTrusted: () => state.isTrusted,
    isSnoozed: () => (state.snoozedUntil ?? 0) > Date.now(),
    realPath: (absolutePath) => realpath(absolutePath),
    foreignSetting: (section) =>
      section === 'github.copilot' ? state.copilotEnable : state.disableAIFeatures,
    isCopilotExtensionPresent: () => state.isCopilotExtensionPresent,
    filesExclude: () => ({}),
    ignoreFileExists: (absolutePath) => existsSync(absolutePath),
    runGit: realGit,
    workspaceRoots: (absolutePath) =>
      path.relative(root, absolutePath).startsWith('..') ? [] : [root],
    onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
    onDidChangeTextDocument: (listener) => vscode.workspace.onDidChangeTextDocument(listener),
    engine,
    spend,
    consentDeps: consentDepsOf(asked, state.answers, log),
    hooks,
    onOutcome: (outcome) => {
      outcomes.push(outcome)
    },
    log,
  })
  return {
    provider,
    outcomes,
    asked,
    warns,
    sent,
    dispose: () => {
      provider.dispose()
    },
  }
}

function automaticContext(): vscode.InlineCompletionContext {
  return {
    triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
    selectedCompletionInfo: undefined,
  }
}

async function triggerQuiet(
  world: ProviderWorld,
  document: vscode.TextDocument,
  position: vscode.Position,
  context: vscode.InlineCompletionContext = automaticContext(),
  token?: vscode.CancellationToken,
): Promise<TabQuietReason> {
  const provide = async (effective: vscode.CancellationToken): Promise<void> => {
    const items = await world.provider.provider.provideInlineCompletionItems(
      document,
      position,
      context,
      effective,
    )
    assert.deepEqual(items, [])
  }
  if (token === undefined) {
    const source = new vscode.CancellationTokenSource()
    try {
      await provide(source.token)
    } finally {
      source.dispose()
    }
  } else {
    await provide(token)
  }
  assert.equal(world.outcomes.length, 1)
  const outcome = world.outcomes[0]
  if (outcome === undefined) throw new Error('the trigger gave no outcome')
  if (outcome.kind !== 'quiet') throw new Error('the trigger was not quiet')
  assert.deepEqual(world.sent, [])
  return outcome.reason
}

suite('Tab quiet paths in a real editor (M94)', () => {
  let root = ''
  let spendRoot = ''
  let outsideRoot = ''
  let fixturesDir = ''
  let worlds: ProviderWorld[] = []
  let hookDisposers: (() => void)[] = []
  let windowCount = 0

  suiteSetup(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-tab-int-'))
    spendRoot = await mkdtemp(path.join(tmpdir(), 'muse-tab-int-spend-'))
    outsideRoot = await mkdtemp(path.join(tmpdir(), 'muse-tab-int-outside-'))
    fixturesDir = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'tabHooks')
    await writeFile(path.join(root, 'a.ts'), 'const value = 1;\n', 'utf8')
    await writeFile(path.join(root, 'deploy.pem'), 'private', 'utf8')
    await writeFile(path.join(root, 'secret.ts'), `${SECRET_LINE}\n`, 'utf8')
    await writeFile(path.join(root, 'notes.txt'), 'plain\n', 'utf8')
    await writeFile(path.join(outsideRoot, 'b.ts'), 'const other = 2;\n', 'utf8')
  })

  suiteTeardown(async () => {
    for (const world of worlds) world.dispose()
    for (const dispose of hookDisposers) dispose()
    worlds = []
    hookDisposers = []
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await removeFolder(root)
    await removeFolder(spendRoot)
    await removeFolder(outsideRoot)
  })

  function worldFor(
    state: ProviderState,
    stream: TabStream = throwingStream(),
    hooks?: TabProviderDeps['hooks'],
  ): ProviderWorld {
    windowCount += 1
    const world = providerFor(root, spendRoot, `int-${String(windowCount)}`, state, stream, hooks)
    worlds.push(world)
    return world
  }

  async function documentAt(name: string, from: string = root): Promise<vscode.TextDocument> {
    return await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(from, name)))
  }

  function hookBridge(hookState: 'invalid' | 'reloading'): NonNullable<TabProviderDeps['hooks']> {
    const guard = createTabHooks({
      isWorkspaceTrusted: () => true,
      isHooksEnabled: () => true,
      configurationVersion: () => 'epoch-1',
      hookState: () => Promise.resolve(hookState),
      run: fixtureHookRun('allow', [], fixturesDir),
      log: () => undefined,
    })
    hookDisposers.push(() => {
      guard.dispose()
    })
    return {
      beforeRead: guard.beforeRead,
      afterEdit: () => undefined,
      bindPolicy: guard.bindPolicy,
      policyKey: guard.policyKey,
    }
  }

  test('a suggest selection stays quiet', async () => {
    const world = worldFor(stateOf())
    const document = await documentAt('a.ts')
    const reason = await triggerQuiet(world, document, new vscode.Position(0, 0), {
      triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
      selectedCompletionInfo: {
        range: new vscode.Range(0, 0, 0, 1),
        text: 'c',
      },
    })
    assert.equal(reason, 'suggest-selection')
  })

  test('an untitled document stays quiet', async () => {
    const world = worldFor(stateOf())
    const document = await vscode.workspace.openTextDocument({ content: 'const x = 1;\n' })
    const reason = await triggerQuiet(world, document, new vscode.Position(0, 0))
    assert.equal(reason, 'scheme')
  })

  test('a file outside every workspace folder stays quiet', async () => {
    const world = worldFor(stateOf({ isKeyStored: true }))
    const document = await documentAt('b.ts', outsideRoot)
    const reason = await triggerQuiet(world, document, new vscode.Position(0, 0))
    assert.equal(reason, 'outside-workspace')
  })

  test('an automatic trigger stays quiet on Invoke, and Invoke bypasses it', async () => {
    const gated = worldFor(stateOf({ tabTrigger: 'onInvoke' }))
    const document = await documentAt('a.ts')
    assert.equal(await triggerQuiet(gated, document, new vscode.Position(0, 0)), 'trigger-setting')
    const invoked = worldFor(stateOf({ tabTrigger: 'onInvoke' }))
    const reason = await triggerQuiet(invoked, document, new vscode.Position(0, 0), {
      triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
      selectedCompletionInfo: undefined,
    })
    assert.equal(reason, 'no-key')
  })

  test('a snoozed window stays quiet', async () => {
    const world = worldFor(stateOf({ isKeyStored: true, snoozedUntil: Date.now() + 600_000 }))
    const document = await documentAt('a.ts')
    assert.equal(await triggerQuiet(world, document, new vscode.Position(0, 0)), 'snoozed')
  })

  test('the gate, the key and the trust each stay quiet', async () => {
    const document = await documentAt('a.ts')
    const off = worldFor(stateOf({ isPaidOn: false }))
    assert.equal(await triggerQuiet(off, document, new vscode.Position(0, 0)), 'paid-off')
    const keyless = worldFor(stateOf())
    assert.equal(await triggerQuiet(keyless, document, new vscode.Position(0, 0)), 'no-key')
    const untrusted = worldFor(stateOf({ isKeyStored: true, isTrusted: false }))
    assert.equal(await triggerQuiet(untrusted, document, new vscode.Position(0, 0)), 'untrusted')
  })

  test('a switched-off language stays quiet', async () => {
    const document = await documentAt('notes.txt')
    const world = worldFor(
      stateOf({ isKeyStored: true, tabLanguages: { [document.languageId]: false } }),
    )
    assert.equal(await triggerQuiet(world, document, new vscode.Position(0, 0)), 'language-off')
  })

  test('Copilot on stays quiet while Tab yields', async () => {
    const world = worldFor(
      stateOf({ isKeyStored: true, isCopilotExtensionPresent: true, copilotEnable: {} }),
    )
    const document = await documentAt('a.ts')
    assert.equal(await triggerQuiet(world, document, new vscode.Position(0, 0)), 'copilot')
  })

  test('a private file stays quiet', async () => {
    const world = worldFor(stateOf({ isKeyStored: true }))
    const document = await documentAt('deploy.pem')
    assert.equal(await triggerQuiet(world, document, new vscode.Position(0, 0)), 'ineligible-file')
  })

  test('a denied question sends nothing', async () => {
    const world = worldFor(stateOf({ isKeyStored: true, answers: [undefined] }))
    const document = await documentAt('a.ts')
    assert.equal(await triggerQuiet(world, document, new vscode.Position(0, 0)), 'consent-denied')
    assert.deepEqual(world.asked, [MODEL])
  })

  test('the budget refuses before the send', async () => {
    const world = worldFor(
      stateOf({ isKeyStored: true, budgetUsd: Usd.from(0.01).toAmount(), answers: ['once'] }),
    )
    const document = await documentAt('a.ts')
    assert.equal(await triggerQuiet(world, document, new vscode.Position(0, 0)), 'budget')
    assert.deepEqual(world.asked, [MODEL])
  })

  test('an empty answer keeps its reservation standing', async () => {
    const world = worldFor(stateOf({ isKeyStored: true, answers: ['once'] }), emptyStream)
    const document = await documentAt('a.ts')
    assert.equal(await triggerQuiet(world, document, new vscode.Position(0, 0)), 'no-suggestion')
    assert.deepEqual(world.asked, [MODEL])
    assert.ok(world.warns.some((line) => line.includes('reported no usage')))
  })

  test('a secret at the cursor stays quiet, unasked', async () => {
    const world = worldFor(stateOf({ isKeyStored: true }))
    const document = await documentAt('secret.ts')
    const at = SECRET_LINE.indexOf('hunter22') + 3
    assert.equal(
      await triggerQuiet(world, document, new vscode.Position(0, at)),
      'secret-at-cursor',
    )
    assert.deepEqual(world.asked, [])
  })

  test('an invalid or reloading hook configuration stays quiet', async () => {
    const document = await documentAt('a.ts')
    const invalid = worldFor(
      stateOf({ isKeyStored: true }),
      throwingStream(),
      hookBridge('invalid'),
    )
    assert.equal(await triggerQuiet(invalid, document, new vscode.Position(0, 0)), 'hooks-invalid')
    const reloading = worldFor(
      stateOf({ isKeyStored: true }),
      throwingStream(),
      hookBridge('reloading'),
    )
    assert.equal(
      await triggerQuiet(reloading, document, new vscode.Position(0, 0)),
      'policy-changed',
    )
  })

  test('a cancelled trigger sends nothing', async () => {
    const world = worldFor(stateOf({ isKeyStored: true, answers: ['once'] }))
    const document = await documentAt('a.ts')
    const source = new vscode.CancellationTokenSource()
    source.cancel()
    try {
      assert.equal(
        await triggerQuiet(
          world,
          document,
          new vscode.Position(0, 0),
          automaticContext(),
          source.token,
        ),
        'cancelled-before-send',
      )
    } finally {
      source.dispose()
    }
  })

  test('foreign accepts are ignored', () => {
    const world = worldFor(stateOf({ isKeyStored: true }))
    world.provider.acceptNotified({ foreign: true })
    world.provider.acceptNotified({
      filePath: path.join(root, 'a.ts'),
      generationId: 'unknown',
      model: MODEL,
      positionLine: 0,
      positionCharacter: 0,
      completion: 'const value = 1;',
    })
    assert.deepEqual(world.outcomes, [])
  })
})

suite('Tab activation in a real editor (M94)', () => {
  let root = ''
  let spendRoot = ''

  suiteSetup(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-tab-int-activation-'))
    spendRoot = await mkdtemp(path.join(tmpdir(), 'muse-tab-int-activation-spend-'))
    await writeFile(path.join(root, 'a.ts'), 'const value = 1;\n', 'utf8')
  })

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await removeFolder(root)
    await removeFolder(spendRoot)
  })

  test('the product registers its Tab commands on activation', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, 'the extension under test is installed')
    await extension.activate()
    const commands = await vscode.commands.getCommands(true)
    for (const id of [
      TAB_COMMAND_IDS.turnOn,
      TAB_COMMAND_IDS.turnOff,
      TAB_COMMAND_IDS.snooze,
      TAB_COMMAND_IDS.menu,
      TAB_COMMAND_IDS.languages,
      TAB_COMMAND_IDS.afterAccept,
    ]) {
      assert.ok(commands.includes(id), `Tab command registered: ${id}`)
    }
  })

  test('arms at once, loads the real bundle on the first request, tears down', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, 'the extension under test is installed')
    await extension.activate()
    const bundlePath = path.join(extension.extensionUri.fsPath, 'dist', TAB_BUNDLE_FILE)
    assert.ok(existsSync(bundlePath), 'the dev build wrote dist/tab.js')

    const state = {
      isOn: false,
      isKeyStored: false,
      loads: [] as string[],
      keyReads: 0,
      registrations: 0,
      answers: [] as (TabConsentScope | undefined)[],
      asked: [] as string[],
      captured: undefined as vscode.InlineCompletionItemProvider | undefined,
    }
    const snoozeStore = { end: undefined as number | undefined }
    const ensureKeyPresence = deferredRefresh(() => {
      state.keyReads += 1
    })
    const deps: TabActivationDeps = {
      bundlePath,
      log: silentLog,
      loadBundle: (file) => {
        state.loads.push(file)
        return requireFile(file)
      },
      isTabSettingOn: () => state.isOn,
      tabSettings: () => ({
        tabModel: MODEL,
        tabMaxOutputTokens: 0,
        tabLanguages: {},
        tabMultiline: 'auto',
        tabTrigger: 'automatic',
        tabWithCopilot: 'yield',
        tabDailyBudgetUsd: Usd.from(10).toAmount(),
      }),
      isPaidOn: () => true,
      isKeyStored: () => state.isKeyStored,
      isTrusted: () => true,
      ensureKeyPresence,
      updateSetting: () => Promise.resolve(),
      registerCommand: (id, run) =>
        vscode.commands.registerCommand(`intTabTest.${id}`, (...args: unknown[]) => run(...args)),
      realPath: (absolutePath) => realpath(absolutePath),
      foreignSetting: () => undefined,
      isCopilotExtensionPresent: () => false,
      filesExclude: () => ({}),
      registerProvider: (provider) => {
        state.registrations += 1
        state.captured = provider
        const registration = vscode.languages.registerInlineCompletionItemProvider(
          { scheme: 'file' },
          provider,
        )
        return {
          dispose: () => {
            registration.dispose()
          },
        }
      },
      setTabOnContext: () => undefined,
      workspaceRoots: (absolutePath) =>
        path.relative(root, absolutePath).startsWith('..') ? [] : [root],
      ignoreFileExists: (absolutePath) => existsSync(absolutePath),
      runGit: realGit,
      onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
      onDidChangeTextDocument: (listener) => vscode.workspace.onDidChangeTextDocument(listener),
      activeLanguageId: () => vscode.window.activeTextEditor?.document.languageId,
      ...quietTabServices(),
      snoozeStore: {
        readSnoozedUntil: () => snoozeStore.end,
        writeSnoozedUntil: (endMs) => {
          snoozeStore.end = endMs
          return Promise.resolve()
        },
        nowMs: () => Date.now(),
      },
      services: {
        stream: throwingStream(),
        resolveByo: () => Promise.reject(new Error('no bring-your-own model in this suite')),
        recordMaxOutputTokens,
        ledgerDirectory: spendRoot,
        windowId: 'int-tab-activation',
        onSent: () => undefined,
        onUsage: () => undefined,
      },
      consentDeps: consentDepsOf(state.asked, state.answers, silentLog),
      createStatus: (statusDeps, showMenu) => createTabStatusItem(statusDeps, showMenu),
      notifyBudgetReached: () => undefined,
    }
    const tab = createTabActivation(deps)
    try {
      // Off: commands only, no registration, no load, no key read.
      tab.refresh()
      assert.equal(tab.isRegistered(), false)
      assert.deepEqual(state.loads, [])
      assert.equal(state.keyReads, 0)
      const scoped = await vscode.commands.getCommands(true)
      assert.ok(scoped.includes(`intTabTest.${TAB_COMMAND_IDS.snooze}`))

      // On: registered at once, still loading nothing.
      state.isOn = true
      tab.refresh()
      assert.equal(tab.isRegistered(), true)
      assert.equal(state.registrations, 1)
      assert.deepEqual(state.loads, [])
      assert.equal(state.keyReads, 0)
      assert.ok(state.captured, 'the delegating provider registered')

      // The first request loads the real bundle, reads the key first, and
      // quiets on the missing key without asking or sending anything.
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(path.join(root, 'a.ts')),
      )
      const provide = async (): Promise<void> => {
        if (state.captured === undefined) throw new Error('no provider captured')
        const source = new vscode.CancellationTokenSource()
        try {
          const items = await state.captured.provideInlineCompletionItems(
            document,
            new vscode.Position(0, 0),
            automaticContext(),
            source.token,
          )
          assert.deepEqual(items, [])
        } finally {
          source.dispose()
        }
      }
      await provide()
      assert.deepEqual(state.loads, [bundlePath])
      assert.equal(state.keyReads, 1)
      assert.deepEqual(state.asked, [])

      // With a key, a denied question sends nothing; the denial snoozes
      // the window, so the next trigger stops before the question.
      state.isKeyStored = true
      state.answers.push(undefined)
      await provide()
      assert.deepEqual(state.asked, [MODEL])
      await provide()
      assert.deepEqual(state.asked, [MODEL])
      // One load and one key read across all three requests.
      assert.deepEqual(state.loads, [bundlePath])
      assert.equal(state.keyReads, 1)

      // Off again: the registration and the status tear down.
      state.isOn = false
      tab.refresh()
      assert.equal(tab.isRegistered(), false)
      assert.equal(tab.isActive(), false)
    } finally {
      tab.dispose()
    }
  })
})
