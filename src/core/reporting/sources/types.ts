import type { UiText } from '../../../shared/l10n/en'
import type { UsdAmount } from '../../../shared/usdSchema'
// Normalized, scrubbed facts supplied by injected readers. These types are
// application contracts; upstream HTTP/MSP parsers stay with their source owners.
import * as z from 'zod/mini'
import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import type { SessionExport } from '../../export/sessionTransfer'
import type { PullRequest } from '../../git/github'
import type {
  ReportDocument,
  ReportOptions,
  ReportSection,
  ReportSourceRecord,
} from '../../../shared/reportSchema'

const factText = z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS))
const factCount = z.number().check(z.int(), z.nonnegative())
const missingFact = z.strictObject({ status: z.literal('unavailable'), reason: factText })

// Declarations, not executions: a required gate may have no journal entry.
export const reportRequiredGatesSchema = z.array(factText).check(z.maxLength(REPORT_MAX_ROWS))
export const reportPackageFactsSchema = z.strictObject({
  qualityScripts: z
    .array(z.strictObject({ name: factText, command: factText }))
    .check(z.maxLength(REPORT_MAX_ROWS)),
})
// The export reader retains these facts before portable items lose their turn ids.
// A legacy export cannot establish them; zero is reserved for an observed zero.
export const reportSessionActivitySchema = z.strictObject({
  turns: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('available'), count: factCount }),
    missingFact,
  ]),
  approvals: z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('available'),
      approved: factCount,
      denied: factCount,
      auto: factCount,
      expired: factCount,
    }),
    missingFact,
  ]),
})
// Null conclusion means the scoped run has not concluded; future words survive.
export const reportCiRunSchema = z.strictObject({
  ref: z.strictObject({ kind: z.enum(['head', 'default-branch', 'release-tag']), name: factText }),
  sha: factText,
  workflow: factText,
  conclusion: z.nullable(factText),
  url: z.url(),
})

