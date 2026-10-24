// Tab's paid-use consent in the language server (M104 lane H, PLAN.md D48,
// D73): RLF-TAB's keyed consent (`createTabConsent`, one key per model and
// price) over the shared `PaidUseConsent.askScope`, as VS Code composes it.
// The question is the editor's `window/showMessageRequest` with D48's
// answers: Allow once covers this connection until it closes, Always is
// offered and kept only in a trusted workspace (`--trust-workspace`) and
// recorded with its key, and Deny snoozes this connection.
import { rm } from 'node:fs/promises'
import * as z from 'zod/mini'
import { failureForLog } from '../../core/backends/musecode/logText'
import { PaidUseConsent, paidUseQuestion } from '../../core/paid/paidConsent'
import { writeFileAtomically, readTextIfPresent } from '../../host/fsAtomic'
import type { Logger } from '../../host/logger'
import {
  createTabConsent,
  tabPriceFingerprint,
  type TabUseConsent,
} from '../../host/tab/tabConsent'
import type { PaidGrantStore } from '../../acp/paid'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { paidFeatureName, paidStoreReasonText } from '../../shared/paid'
import type { UsdAmount } from '../../shared/usdSchema'

/** Tab's one Always record for a workspace: its model and price fingerprint (RVM94KR2). */
const alwaysRecordSchema = z.strictObject({
  scope: z.literal('always'),
  model: z.string(),
  price: z.string(),
})

export interface LspConsentDeps {
  readonly workspace: string
  /** `--tab`: the paid feature is on for this server. */
  readonly isOn: () => boolean
  /** `--trust-workspace`: where Always is offered and kept. */
  readonly canRemember: boolean
  /** The agent's per-workspace grants (runtime/paidGrants.ts), shared with the ACP agent. */
  readonly grants: PaidGrantStore
  /** This workspace's keyed Always record. */
  readonly alwaysFile: string
  readonly budgetUsd: UsdAmount
  /** The editor's question: the chosen action's title, or undefined when dismissed. */
  readonly ask: (message: string, actions: readonly string[]) => Promise<string | undefined>
  /** Tells the person something they must hear (an Always that could not be kept). */
  readonly notify: (text: string) => void
  readonly log: Logger
}

/** The record as stored, or undefined: a missing, unreadable or foreign file is no record. */
function readAlways(file: string, log: Logger): unknown {
  let text: string | undefined
  try {
    text = readTextIfPresent(file)
  } catch (error: unknown) {
    log.warn(`Tab consent record unreadable; Tab asks again: ${failureForLog(error)}`)
    return undefined
  }
  if (text === undefined) return undefined
  try {
    const parsed = alwaysRecordSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch (error: unknown) {
    // Malformed JSON (SyntaxError) is no record: the request asks again.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

export function createLspTabConsent(deps: LspConsentDeps): TabUseConsent {
  const workspace = deps.workspace
  const paid = new PaidUseConsent({
    isOn: (feature) => feature === 'tab' && deps.isOn(),
    windowOnceFeatures: new Set(['tab']),
    canRemember: () => deps.canRemember,
    readGrants: () => deps.grants.read(workspace),
    // Only what this answer adds, merged into the store as it is when written.
    writeGrants: async (grants) => {
      const held = deps.grants.read(workspace)
      await deps.grants.add(
        workspace,
        [...grants].filter((feature) => !held.has(feature)),
      )
    },
    ask: async (request, canRemember) => {
      const question = await paidUseQuestion(request)
      const always = canRemember ? [UI_TEXT.paidAllowAlways] : []
      const answer = await deps.ask(`${question.title}\n\n${question.detail}`, [
        UI_TEXT.allowOnce,
        ...always,
        UI_TEXT.paidDeny,
      ])
      if (answer === UI_TEXT.allowOnce) return 'once'
      return canRemember && answer === UI_TEXT.paidAllowAlways ? 'always' : 'deny'
    },
    onNotKept: (notice) => {
      deps.notify(
        fill(UI_TEXT.paidAlwaysNotKept, {
          feature: paidFeatureName(notice.feature),
          kind: paidStoreReasonText(notice.kind),
        }),
      )
    },
    log: deps.log,
  })
  return createTabConsent({
    priceOf: tabPriceFingerprint,
    ask: (model) => paid.askScope({ feature: 'tab', modelId: model, budgetUsd: deps.budgetUsd }),
    isOn: () => deps.isOn(),
    isRemembered: () => paid.isRemembered('tab'),
    windowOnceToken: () => paid.windowOnceToken('tab'),
    revocations: () => paid.revocations('tab'),
    readAlways: () => readAlways(deps.alwaysFile, deps.log),
    writeAlways: async (record) => {
      if (record === undefined) {
        await rm(deps.alwaysFile, { force: true })
        return
      }
      await writeFileAtomically(deps.alwaysFile, JSON.stringify(record), {
        sleep: (ms) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms)
          }),
      })
    },
    log: deps.log,
  })
}
