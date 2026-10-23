import { uiLocale } from '../shared/l10n/text'
// The paid Model API features in the agent (M63c, M58; PLAN.md D30, D48,
// D62): "opt in and loud", as in the panel. A feature is off unless the
// editor started the agent with its flag — except automatic compaction,
// which is on by default like the panel once evaluated and stops only with
// `--no-auto-compaction`. Every use then asks in the editor,
// as the panel's popup does (D48): a permission prompt that names what is
// about to be billed and its price, with Allow once, Allow always in this
// workspace and Deny. "Always" is offered and kept only with
// `--trust-workspace`, as the panel offers it only in a trusted workspace;
// it is kept per folder in the agent's data folder (runtime/paidGrants.ts)
// and lapses when the agent starts without the feature's flag (or with
// `--no-auto-compaction` for compaction), so asking happens again. A use
// with no session to ask in (no client, or a conversation the agent does
// not hold) is denied, and so is every feature the agent has no flag for:
// subagents, Muse Voice and scheduled runs.

import type { PermissionOption, RequestPermissionResponse } from '@agentclientprotocol/sdk/unstable'
import {
  PaidUseConsent,
  type PaidNotKeptNotice,
  type PaidUseAnswer,
} from '../core/paid/paidConsent'
import { failureForLog } from '../core/backends/musecode/logText'
import type { CoreLogger } from '../core/logging'
import {
  IS_AUTO_COMPACTION_EVALUATED,
  ACP_PAID_FEATURES,
  ACP_PAID_OPTIONS,
  type AcpPaidFeature,
  type PaidFeature,
  UI_TEXT,
} from '../shared/constants'
import type { PaidUseRequest, PaidUseDecision } from '../shared/paid'
import { PaidAuthority, type PaidGrant } from '../core/paid/paidAuthority'
import {
  paidFeatureName,
  paidStoreReasonText,
  type PaidQuote,
  type PaidQuoteNotice,
} from '../shared/paid'
import { compareUsdAmounts, nonnegativeUsdSchema, type UsdAmount } from '../shared/usdSchema'
import { fill } from '../shared/l10n/text'
import {
  accountPaidRoute,
  type AccountPaidService,
  type PaidBilling,
} from '../core/paid/accountPaidRoute'

/** Where "Allow Always in This Workspace" is kept, per folder. */
export interface PaidGrantStore {
  readonly read: (workspaceRoot: string) => ReadonlySet<PaidFeature>
  /** Adds these features to the folder's grants, merged with the store as it then is. */
  readonly add: (workspaceRoot: string, features: readonly PaidFeature[]) => Promise<void>
  /** Takes these features out of every folder's grants. */
  readonly forget: (features: readonly PaidFeature[]) => Promise<void>
  readonly nextQuoteOrder?: () => number
  readonly prepareQuoteGeneration?: () => Promise<string>
  readonly quoteGeneration?: () => string
  /** The last quote-folder read failure's kind, while saved Always quotes cannot be listed. */
  readonly quoteNotice?: () => PaidQuoteNotice | undefined
  readonly readQuote?: (workspaceRoot: string, quote: PaidQuote) => PaidGrant | undefined
  readonly writeQuote?: (workspaceRoot: string, grant: PaidGrant) => Promise<void>
  /** The feature's revocation generation: an account's Always lapses with it (M108 lane P). */
  readonly generation?: (feature: PaidFeature) => string
}

/** The question in one of the client's sessions; the agent attaches it (agent.ts). */
export type PaidUseAsker = (
  sessionId: string,
  request: PaidUseRequest,
  canRemember: boolean,
  /** M108 lane P: the account this use bills, its tariff and the shared budget. */
  accountLine?: string,
) => Promise<PaidUseAnswer>

export interface AcpPaidUseDeps {
  readonly autoCompactionEvaluated?: () => boolean
  /** `--no-auto-compaction`: the one way to turn the default-on compaction off. */
  readonly autoCompactionOff?: boolean
  /** The features whose flags the editor gave. */
  readonly flagged: readonly AcpPaidFeature[]
  readonly scheduleAuthorization?: {
    readonly scheduledPrompts: boolean
    readonly maxBudgetUsd?: UsdAmount
  }
  /** `--trust-workspace`: where "always" is offered and honoured. */
  readonly canRemember: () => boolean
  readonly grants: PaidGrantStore
  readonly log: CoreLogger
  readonly headless?: HeadlessPaidPolicy
  /**
  Tells the terminal operator what the person must hear (an "always" that
  could not be kept). A session notifier attached with `attachNotify`
  reaches the session's person instead, where there is one.
  */
  readonly notify?: (text: string) => void
  /**
  M108 lane P (D88.7): the account this agent's Model API backend bills.
  The provider's default account keeps the folder's consent below,
  unchanged; another account's first paid use asks for that account
  (dist/accountPaid.js, loaded on that first use).
  */
  readonly billing?: () => PaidBilling | undefined
  /** Where a folder keeps account consent, in the agent's own data folder. */
  readonly accountFolder?: (workspaceRoot: string) => string
  /** The shared daily budget an account's question names. */
  readonly dailyBudgetUsd?: () => UsdAmount
  /** Waits between rename attempts; injectable so tests do not sleep. */
  readonly sleep?: (ms: number) => Promise<void>
}

