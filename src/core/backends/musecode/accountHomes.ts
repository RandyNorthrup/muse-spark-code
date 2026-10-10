// D88.8: capture-gated CLI homes, independent of editor and credential store.
// W supplies private storage and a capture-derived non-secret configuration
// exporter. Nothing here reads auth files or accepts a Model API credential.
import path from 'node:path'
import * as z from 'zod/mini'
import { accountIdSchema } from '../../../shared/accounts'
import { ACCOUNT_DEFAULT_ID, UI_TEXT } from '../../../shared/constants'
import { subscriptionUsageSchema, type SubscriptionUsage } from '../../../shared/usage'
import type { AccountLimitsReader, AccountLimitsSnapshot } from '../../accounts/thresholds'
import type { PaidAccountBinding } from '../../paid/paidConsent'
import { accountPolicyFor, type AccountPolicy } from '../../providers/accountPolicy'
import { buildChildEnvironment, type ChildEnvironmentInput, type MuseLaunch } from './launch'

const configurationSchema = z.enum(['settings', 'hooks', 'skills', 'mcpServers', 'memory'])
type Configuration = z.infer<typeof configurationSchema>
// Local evidence, never a vendor response or a flag supplied by a page.
const captureSchema = z.strictObject({
  reference: z.string().check(z.minLength(1)),
  cliVersion: z.string().check(z.minLength(1)),
  platform: z.enum(['win32', 'darwin', 'linux', 'android']),
  nonSecretConfiguration: z.array(configurationSchema),
})
export type MuseCodeHomeCapture = z.infer<typeof captureSchema>

/** One immutable lease, shared by this account's serve and login terminal. */
export interface MuseCodeAccountHome {
  readonly provider: string
  readonly account: string
  /** The migrated default keeps the CLI's existing home and sign-in. */
  readonly configHome: string | undefined
  /** Local request ownership; neither field is part of an MSP frame. */
  readonly generation: number
  readonly signal: AbortSignal
  readonly assertCurrent: () => void
  readonly observeUsage: (usage: SubscriptionUsage) => void
}

interface AccountHomesDeps {
  readonly provider: string
  readonly platform: NodeJS.Platform
  readonly storageRoot: string
  readonly cliVersion: () => string | undefined
  readonly capture: () => unknown
  readonly hasAccount: (account: string) => boolean
  readonly now: () => number
  /** Must reject symlink/junction escapes and enforce owner-only permissions/ACLs. */
  readonly ensureOwnerOnlyDirectory: (configHome: string) => Promise<void>
  /** Only explicitly selected, capture-verified non-secret data; never auth files. */
  readonly copyNonSecretConfiguration: (request: {
    readonly account: string
    readonly configHome: string
    readonly selection: readonly Configuration[]
  }) => Promise<void>
  /** Use a direct CLI executable/launcher and a replacement environment.
   * Await the workspace startup fence, then assertCurrent just before opening. */
  readonly openLoginTerminal: (request: {
    readonly command: string
    readonly args: readonly string[]
    readonly env: NodeJS.ProcessEnv
    readonly strictEnv: true
    readonly assertCurrent: () => void
  }) => Promise<void>
}

export class MuseCodeAccountHomes implements AccountLimitsReader {
  private readonly generations = new Map<string, number>()
  private readonly lifetimes = new Map<string, AbortController>()
  private readonly homes = new WeakSet<MuseCodeAccountHome>()
  private readonly usage = new Map<string, SubscriptionUsage>()

  public constructor(private readonly deps: AccountHomesDeps) {}

  private evidence(): MuseCodeHomeCapture {
    const parsed = captureSchema.safeParse(this.deps.capture())
    if (
      !parsed.success ||
      parsed.data.platform !== this.deps.platform ||
      parsed.data.cliVersion !== this.deps.cliVersion()
    )
      throw new Error(UI_TEXT.accounts.museCodeUnavailable)
    return parsed.data
  }

