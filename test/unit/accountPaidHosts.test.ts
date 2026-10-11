import { fakeRuntimeBackendDeps } from './helpers/runtimeBackend'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import { AcpPaidUse, type PaidUseAsker } from '../../src/acp/paid'
import {
  createAccountPaidService,
  paidUseTariff,
  vsCodeAccountPaid,
} from '../../src/host/paid/accountPaidEntry'
import type { PaidBilling } from '../../src/core/paid/accountPaidRoute'
import type { PaidUseAnswer } from '../../src/core/paid/paidConsent'
import {
  ACCOUNT_DEFAULT_ID,
  ACCOUNT_PAID_STORE,
  GLOBAL_STATE_KEYS,
  RUNTIME_SETTINGS_FILE,
  UI_TEXT,
  WORKSPACE_STATE_KEYS,
} from '../../src/shared/constants'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { agentDataFolder, workspaceKey } from '../../src/runtime/dataFolder'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memento } from './helpers/memento'
import { memoryPaidGrants } from './helpers/paidGrants'
import { confirmModal } from './helpers/vscodeViews'
import { answerWith, titleOf } from './helpers/paidModal'
import { mockJudgePaidConfiguration } from './helpers/judgePaidConfiguration'
import { quotedSearch } from './helpers/paidQuote'
import { window, workspace } from './mocks/vscode'

// M108 lane P: the production callers. VS Code's paid features and the ACP
// agent's paid use route a use billed to another account to that account's
// consent (dist/accountPaid.js); the default account keeps today's consent.

vi.mock('../../src/host/paid/accountPaidEntry', { spy: true })

const IMAGE = {
  feature: 'imageGeneration',
  kind: 'generate',
  path: 'art.png',
  sources: [],
  prompt: 'A tree',
} as const
const WORK: PaidBilling = { provider: 'meta', account: 'work' }
const DEFAULT: PaidBilling = { provider: 'meta', account: ACCOUNT_DEFAULT_ID }
const modal: (
  title: string,
  options: vscode.MessageOptions,
  ...items: vscode.MessageItem[]
) => Thenable<vscode.MessageItem | undefined> = window.showWarningMessage

const folders: string[] = []
beforeEach(() => {
  setUiText(EN, 'en')
  window.state.focused = true
  vi.mocked(confirmModal).mockReset()
  vi.mocked(createAccountPaidService).mockClear()
  vi.mocked(vsCodeAccountPaid).mockClear()
  vi.mocked(workspace.getConfiguration).mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function temporaryFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'm108p-account-hosts-'))
  folders.push(folder)
  return folder
}

/** The detail of the modal `showWarningMessage` call number `index`. */
function modalDetail(index: number): string {
  const call: unknown[] = vi.mocked(confirmModal).mock.calls[index] ?? []
  return (call[1] as vscode.MessageOptions | undefined)?.detail ?? ''
}

/** One window's paid features, sharing the workspace state and account folder given. */
function vsCodeWindow(
  billing: { value: PaidBilling },
  stores: { global: Map<string, unknown>; workspace: Map<string, unknown>; folder: string },
  budget?: { readonly value: number },
) {
  return createPaidFeatures({
    globalState: memento(stores.global),
    workspaceState: memento(stores.workspace),
    isSettingOn: (feature) => feature === 'imageGeneration',
    isKeyStored: () => true,
    canRememberPaidUse: () => true,
    dailyBudgetUsd: () => Usd.from(budget?.value ?? 5).toAmount(),
    accountPaid: { billing: () => billing.value, folder: stores.folder },
    log: new FakeLogOutputChannel(),
  })
}

function vsCodeStores() {
  return {
    global: new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['imageGeneration']]]),
    workspace: new Map<string, unknown>(),
    folder: temporaryFolder(),
  }
}

/** Budget provenance at the editor boundary, independent of its effective daily cap. */
function mockBudgetScope(scope: string) {
  const budget = { value: 5 }
  mockJudgePaidConfiguration(5)
  const inspect = vi.spyOn(workspace.getConfiguration(), 'inspect')
  inspect.mockReturnValue({ key: 'museSpark.paidDailyBudgetUsd', [scope]: budget.value })
  return { budget, inspect }
}