export type HeadlessPaidPolicy = (
  request: PaidUseRequest,
  requiresAsking: boolean,
) => Promise<boolean>

/** The prompt's options: the popup's answers (D48), "always" only where it is kept. */
export function paidUseOptions(canRemember: boolean, isSchedule = false): PermissionOption[] {
  const always: PermissionOption = {
    optionId: ACP_PAID_OPTIONS.allowAlways,
    name: isSchedule ? UI_TEXT.scheduleV2.messages.allowAlways : UI_TEXT.paidAllowAlways,
    kind: 'allow_always',
  }
  return [
    { optionId: ACP_PAID_OPTIONS.allowOnce, name: UI_TEXT.allowOnce, kind: 'allow_once' },
    ...(canRemember ? [always] : []),
    { optionId: ACP_PAID_OPTIONS.deny, name: UI_TEXT.paidDeny, kind: 'reject_once' },
  ]
}

/**
The client's answer. A cancel, or an option the prompt did not offer, is
Deny: nothing is billed by a translation default (D62).
*/
export function paidUseAnswer(
  response: RequestPermissionResponse,
  canRemember: boolean,
): PaidUseAnswer {
  const { outcome } = response
  if (outcome.outcome !== 'selected') {
    return 'deny'
  }
  if (outcome.optionId === ACP_PAID_OPTIONS.allowOnce) {
    return 'once'
  }
  return canRemember && outcome.optionId === ACP_PAID_OPTIONS.allowAlways ? 'always' : 'deny'
}

export class AcpPaidUse {
  private readonly consents = new Map<string, PaidUseConsent>()
  private readonly accountRoutes = new Map<string, ReturnType<typeof accountPaidRoute>>()
  private readonly authority: PaidAuthority
  private asker: PaidUseAsker | undefined
  private sessionNotifier: ((sessionId: string, text: string) => void) | undefined
  /** The session each folder's last question ran in, for the not-kept notice. */
  private readonly notifySessions = new Map<string, string>()
  private readonly used = new Map<PaidFeature, number>()

  public constructor(private readonly deps: AcpPaidUseDeps) {
    this.authority = new PaidAuthority(UI_TEXT, uiLocale())
  }

  private notKeptText(notice: PaidNotKeptNotice): string {
    return fill(UI_TEXT.paidAlwaysNotKept, {
      feature: paidFeatureName(notice.feature),
      kind: paidStoreReasonText(notice.kind),
    })
  }

  private async ask(
    sessionId: string,
    request: PaidUseRequest,
    canRemember: boolean,
    accountLine?: string,
  ): Promise<PaidUseAnswer> {
    const { asker } = this
    if (asker === undefined) {
      this.deps.log.warn(`Paid use of ${request.feature}: no editor to ask, so it is denied`)
      return 'deny'
    }
    try {
      // A default-account use asks exactly as before; another account's names it.
      return accountLine === undefined
        ? await asker(sessionId, request, canRemember)
        : await asker(sessionId, request, canRemember, accountLine)
    } catch (error: unknown) {
      this.deps.log.warn(
        `Paid use of ${request.feature}: the editor could not be asked, so it is denied: ${failureForLog(error)}`,
      )
      return 'deny'
    }
  }

  /**
  "Allow always" for the folder: only what this answer adds, merged into
  the file as it is when written, so a set read before another agent's
  change is never written back over it.
  */
  private async keep(workspaceRoot: string, grants: ReadonlySet<PaidFeature>): Promise<void> {
    const held = this.deps.grants.read(workspaceRoot)
    await this.deps.grants.add(
      workspaceRoot,
      [...grants].filter((feature) => !held.has(feature)),
    )
  }

