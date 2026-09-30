// Asking before each paid use (M58, PLAN.md D48). The owner (2026-09-27):
// "anything requiring extra payment should promt you with a popup that asks
// allow once allow always in this workspace or deny".
//
// Every use of a paid feature (a prompt that may search the web, an image,
// a Muse Voice recording, a scheduled run, a subagent task) asks in a popup
// with those three answers, in every permission mode, Bypass included. "Allow
// always in this workspace" is kept per workspace and only in a trusted one;
// it lapses in every workspace when the feature's price acceptance changes
// (the feature turned off, or a new price accepted), and Account & usage
// takes it back. A use that no longer asks is still loud: its row is marked
// paid, the badge names the feature, and the tally counts it.
//
// No `vscode` here: the host injects the popup and the stores. The popup's
// words are here, so VS Code's modal and the ACP agent's permission request
// (D62) say the same.

import { PAID_FEATURES, type PaidFeature, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  paidFeaturePrice,
  type PaidUseRequest,
  scheduledRunPrice,
  subagentTaskPrice,
} from '../../shared/paid'
import type { CoreLogger } from '../logging'

/** The popup's three answers. */
export type PaidUseAnswer = 'once' | 'always' | 'deny'

/** The popup's question and what it says about the use, in the display language. */
export function paidUseQuestion(request: PaidUseRequest): {
  readonly title: string
  readonly detail: string
} {
  switch (request.feature) {
    case 'webSearch': {
      return {
        title: UI_TEXT.paidUseWebSearchTitle,
        detail: fill(UI_TEXT.paidUseWebSearchDetail, { price: paidFeaturePrice('webSearch') }),
      }
    }
    case 'voice': {
      return {
        title: UI_TEXT.paidUseVoiceTitle,
        detail: fill(UI_TEXT.paidUseVoiceDetail, { price: paidFeaturePrice('voice') }),
      }
    }
    case 'imageGeneration': {
      // Every image, whatever the backend or permission mode: what is made,
      // from what, and that the key pays for it (M34, M44).
      const sources = request.sources.join(', ')
      return {
        title: fill(request.kind === 'edit' ? UI_TEXT.imageBuyEditTitle : UI_TEXT.imageBuyTitle, {
          path: request.path,
        }),
        detail: [
          fill(UI_TEXT.imageBuyPrompt, { prompt: request.prompt }),
          ...(sources === '' ? [] : [fill(UI_TEXT.imageBuySources, { paths: sources })]),
          fill(UI_TEXT.imageBuyBilling, { price: paidFeaturePrice('imageGeneration') }),
        ].join('\n\n'),
      }
    }
    case 'scheduledPrompts': {
      return {
        title: fill(UI_TEXT.scheduleRunConfirmTitle, { model: request.modelId }),
        detail: [
          fill(UI_TEXT.scheduleRunConfirmPrompt, { prompt: request.prompt }),
          fill(UI_TEXT.scheduleRunConfirmPrice, { price: scheduledRunPrice(request.modelId) }),
          UI_TEXT.scheduleRunConfirmExtras,
        ].join('\n\n'),
      }
    }
    case 'subagents': {
      const { task } = request
      return {
        title: fill(UI_TEXT.paidSubagentTaskTitle, { role: task.role }),
        detail: fill(UI_TEXT.paidSubagentTaskDetail, {
          objective: task.objective,
          price: subagentTaskPrice(task.modelId, task.attemptLimit),
        }),
      }
    }
  }
}

export interface PaidUseConsentDeps {
  /** Whether the feature may be used at all: its setting on and its price accepted. */
  readonly isOn: (feature: PaidFeature) => boolean
  /** A trusted workspace with a folder open: the only place "always" is offered and kept. */
  readonly canRemember: () => boolean
  /** The features allowed always in this workspace, still valid (the host drops lapsed ones). */
  readonly readGrants: () => ReadonlySet<PaidFeature>
  readonly writeGrants: (grants: ReadonlySet<PaidFeature>) => Promise<void>
  /** The popup; "always" is offered only when `canRemember` is true. */
  readonly ask: (request: PaidUseRequest, canRemember: boolean) => Promise<PaidUseAnswer>
  readonly log: CoreLogger
}

export class PaidUseConsent {
  private readonly listeners = new Set<() => void>()

  public constructor(private readonly deps: PaidUseConsentDeps) {}

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  /**
   * Keeps "always" for the feature. A store that cannot be written is
   * logged and leaves this use allowed once, so the next one asks again
   * instead of this one failing.
   */
  private async remember(feature: PaidFeature): Promise<boolean> {
    try {
      await this.deps.writeGrants(new Set([...this.deps.readGrants(), feature]))
      return true
    } catch (error: unknown) {
      this.deps.log.warn(
        `Paid use of ${feature}: "always" could not be kept, so it is allowed once: ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Whether the feature is on and allowed always here, so its next use asks nothing. */
  public isRemembered(feature: PaidFeature): boolean {
    return this.deps.isOn(feature) && this.deps.canRemember() && this.deps.readGrants().has(feature)
  }

  /** The features that no longer ask in this workspace, in their fixed order. */
  public remembered(): readonly PaidFeature[] {
    return PAID_FEATURES.filter((feature) => this.isRemembered(feature))
  }

  /**
   * Whether this use may be billed: allowed always here, or allowed in the
   * popup now. `requiresAsking` (a hook that demands a question) asks even when the
   * use is allowed always. A feature turned off while the popup was open is
   * refused whatever the answer.
   */
  public async allows(request: PaidUseRequest, requiresAsking = false): Promise<boolean> {
    const { feature } = request
    if (!this.deps.isOn(feature)) {
      return false
    }
    if (!requiresAsking && this.isRemembered(feature)) {
      this.deps.log.info(`Paid use of ${feature}: allowed always in this workspace`)
      return true
    }
    const canRemember = this.deps.canRemember()
    const answer = await this.deps.ask(request, canRemember)
    if (answer === 'deny') {
      this.deps.log.info(`Paid use of ${feature}: denied`)
      return false
    }
    if (!this.deps.isOn(feature)) {
      this.deps.log.info(`Paid use of ${feature}: turned off while the popup was open`)
      return false
    }
    if (
      answer === 'always' &&
      canRemember &&
      this.deps.canRemember() &&
      (await this.remember(feature))
    ) {
      this.deps.log.info(`Paid use of ${feature}: allowed always in this workspace`)
      this.notify()
    } else {
      this.deps.log.info(`Paid use of ${feature}: allowed once`)
    }
    return true
  }

  /** Account & usage's "Ask again": every feature asks again in this workspace. */
  public async forget(): Promise<void> {
    if (this.deps.readGrants().size === 0) {
      return
    }
    await this.deps.writeGrants(new Set())
    this.deps.log.info('Paid uses ask again in this workspace')
    this.notify()
  }
}