describe('M108 lane P in VS Code (createPaidFeatures)', () => {
  it('keeps a single-account user’s popup and grants exactly as before, never loading dist/accountPaid.js', async () => {
    const stores = vsCodeStores()
    const paid = vsCodeWindow({ value: DEFAULT }, stores)
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(paid.consent.allows(IMAGE)).resolves.toBe(true)
    await expect(paid.consent.allows(IMAGE)).resolves.toBe(true)
    expect(confirmModal).toHaveBeenCalledOnce()
    // The workspace grant, as today; the account consent stays unloaded and unwritten.
    expect(stores.workspace.get(WORKSPACE_STATE_KEYS.paidWorkspaceGrants)).toEqual({
      imageGeneration: 0,
    })
    expect(modalDetail(0)).not.toContain('meta · ')
    expect(vsCodeAccountPaid).not.toHaveBeenCalled()
    expect(readdirSync(stores.folder)).toEqual([])
  })

  it('asks once for another account, naming it, its tariff and the shared budget, and keeps it per account', async () => {
    const stores = vsCodeStores()
    const billing = { value: WORK }
    const paid = vsCodeWindow(billing, stores)
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(paid.consent.allows(IMAGE)).resolves.toBe(true)
    expect(vsCodeAccountPaid).toHaveBeenCalledOnce()
    const detail = modalDetail(0)
    expect(detail).toContain('meta · work')
    expect(detail).toContain(paidUseTariff(IMAGE).price)
    expect(detail).toContain('Shared daily budget: $5.00')
    // The workspace consent's own grant was not touched by another account's Always.
    expect(stores.workspace.get(WORKSPACE_STATE_KEYS.paidWorkspaceGrants)).toBeUndefined()
    // A restart (a new window on the same storage) reuses the account's Always.
    await expect(vsCodeWindow(billing, stores).consent.allows(IMAGE)).resolves.toBe(true)
    expect(confirmModal).toHaveBeenCalledOnce()
    // The default account never inherits it.
    answerWith(undefined)
    await expect(vsCodeWindow({ value: DEFAULT }, stores).consent.allows(IMAGE)).resolves.toBe(
      false,
    )
    expect(confirmModal).toHaveBeenCalledTimes(2)
  })

  it('takes an account’s Always back with Account & usage’s Ask again', async () => {
    const stores = vsCodeStores()
    const paid = vsCodeWindow({ value: WORK }, stores)
    answerWith(UI_TEXT.paidAllowAlways)
    await expect(paid.consent.allows(IMAGE)).resolves.toBe(true)
    await paid.consent.forget()
    answerWith(undefined)
    await expect(paid.consent.allows(IMAGE)).resolves.toBe(false)
    answerWith(undefined)
    await expect(vsCodeWindow({ value: WORK }, stores).consent.allows(IMAGE)).resolves.toBe(false)
    expect(confirmModal).toHaveBeenCalledTimes(3)
  })

  it('ends A’s account Once when B forgets without loading account consent', async () => {
    const stores = vsCodeStores()
    const a = vsCodeWindow({ value: WORK }, stores)
    const b = vsCodeWindow({ value: WORK }, stores)
    answerWith(UI_TEXT.allowOnce)
    await expect(a.consent.allows(IMAGE)).resolves.toBe(true)
    await b.consent.forget()
    expect(vsCodeAccountPaid).toHaveBeenCalledOnce()
    answerWith(undefined)
    await expect(a.consent.allows(IMAGE)).resolves.toBe(false)
    expect(confirmModal).toHaveBeenCalledTimes(2)
  })

  it.each(['once', 'always'] as const)(
    'refuses a held %s after another unloaded window forgets, without caching or persisting it',
    async (choice) => {
      const stores = vsCodeStores()
      const a = vsCodeWindow({ value: WORK }, stores)
      const b = vsCodeWindow({ value: WORK }, stores)
      const opened = Promise.withResolvers<undefined>()
      const answer = Promise.withResolvers<undefined>()
      vi.mocked(modal).mockImplementationOnce(async (_title, _options, ...items) => {
        opened.resolve(undefined)
        await answer.promise
        return items.find(
          (item) =>
            titleOf(item) === (choice === 'once' ? UI_TEXT.allowOnce : UI_TEXT.paidAllowAlways),
        )
      })
      const held = a.consent.allows(IMAGE)
      await opened.promise
      await b.consent.forget()
      answer.resolve(undefined)
      await expect(held).resolves.toBe(false)
      expect(readdirSync(stores.folder)).toEqual([])
      answerWith(undefined)
      await expect(a.consent.allows(IMAGE)).resolves.toBe(false)
      answerWith(undefined)
      await expect(vsCodeWindow({ value: WORK }, stores).consent.allows(IMAGE)).resolves.toBe(false)
      expect(confirmModal).toHaveBeenCalledTimes(3)
    },
  )

  it('ends an account Once when another window changes price acceptance', async () => {
    const stores = vsCodeStores()
    const a = vsCodeWindow({ value: WORK }, stores)
    answerWith(UI_TEXT.allowOnce)
    await expect(a.consent.allows(IMAGE)).resolves.toBe(true)
    stores.global.set(GLOBAL_STATE_KEYS.paidGrantGenerations, { imageGeneration: 1 })
    answerWith(undefined)
    await expect(a.consent.allows(IMAGE)).resolves.toBe(false)
    expect(confirmModal).toHaveBeenCalledTimes(2)
  })

  it.each([
    { scope: 'globalValue', keepsAlways: true },
    { scope: 'workspaceValue', keepsAlways: false },
    { scope: 'workspaceFolderValue', keepsAlways: false },
    { scope: 'workspaceLanguageValue', keepsAlways: false },
    { scope: 'workspaceFolderLanguageValue', keepsAlways: false },
  ] as const)(
    'keeps account Always=$keepsAlways after a changed budget from $scope, including restart',
    async ({ scope, keepsAlways }) => {
      const stores = vsCodeStores()
      const { budget, inspect } = mockBudgetScope(scope)
      const paid = vsCodeWindow({ value: WORK }, stores, budget)
      answerWith(UI_TEXT.paidAllowAlways)
      await expect(paid.consent.allows(IMAGE)).resolves.toBe(true)
      budget.value = 7
      inspect.mockReturnValue({ key: 'museSpark.paidDailyBudgetUsd', [scope]: 7 })
      answerWith(undefined)
      await expect(paid.consent.allows(IMAGE)).resolves.toBe(keepsAlways)
      if (!keepsAlways) expect(modalDetail(1)).toContain('Shared daily budget: $7.00')
      answerWith(undefined)
      await expect(
        vsCodeWindow({ value: WORK }, stores, budget).consent.allows(IMAGE),
      ).resolves.toBe(keepsAlways)
      expect(confirmModal).toHaveBeenCalledTimes(keepsAlways ? 1 : 3)
    },
  )
})