  /**
  The ports a folder's workspace consent and its account consents share:
  the flags, trust, this agent's paid authority and the grant generations.
  */
  private sharedPorts() {
    return {
      authority: this.authorityFor(),
      ...(this.deps.grants.nextQuoteOrder !== undefined && {
        nextQuoteOrder: this.deps.grants.nextQuoteOrder,
      }),
      isOn: (feature: PaidFeature) => this.isOn(feature),
      windowOnceFeatures: new Set<PaidFeature>(['autoCompaction']),
      canRemember: this.deps.canRemember,
      ...(this.deps.grants.prepareQuoteGeneration !== undefined && {
        prepareQuoteGeneration: this.deps.grants.prepareQuoteGeneration,
      }),
      ...(this.deps.grants.quoteGeneration !== undefined && {
        quoteGeneration: this.deps.grants.quoteGeneration,
      }),
      readQuoteNotice: () => this.deps.grants.quoteNotice?.(),
      log: this.deps.log,
    }
  }
  /**
  The folder's account consent (M108 lane P), loaded on the first use
  billed to another account. Every account question is the editor's
  permission prompt in the use's own session, with the account's line.
  */
  private async loadAccountService(workspaceRoot: string): Promise<AccountPaidService> {
    const { accountFolder, dailyBudgetUsd } = this.deps
    const entry = await import('../host/paid/accountPaidEntry')
    if (accountFolder === undefined || dailyBudgetUsd === undefined)
      throw new Error(UI_TEXT.accounts.unavailable)
    return entry.createAccountPaidService(UI_TEXT, uiLocale(), {
      // The folder consent's own ports: its flags, trust, authority and generations.
      base: this.sharedPorts(),
      billing: () => this.deps.billing?.(),
      folder: accountFolder(workspaceRoot),
      featureGeneration: (feature) => this.deps.grants.generation?.(feature) ?? 'initial',
      dailyBudgetUsd: () => dailyBudgetUsd(),
      // Every flagged use passes its own session's prompt; nothing else asks.
      ask: () => Promise.resolve('deny'),
      ...(this.deps.sleep !== undefined && { sleep: this.deps.sleep }),
    })
  }

  /** The folder's account route, loading its service on the first use billed to another account. */
  private accountRoute(workspaceRoot: string): ReturnType<typeof accountPaidRoute> {
    let route = this.accountRoutes.get(workspaceRoot)
    if (route === undefined) {
      route = accountPaidRoute(
        () => this.deps.billing?.(),
        () => this.loadAccountService(workspaceRoot),
      )
      this.accountRoutes.set(workspaceRoot, route)
    }
    return route
  }

  private consentFor(workspaceRoot: string, sessionId: string): PaidUseConsent {
    let consent = this.consents.get(workspaceRoot)
    if (consent === undefined) {
      consent = new PaidUseConsent({
        ...this.sharedPorts(),
        ...(this.deps.grants.readQuote !== undefined && {
          readQuoteGrant: (quote) => this.deps.grants.readQuote?.(workspaceRoot, quote),
        }),
        ...(this.deps.grants.writeQuote !== undefined && {
          writeQuoteGrant: (grant) =>
            this.deps.grants.writeQuote?.(workspaceRoot, grant) ?? Promise.resolve(),
        }),
        readGrants: () => this.deps.grants.read(workspaceRoot),
        writeGrants: (grants) => this.keep(workspaceRoot, grants),
        ask: (asked, canRemember) => this.ask(sessionId, asked, canRemember),
        // A choice that could not be saved is said at once: the session
        // that asked (bound when the question was asked and carried with
        // the pending write, P2-3), else the terminal operator.
        onNotKept: (notice) => {
          const text = this.notKeptText(notice)
          const notifySession = notice.sessionId ?? this.notifySessions.get(workspaceRoot)
          if (notifySession !== undefined && this.sessionNotifier !== undefined) {
            this.sessionNotifier(notifySession, text)
            return
          }
          this.deps.notify?.(text)
        },
      })
      this.consents.set(workspaceRoot, consent)
    }
    return consent
  }

  /** Whether the backend may use the feature at all: its flag given. */
  public authorityFor(): PaidAuthority {
    return this.authority
  }

  public isOn(feature: PaidFeature): boolean {
    if (feature === 'autoCompaction') {
      // On by default like the panel once evaluated; only the explicit
      // off flag stops it. The first paid use still asks in the editor.
      return (
        (this.deps.autoCompactionEvaluated?.() ?? IS_AUTO_COMPACTION_EVALUATED) &&
        this.deps.autoCompactionOff !== true
      )
    }
    if (feature === 'scheduledPrompts')
      return this.deps.scheduleAuthorization?.scheduledPrompts === true
    const flagged: readonly PaidFeature[] = this.deps.flagged
    return flagged.includes(feature)
  }

  /** The agent's way to ask; until it is attached, every use is denied. */
  public attach(asker: PaidUseAsker): void {
    this.asker = asker
  }

  /** The agent's way to reach a session's person after its answer landed. */
  public attachNotify(notify: (sessionId: string, text: string) => void): void {
    this.sessionNotifier = notify
  }