  private assertAccount(account: string): void {
    if (
      !accountIdSchema.safeParse(this.deps.provider).success ||
      !accountIdSchema.safeParse(account).success ||
      !this.deps.hasAccount(account)
    )
      throw new Error(UI_TEXT.accounts.invalidAccount)
  }

  private observe(account: string, raw: SubscriptionUsage): void {
    const usage = subscriptionUsageSchema.parse(raw)
    const now = this.deps.now()
    const windows = [usage.window, usage.weekly]
    if (
      !Number.isSafeInteger(usage.observedAtMs) ||
      !Number.isFinite(new Date(usage.observedAtMs).getTime()) ||
      usage.observedAtMs > now ||
      !Number.isFinite(new Date(now).getTime()) ||
      usage.window.windowDurationMins <= 0 ||
      windows.some(
        (window) =>
          window.usedPercent < 0 ||
          !Number.isSafeInteger(window.resetsAtMs) ||
          !Number.isFinite(new Date(window.resetsAtMs).getTime()),
      )
    )
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    const previous = this.usage.get(account)
    if (previous !== undefined && previous.observedAtMs >= usage.observedAtMs) return
    this.usage.set(account, usage)
  }

  public async prepare(
    account: string,
    selection: readonly Configuration[] = [],
  ): Promise<MuseCodeAccountHome> {
    const evidence = this.evidence()
    const stamp = JSON.stringify(evidence)
    this.assertAccount(account)
    const selected = [...selection]
    if (selected.some((item) => !evidence.nonSecretConfiguration.includes(item)))
      throw new Error(UI_TEXT.accounts.museCodeUnavailable)
    if (account === ACCOUNT_DEFAULT_ID && selected.length > 0)
      throw new Error(UI_TEXT.accounts.invalidAccount)
    const p = this.deps.platform === 'win32' ? path.win32 : path.posix
    if (!p.isAbsolute(this.deps.storageRoot)) throw new Error(UI_TEXT.accounts.invalidAccount)
    const configHome =
      account === ACCOUNT_DEFAULT_ID
        ? undefined
        : p.join(this.deps.storageRoot, 'muse-code-accounts', this.deps.provider, account)
    const generation = this.generations.get(account) ?? 0
    let lifetime = this.lifetimes.get(account)
    if (lifetime === undefined) {
      lifetime = new AbortController()
      this.lifetimes.set(account, lifetime)
    }
    const assertCurrent = () => {
      if (JSON.stringify(this.evidence()) !== stamp)
        throw new Error(UI_TEXT.accounts.museCodeUnavailable)
      this.assertAccount(account)
      if ((this.generations.get(account) ?? 0) !== generation)
        throw new Error(UI_TEXT.accounts.invalidAccount)
    }
    if (configHome !== undefined) {
      await this.deps.ensureOwnerOnlyDirectory(configHome)
      assertCurrent()
      if (selected.length > 0) {
        await this.deps.copyNonSecretConfiguration({ account, configHome, selection: selected })
        assertCurrent()
      }
    }
    const home: MuseCodeAccountHome = Object.freeze({
      provider: this.deps.provider,
      account,
      configHome,
      generation,
      signal: lifetime.signal,
      assertCurrent,
      observeUsage: (usage: SubscriptionUsage) => {
        assertCurrent()
        this.observe(account, usage)
      },
    })
    this.homes.add(home)
    return home
  }

  public async login(
    home: MuseCodeAccountHome,
    launch: MuseLaunch,
    environment: ChildEnvironmentInput,
  ): Promise<void> {
    if (!this.homes.has(home) || environment.platform !== this.deps.platform)
      throw new Error(UI_TEXT.accounts.invalidAccount)
    await this.deps.openLoginTerminal({
      command: launch.command,
      args: ['login'],
      strictEnv: true,
      env: buildChildEnvironment({ ...environment, accountHome: home }),
      assertCurrent: home.assertCurrent,
    })
  }