export interface PlanLane {
  readonly id: string
  readonly scope: string
  readonly branch: string | null
  readonly state: 'merged' | 'inReview' | 'inProgress' | 'planned'
  readonly pullRequest: number | null
  readonly certification: string | null
  readonly hours: number | null
}
export interface PlanMilestone {
  readonly id: string
  readonly title: string
  readonly status:
    | 'planned'
    | 'building'
    | 'built'
    | 'certified'
    | 'merged'
    | 'released'
    | 'complete'
    | 'superseded'
    | 'waiting'
  readonly date: string
  readonly goal: string
  readonly dependencies: readonly string[]
  readonly lanes: readonly PlanLane[]
  readonly checklist: readonly { readonly text: string; readonly done: boolean }[]
  readonly requiredGates: z.infer<typeof reportRequiredGatesSchema>
}
export interface ReportQuestion {
  readonly id: string
  readonly text: string
  readonly milestoneIds: readonly string[]
  readonly state: 'open' | 'answered' | 'dismissed'
}
export interface PlanFacts {
  readonly format: 'plan-format-v1' | 'quality-ledger-v1' | 'none'
  readonly milestones: readonly PlanMilestone[]
  readonly questions: readonly ReportQuestion[]
  readonly risks: readonly {
    readonly id: string
    readonly text: string
    readonly milestoneIds: readonly string[]
  }[]
  readonly residuals: readonly { readonly id: string; readonly text: string }[]
  readonly releases: readonly {
    readonly version: string
    readonly date: string
    readonly text: string
  }[]
  readonly deliveryOrder: readonly {
    readonly id: string
    readonly needs: readonly string[]
    readonly reason: string
  }[]
  readonly drift: readonly {
    readonly code: string
    readonly line: number
    readonly detail: string
  }[]
}
export interface GitFacts {
  readonly head: string
  readonly defaultBranch: string
  readonly commits: readonly {
    readonly sha: string
    readonly at: string
    readonly subject: string
    readonly files: readonly string[]
  }[]
  readonly tags: readonly { readonly name: string; readonly commit: string; readonly at: string }[]
  readonly branches: readonly {
    readonly name: string
    readonly commit: string
    readonly merged: boolean
  }[]
  readonly worktrees: readonly {
    readonly path: string
    readonly branch: string
    readonly commit: string
  }[]
}
export interface UsageFacts {
  readonly period: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number | null
  readonly costUsd: UsdAmount | null
  readonly certainty: 'reported' | 'estimated' | 'unknown'
  readonly breakdown: readonly {
    readonly key: string
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costUsd: UsdAmount | null
    readonly certainty: 'reported' | 'estimated' | 'unknown'
  }[]
  readonly limits: readonly ({ readonly key: string; readonly resetsAt: string | null } & (
    | { readonly unit: 'usd'; readonly used: UsdAmount; readonly limit: UsdAmount }
    | { readonly unit?: 'percent'; readonly used: number; readonly limit: number }
  ))[]
}
export interface CheckRunRecord {
  readonly check: string
  readonly outcome: 'passed' | 'failed' | 'cancelled' | 'skipped'
  readonly durationMs: number
  readonly commit: string
  readonly at: string
}
// M108 binding: the provider registry with locally resolved labels, per
// account use, swaps and stops, and confirmations. Labels name accounts;
// no credential, key or vendor secret ever enters these facts.
export interface AccountsRegistryAccount {
  readonly id: string
  readonly label: string
  readonly order: number
  readonly limitGroup: string | null
  readonly thresholds: {
    readonly spendUsd: readonly { readonly period: string; readonly value: UsdAmount }[]
    readonly counts: readonly {
      readonly metric: 'inputTokens' | 'outputTokens' | 'requests'
      readonly period: string
      readonly value: number
    }[]
    readonly percents: readonly { readonly name: string; readonly value: number }[]
  }
}
export interface AccountsFacts {
  readonly providers: readonly {
    readonly provider: string
    readonly product: string
    readonly auth: string
    readonly accounts: readonly AccountsRegistryAccount[]
  }[]
  readonly usage: readonly {
    readonly provider: string
    readonly account: string
    readonly label: string
    readonly period: string
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costUsd: UsdAmount | null
    readonly certainty: 'reported' | 'estimated' | 'unknown'
  }[]
  readonly events: readonly {
    readonly type: 'swap' | 'stop' | 'spread'
    readonly provider: string
    readonly account: string
    readonly time: string
    readonly trigger: string
    readonly previousAccount: string | null
  }[]
  readonly confirmations: readonly {
    readonly provider: string
    readonly product: string
    readonly choice: 'confirm' | 'ownCapsOnly' | 'cancel'
    readonly answeredAt: string
  }[]
}
// M109 binding: vault aggregates and the developer audit. Counts, kinds,
// decisions and authorities only: no id, name, label, target, handle,
// digest, hash, mac or other value ever enters these facts.
export interface SecurityFacts {
  readonly vault: {
    readonly state:
      'uncreated' | 'setupPending' | 'locked' | 'unlocked' | 'unavailable' | 'firstPartyOnly'
    readonly tier: string | null
    readonly itemCount: number
    readonly itemsByKind: readonly { readonly kind: string; readonly count: number }[]
    readonly grants: readonly { readonly scope: string; readonly count: number }[]
  } | null
  readonly audit: readonly {
    readonly kind: string
    readonly decision: 'allow' | 'deny' | 'ask'
    readonly authority: string
    readonly outcome: string
  }[]
  readonly developerAudit: readonly {
    readonly action: string
    readonly source: string
  }[]
}
export interface ReportSourcePayloads {
  readonly plan: PlanFacts
  readonly package: z.infer<typeof reportPackageFactsSchema>
  readonly git: GitFacts
  readonly changelog: {
    readonly sections: readonly {
      readonly version: string
      readonly date: string | null
      readonly lines: readonly string[]
    }[]
  }
  readonly certification: {
    readonly records: readonly {
      readonly path: string
      readonly milestoneId: string
      readonly checklist: readonly { readonly text: string; readonly done: boolean }[]
    }[]
  }
  readonly session: {
    readonly export: SessionExport
    readonly activity: z.infer<typeof reportSessionActivitySchema>
    readonly backend: string
    readonly usage: UsageFacts
    readonly checkRuns: readonly CheckRunRecord[]
  }
  // M112 binding: its registry adapter supplies only these reporting facts.
  readonly questions: readonly ReportQuestion[]
  // M102 binding: aggregate.ts's adapter supplies certainty and capability facts.
  readonly usage: UsageFacts
  readonly agentUsage: readonly {
    readonly agent: string
    readonly file: string
    readonly usage: UsageFacts
  }[]
  readonly checkRuns: readonly CheckRunRecord[]
  readonly github: {
    readonly pullRequests: readonly PullRequest[]
    readonly runs: readonly z.infer<typeof reportCiRunSchema>[]
    readonly releases: readonly {
      readonly version: string
      readonly commit: string
      readonly at: string
      readonly assets: readonly string[]
    }[]
  }
  readonly stores: readonly {
    readonly channel: string
    readonly version: string | null
    readonly url: string
    readonly status: 'current' | 'lagging' | 'unavailable'
    readonly reason: string | null
  }[]
  // Later milestones supply report rows, through these ports, when available.
  readonly fleet: readonly ReportSection[]
  // C-M113-3: M109's vault audit and the developer audit, never a value.
  readonly security: SecurityFacts
  // C-M113-3: M108's registry, use, swaps and stops, and confirmations.
  readonly accounts: AccountsFacts
  readonly estimate: readonly ReportSection[]
  readonly playbook: readonly ReportSection[]
  readonly issues: readonly ReportSection[]
  readonly schedules: readonly ReportSection[]
  readonly keybindings: readonly ReportSection[]
}
export type ReportSourceKind = keyof ReportSourcePayloads