  /** D95 asks for this schedule only; a workspace extra grant never supplies its answer. */
  public async askScheduleUse(
    sessionId: string,
    request: Extract<PaidUseRequest, { feature: 'scheduledPrompts' }>,
  ): Promise<PaidUseAnswer> {
    const budget = nonnegativeUsdSchema.safeParse(this.deps.scheduleAuthorization?.maxBudgetUsd)
    if (
      request.schedule === undefined ||
      !this.isOn('scheduledPrompts') ||
      !budget.success ||
      budget.data === '0' ||
      !nonnegativeUsdSchema.safeParse(request.schedule.dailyCapUsd).success ||
      request.schedule.dailyCapUsd === '0' ||
      compareUsdAmounts(request.schedule.dailyCapUsd, budget.data) > 0 ||
      this.deps.headless !== undefined
    )
      return 'deny'
    const canRemember = this.deps.canRemember()
    const answer = await this.ask(sessionId, request, canRemember)
    return !this.isOn('scheduledPrompts') ||
      (answer === 'always' && (!canRemember || !this.deps.canRemember()))
      ? 'deny'
      : answer
  }

  /** The popup before a use in the folder's conversation `sessionId` (D48). */
  public async allows(
    workspaceRoot: string,
    sessionId: string,
    request: PaidUseRequest,
    requiresAsking: boolean,
  ): Promise<PaidUseDecision> {
    this.notifySessions.set(workspaceRoot, sessionId)
    if (request.feature === 'scheduledPrompts' && request.schedule !== undefined)
      return (await this.askScheduleUse(sessionId, request)) !== 'deny'
    if (this.deps.headless !== undefined) {
      return this.isOn(request.feature) && (await this.deps.headless(request, requiresAsking))
    }
    // Another account's use asks that account's own consent, in this session (D88.7).
    const routed = this.accountRoute(workspaceRoot).route(
      request,
      requiresAsking,
      (asked, canRemember, line) => this.ask(sessionId, asked, canRemember, line),
    )
    return routed === undefined
      ? await this.consentFor(workspaceRoot, sessionId).allows(
          request,
          requiresAsking,
          (asked, canRemember) => this.ask(sessionId, asked, canRemember),
          undefined,
          // The asking session travels with the pending write: a later
          // question in another session cannot steal its notice (P2-3).
          sessionId,
        )
      : await routed
  }

  /** A live fence for an admitted use in the folder's conversation. */
  public fence(workspaceRoot: string, sessionId: string, feature: PaidFeature): () => boolean {
    return this.consentFor(workspaceRoot, sessionId).fence(feature)
  }

  /** Whether the feature is on and allowed always in the folder, so it asks nothing. */
  public isRemembered(workspaceRoot: string, feature: PaidFeature): boolean {
    return (
      feature !== 'scheduledPrompts' &&
      this.deps.headless === undefined &&
      this.isOn(feature) &&
      this.deps.canRemember() &&
      (feature === 'webSearch'
        ? (this.consents.get(workspaceRoot)?.isRemembered(feature) ?? false)
        : this.deps.grants.read(workspaceRoot).has(feature))
    )
  }

  /**
  At start: a feature without its flag loses "always" in every folder, so
  turning the flag on again asks again. Compaction counts as flagged
  while it is default-on; with `--no-auto-compaction` its grant lapses
  too. A file that cannot be written is logged; the grant is still never
  honoured while the feature is off.
  */
  public async forgetUnflagged(): Promise<void> {
    if (this.deps.headless !== undefined) return
    const flagged: readonly AcpPaidFeature[] =
      this.deps.autoCompactionOff === true
        ? this.deps.flagged.filter((feature) => feature !== 'autoCompaction')
        : (['autoCompaction', ...this.deps.flagged] as readonly AcpPaidFeature[])
    const unflagged = ACP_PAID_FEATURES.filter((feature) => !flagged.includes(feature))
    if (unflagged.length === 0) {
      return
    }
    try {
      await this.deps.grants.forget(unflagged)
    } catch (error: unknown) {
      // The log carries only the failure's kind, never the store message.
      this.deps.log.warn(
        `Paid uses allowed always could not be forgotten for ${unflagged.join(', ')}: ${failureForLog(error)}`,
      )
    }
  }

  /** A billed use, tallied for the log: the agent has no usage dialog. */
  public noteUse(feature: PaidFeature, units: number): void {
    const total = (this.used.get(feature) ?? 0) + units
    this.used.set(feature, total)
    this.deps.log.info(
      `Paid use of ${feature}: ${String(units)}, ${String(total)} since the agent started`,
    )
  }
}