  /** Call synchronously before logout/removal; a re-add cannot revive old callbacks. */
  public invalidate(account: string): void {
    this.generations.set(account, (this.generations.get(account) ?? 0) + 1)
    this.usage.delete(account)
    const lifetime = this.lifetimes.get(account)
    this.lifetimes.delete(account)
    lifetime?.abort()
  }

  /** The raw captured subscription row; never clamp its displayed percentage. */
  public subscription(account: string): SubscriptionUsage | undefined {
    this.assertAccount(account)
    const usage = this.usage.get(account)
    return usage === undefined ? undefined : structuredClone(usage)
  }

  public read(provider: string, account: string): AccountLimitsSnapshot {
    this.evidence()
    this.assertAccount(account)
    if (provider !== this.deps.provider) throw new Error(UI_TEXT.accounts.invalidAccount)
    const now = this.deps.now()
    if (!Number.isFinite(new Date(now).getTime()))
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    const usage = this.usage.get(account)
    if (usage === undefined) return {}
    const window = (value: SubscriptionUsage['weekly']) => ({
      usedPercent: Math.min(100, value.usedPercent),
      resetAt: new Date(value.resetsAtMs).toISOString(),
    })
    const full = [usage.window, usage.weekly].filter(
      (value) => value.usedPercent >= 100 && value.resetsAtMs > now,
    )
    return {
      planWindows: { window: window(usage.window), weekly: window(usage.weekly) },
      ...(full.length > 0 && {
        blocked: {
          reason: 'usageLimit',
          resetAt: new Date(Math.max(...full.map((value) => value.resetsAtMs))).toISOString(),
        },
      }),
    }
  }
}

const recoveryChoiceSchema = z.enum(['upgrade', 'wait', 'payAsYouGo', 'cancel'])
type RecoveryChoice = z.infer<typeof recoveryChoiceSchema>
/** P handles policy confirmation after recovery; this port never selects a CLI key. */
export async function recoverMuseCodeAccount(deps: {
  readonly offer: (question: {
    readonly detail: string
    readonly policy: AccountPolicy
    readonly hasPayAsYouGo: boolean
  }) => Promise<unknown>
  readonly upgrade: () => Promise<void>
  readonly payAsYouGo?: {
    readonly binding: PaidAccountBinding
    readonly assertCurrent: (binding: PaidAccountBinding) => void
    /** Bind D48's three choices to this Model API account, price and shared budget. */
    readonly allows: (binding: PaidAccountBinding) => Promise<boolean>
    /** Existing daily AND conversation admission owns reservation/settlement and
     * releases a claim if dispatch fails. It invokes start only after admission. */
    readonly admit: (start: () => Promise<void>) => Promise<void>
    /** Model API path only, after consent/admission; owns its credential internally. */
    readonly start: (binding: PaidAccountBinding) => Promise<void>
  }
}): Promise<RecoveryChoice> {
  const policy = accountPolicyFor('meta', 'muse-code')
  if (policy === undefined) throw new Error(UI_TEXT.accounts.museCodeUnavailable)
  const paid = deps.payAsYouGo
  const binding =
    paid === undefined
      ? undefined
      : Object.freeze({
          provider: paid.binding.provider,
          account: paid.binding.account,
          price: paid.binding.price,
          dailyBudgetUsd: paid.binding.dailyBudgetUsd,
        })
  const choice = recoveryChoiceSchema.parse(
    await deps.offer({
      detail: UI_TEXT.accounts.museCodeRecovery,
      policy,
      hasPayAsYouGo: paid !== undefined,
    }),
  )
  if (choice === 'upgrade') await deps.upgrade()
  if (choice !== 'payAsYouGo') return choice
  if (paid === undefined || binding === undefined) throw new Error(UI_TEXT.accounts.invalidAccount)
  paid.assertCurrent(binding)
  if (!(await paid.allows(binding))) return 'cancel'
  paid.assertCurrent(binding)
  await paid.admit(async () => {
    paid.assertCurrent(binding)
    await paid.start(binding)
  })
  return choice
}
