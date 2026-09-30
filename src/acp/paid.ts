// The paid Model API features in the agent (M63c, M58; PLAN.md D30, D48,
// D62): "opt in and loud", as in the panel. A feature is off unless the
// editor started the agent with its flag. Every use then asks in the editor,
// as the panel's popup does (D48): a permission prompt that names what is
// about to be billed and its price, with Allow once, Allow always in this
// workspace and Deny. "Always" is offered and kept only with
// `--trust-workspace`, as the panel offers it only in a trusted workspace;
// it is kept per folder in the agent's data folder (runtime/paidGrants.ts)
// and lapses when the agent starts without the feature's flag, so turning
// the flag on again asks again. A use with no session to ask in (no client,
// or a conversation the agent does not hold) is denied, and so is every
// feature the agent has no flag for: subagents, Muse Voice and scheduled
// runs.

import type { PermissionOption, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { PaidUseConsent, type PaidUseAnswer } from '../core/paid/paidConsent'
import { failureForLog } from '../core/backends/musecode/logText'
import type { CoreLogger } from '../core/logging'
import {
  ACP_PAID_FEATURES,
  ACP_PAID_OPTIONS,
  type AcpPaidFeature,
  type PaidFeature,
  UI_TEXT,
} from '../shared/constants'
import type { PaidUseRequest } from '../shared/paid'

/** Where "Allow always in this workspace" is kept, per folder. */
export interface PaidGrantStore {
  readonly read: (workspaceRoot: string) => ReadonlySet<PaidFeature>
  /** Adds these features to the folder's grants, merged with the store as it then is. */
  readonly add: (workspaceRoot: string, features: readonly PaidFeature[]) => Promise<void>
  /** Takes these features out of every folder's grants. */
  readonly forget: (features: readonly PaidFeature[]) => Promise<void>
}

/** The question in one of the client's sessions; the agent attaches it (agent.ts). */
export type PaidUseAsker = (
  sessionId: string,
  request: PaidUseRequest,
  canRemember: boolean,
) => Promise<PaidUseAnswer>

export interface AcpPaidUseDeps {
  /** The features whose flags the editor gave. */
  readonly flagged: readonly AcpPaidFeature[]
  /** `--trust-workspace`: where "always" is offered and honoured. */
  readonly canRemember: () => boolean
  readonly grants: PaidGrantStore
  readonly log: CoreLogger
}

/** The agent's own store's failure: its code and our own data folder's path, never a CLI's text. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The prompt's options: the popup's answers (D48), "always" only where it is kept. */
export function paidUseOptions(canRemember: boolean): PermissionOption[] {
  const always: PermissionOption = {
    optionId: ACP_PAID_OPTIONS.allowAlways,
    name: UI_TEXT.paidAllowAlways,
    kind: 'allow_always',
  }
  return [
    { optionId: ACP_PAID_OPTIONS.allowOnce, name: UI_TEXT.allowOnce, kind: 'allow_once' },
    ...(canRemember ? [always] : []),
    { optionId: ACP_PAID_OPTIONS.deny, name: UI_TEXT.paidDeny, kind: 'reject_once' },
  ]
}

/**
 * The client's answer. A cancel, or an option the prompt did not offer, is
 * Deny: nothing is billed by a translation default (D62).
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
  private asker: PaidUseAsker | undefined
  private readonly used = new Map<PaidFeature, number>()

  public constructor(private readonly deps: AcpPaidUseDeps) {}

  private async ask(
    sessionId: string,
    request: PaidUseRequest,
    canRemember: boolean,
  ): Promise<PaidUseAnswer> {
    const { asker } = this
    if (asker === undefined) {
      this.deps.log.warn(`Paid use of ${request.feature}: no editor to ask, so it is denied`)
      return 'deny'
    }
    try {
      return await asker(sessionId, request, canRemember)
    } catch (error: unknown) {
      this.deps.log.warn(
        `Paid use of ${request.feature}: the editor could not be asked, so it is denied: ${failureForLog(error)}`,
      )
      return 'deny'
    }
  }

  /**
   * "Allow always" for the folder: only what this answer adds, merged into
   * the file as it is when written, so a set read before another agent's
   * change is never written back over it.
   */
  private async keep(workspaceRoot: string, grants: ReadonlySet<PaidFeature>): Promise<void> {
    const held = this.deps.grants.read(workspaceRoot)
    await this.deps.grants.add(
      workspaceRoot,
      [...grants].filter((feature) => !held.has(feature)),
    )
  }

  /** Whether the backend may use the feature at all: its flag given. */
  public isOn(feature: PaidFeature): boolean {
    const flagged: readonly PaidFeature[] = this.deps.flagged
    return flagged.includes(feature)
  }

  /** The agent's way to ask; until it is attached, every use is denied. */
  public attach(asker: PaidUseAsker): void {
    this.asker = asker
  }

  /** The popup before a use in the folder's conversation `sessionId` (D48). */
  public async allows(
    workspaceRoot: string,
    sessionId: string,
    request: PaidUseRequest,
    requiresAsking: boolean,
  ): Promise<boolean> {
    const consent = new PaidUseConsent({
      isOn: (feature) => this.isOn(feature),
      canRemember: this.deps.canRemember,
      readGrants: () => this.deps.grants.read(workspaceRoot),
      writeGrants: (grants) => this.keep(workspaceRoot, grants),
      ask: (asked, canRemember) => this.ask(sessionId, asked, canRemember),
      log: this.deps.log,
    })
    return await consent.allows(request, requiresAsking)
  }

  /** Whether the feature is on and allowed always in the folder, so it asks nothing. */
  public isRemembered(workspaceRoot: string, feature: PaidFeature): boolean {
    return (
      this.isOn(feature) &&
      this.deps.canRemember() &&
      this.deps.grants.read(workspaceRoot).has(feature)
    )
  }

  /**
   * At start: a feature without its flag loses "always" in every folder, so
   * turning the flag on again asks again. A file that cannot be written is
   * logged; the grant is still never honoured while the flag is off.
   */
  public async forgetUnflagged(): Promise<void> {
    const unflagged = ACP_PAID_FEATURES.filter((feature) => !this.isOn(feature))
    if (unflagged.length === 0) {
      return
    }
    try {
      await this.deps.grants.forget(unflagged)
    } catch (error: unknown) {
      this.deps.log.warn(
        `Paid uses allowed always could not be forgotten for ${unflagged.join(', ')}: ${describe(error)}`,
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