// An unavailable or inapplicable source cannot masquerade as empty success.
export type SourceResult<T> =
  | { readonly record: Extract<ReportSourceRecord, { status: 'ok' | 'partial' }>; readonly data: T }
  | {
      readonly record: Extract<ReportSourceRecord, { status: 'unavailable' | 'notApplicable' }>
      readonly data: null
    }

export interface SourceReadContext {
  /** Captured once by the request owner, also across lazy bundle boundaries. */
  readonly reportText: UiText

  /** The BCP-47 locale of reportText, for locale-sensitive formatting. */
  readonly locale: string

  /** Identity shared by all reads in one generation, including refreshes at the same stamp. */
  readonly run?: object

  readonly asOf: string
  readonly workspaceKey: string
  readonly options: ReportOptions
  readonly signal: AbortSignal

  /**
  Last instant (epoch milliseconds) a source may start new work, only when
  the caller hands one in: the read's signal aborts at it and no new read,
  write or publish starts past it. There is no default of ours (D121/D208):
  absent, a read runs until it settles or `signal` aborts.
  */
  readonly deadline?: number
}
export interface ReportSourcePort<K extends ReportSourceKind> {
  readonly kind: K
  readonly id: string
  read(context: SourceReadContext): Promise<SourceResult<ReportSourcePayloads[K]>>
}
export type ReportSourcePorts = {
  readonly [K in ReportSourceKind]: ReportSourcePort<K>
}
export interface SourceSnapshot {
  readonly asOf: string
  readonly workspaceKey: string
  readonly generatorVersion: string
  readonly rendererVersion: string
  readonly icuVersion: string
  readonly locale: string
  readonly sources: { readonly [K in ReportSourceKind]: SourceResult<ReportSourcePayloads[K]> }
}
export type ReportCollector = (snapshot: SourceSnapshot, options: ReportOptions) => ReportDocument