/** One ACP agent's paid use, billing `billing` and keeping account consent under `folder`. */
function agent(billing: { value: PaidBilling }, folder: string, grants = memoryPaidGrants()) {
  const paid = new AcpPaidUse({
    flagged: ['imageGeneration'],
    canRemember: () => true,
    grants,
    log: new FakeLogOutputChannel(),
    billing: () => billing.value,
    accountFolder: (workspaceRoot) => path.join(folder, path.basename(workspaceRoot)),
    dailyBudgetUsd: () => Usd.from(5).toAmount(),
    sleep: () => Promise.resolve(),
  })
  const ask = vi.fn<PaidUseAsker>(() => Promise.resolve<PaidUseAnswer>('always'))
  paid.attach(ask)
  return { paid, ask, grants }
}

describe('M108 lane P in the ACP agent (AcpPaidUse)', () => {
  it('captures the prepared first search generation before asking, allowing its current answer', async () => {
    const folder = temporaryFolder()
    let generation = 'missing'
    const paid = new AcpPaidUse({
      flagged: ['webSearch'],
      canRemember: () => true,
      grants: {
        ...memoryPaidGrants(),
        quoteGeneration: () => generation,
        prepareQuoteGeneration: () => {
          generation = 'initialized'
          return Promise.resolve(generation)
        },
      },
      log: new FakeLogOutputChannel(),
      billing: () => WORK,
      accountFolder: () => folder,
      dailyBudgetUsd: () => Usd.from(5).toAmount(),
    })
    const ask = vi.fn<PaidUseAsker>(() => Promise.resolve<PaidUseAnswer>('always'))
    paid.attach(ask)
    const search = quotedSearch('0.0025', 'muse-spark-1.3')
    await expect(paid.allows('/ws/app', 'session', search, false)).resolves.toEqual(search.quote)
    await expect(paid.allows('/ws/app', 'session', search, false)).resolves.toEqual(search.quote)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('asks a default-account use exactly as before, with no account line', async () => {
    const t = agent({ value: DEFAULT }, temporaryFolder())
    await expect(t.paid.allows('/ws/app', 'session', IMAGE, false)).resolves.toBe(true)
    expect(t.ask).toHaveBeenCalledExactlyOnceWith('session', IMAGE, true)
    expect(createAccountPaidService).not.toHaveBeenCalled()
  })

  it('asks another account’s use in its own session with the account line, and keeps it per account', async () => {
    const folder = temporaryFolder()
    const billing = { value: WORK }
    const grants = memoryPaidGrants()
    const t = agent(billing, folder, grants)
    await expect(t.paid.allows('/ws/app', 'session', IMAGE, false)).resolves.toBe(true)
    expect(t.ask).toHaveBeenCalledOnce()
    const [session, request, canRemember, line] = t.ask.mock.calls[0] ?? []
    expect([session, request, canRemember]).toEqual(['session', IMAGE, true])
    expect(line).toContain('meta · work')
    expect(line).toContain('Shared daily budget: $5.00')
    // The folder's default-account grants are untouched.
    expect(grants.read('/ws/app').size).toBe(0)
    // A restarted agent on the same data folder reuses the account's Always.
    const restarted = agent(billing, folder, grants)
    await expect(restarted.paid.allows('/ws/app', 'other', IMAGE, false)).resolves.toBe(true)
    expect(restarted.ask).not.toHaveBeenCalled()
    // The default account asks for itself.
    const fallback = agent({ value: DEFAULT }, folder, grants)
    await expect(fallback.paid.allows('/ws/app', 'other', IMAGE, false)).resolves.toBe(true)
    expect(fallback.ask).toHaveBeenCalledExactlyOnceWith('other', IMAGE, true)
  })

  it('leaves headless runs to their own paid policy, whatever account they bill', async () => {
    const policy = vi.fn(() => Promise.resolve(true))
    const paid = new AcpPaidUse({
      flagged: ['imageGeneration'],
      canRemember: () => true,
      grants: memoryPaidGrants(),
      log: new FakeLogOutputChannel(),
      headless: policy,
      billing: () => WORK,
      accountFolder: () => temporaryFolder(),
      dailyBudgetUsd: () => Usd.from(5).toAmount(),
    })
    await expect(paid.allows('/ws/app', 'run', IMAGE, false)).resolves.toBe(true)
    expect(policy).toHaveBeenCalledOnce()
    expect(createAccountPaidService).not.toHaveBeenCalled()
  })

  it('refuses a held account Always after another agent forgetUnflagged, without persisting it', async () => {
    const folder = temporaryFolder()
    const billing = { value: WORK }
    const generations = new Map<string, number>()
    const grants = {
      ...memoryPaidGrants(),
      generation: (feature: string) => String(generations.get(feature) ?? 0),
      forget: (features: readonly string[]) => {
        for (const feature of features)
          generations.set(feature, (generations.get(feature) ?? 0) + 1)
        return Promise.resolve()
      },
    }
    const a = agent(billing, folder, grants)
    const b = new AcpPaidUse({
      flagged: [],
      canRemember: () => true,
      grants,
      log: new FakeLogOutputChannel(),
    })
    const opened = Promise.withResolvers<undefined>()
    const answer = Promise.withResolvers<PaidUseAnswer>()
    a.ask.mockImplementationOnce(() => {
      opened.resolve(undefined)
      return answer.promise
    })
    const held = a.paid.allows('/ws/app', 'session', IMAGE, false)
    await opened.promise
    await b.forgetUnflagged()
    answer.resolve('always')
    await expect(held).resolves.toBe(false)
    expect(readdirSync(folder)).toEqual([])
    const restarted = agent(billing, folder, grants)
    restarted.ask.mockResolvedValue('deny')
    await expect(restarted.paid.allows('/ws/app', 'session', IMAGE, false)).resolves.toBe(false)
    expect(restarted.ask).toHaveBeenCalledOnce()
  })

  it('binds the runtime’s billing account, its data folder and its shared daily budget', async () => {
    const home = temporaryFolder()
    const env = process.platform === 'win32' ? { LOCALAPPDATA: home } : { XDG_DATA_HOME: home }
    const data = agentDataFolder({ platform: process.platform, env, homeDir: home })
    mkdirSync(data, { recursive: true })
    writeFileSync(path.join(data, RUNTIME_SETTINGS_FILE), JSON.stringify({ paidDailyBudgetUsd: 7 }))
    const parsed = parseCommandLine([
      '--backend',
      'modelApi',
      '--image-generation',
      '--trust-workspace',
    ])
    if (parsed.command !== 'serve') throw new Error('missing test serve options')
    const runtime = createRuntimeBackend({
      options: parsed.options,
      version: 'test',
      distDir: home,
      platform: process.platform,
      env,
      homeDir: home,
      ...fakeRuntimeBackendDeps(),
      billingAccount: 'work',
    })
    try {
      const ask = vi.fn<PaidUseAsker>(() => Promise.resolve<PaidUseAnswer>('always'))
      runtime.paid.attach(ask)
      await expect(runtime.paid.allows(home, 'session', IMAGE, false)).resolves.toBe(true)
      const line = ask.mock.calls[0]?.[3]
      expect(line).toContain('meta · work')
      expect(line).toContain('Shared daily budget: $7.00')
      expect(readdirSync(path.join(data, ACCOUNT_PAID_STORE.folder))).toEqual([workspaceKey(home)])
    } finally {
      await runtime.close()
    }
  })

  it('refuses another account’s use honestly when the agent has no account folder', async () => {
    const paid = new AcpPaidUse({
      flagged: ['imageGeneration'],
      canRemember: () => true,
      grants: memoryPaidGrants(),
      log: new FakeLogOutputChannel(),
      billing: () => WORK,
    })
    const ask = vi.fn<PaidUseAsker>(() => Promise.resolve<PaidUseAnswer>('always'))
    paid.attach(ask)
    await expect(paid.allows('/ws/app', 'session', IMAGE, false)).rejects.toThrow(
      UI_TEXT.accounts.unavailable,
    )
    expect(ask).not.toHaveBeenCalled()
  })
})
