// Tab's portable contract (M94, PLAN.md D73): the spend, engine, hook and
// outcome shapes every host's Tab shares. Pure: no `vscode` import, so the
// language server (M104 lane H) composes RLF-TAB's modules without reaching
// the VS Code tree; tabBundle.ts re-exports all of it for VS Code's side.

import type { TabHookContext, TabHookPolicy, TabHooksDeps } from '../../core/tab/tabHooks'
import type {
  TabEngine,
  TabEngineRequest,
  TabEngineUsage,
  TabStream,
} from '../../core/tab/tabEngine'
import type { ModelPricePolicy, ResolvedModel } from '../../core/backends/modelapi/modelPolicy'
import type { UsdAmount } from '../../shared/usd'
import type { ExtensionHookRunner } from '../extensionHooksRunner'
import type { Logger } from '../logger'

// The ledger's folder under each host's own storage (D73:
// `tab-spend/<date>/<window>.json`).
export const TAB_LEDGER_DIR = 'tab-spend'

/** A request the completion engine (lane C) may bill: facts only, no prices. */
export interface TabSpendFacts {
  /** The request's model, for the tier's rates. */
  readonly model: string
  /** The redacted window's UTF-8 bytes. */
  readonly inputBytes: number
  /** The mode's output cap, reasoning included. */
  readonly maxOutputTokens: number
  /**
  A bring-your-own model's own price (M95c part 7): the provider resolved
  it before the reserve. Absent, the Meta tier's rates price the request.
  */
  readonly price?: ModelPricePolicy | undefined
}

/**
Usage a finished request reported (the engine reads the stream's usage);
a bring-your-own request carries its cost at its provider's card.
*/
export type TabReportedUsage = TabEngineUsage & { readonly costUsd?: UsdAmount | undefined }

/**
One admitted request's reservation, settled with its own worst case into
its own local day's ledger file, also after midnight (RVM94LC finding 1).
*/
export interface TabReservation {
  readonly model: string
  readonly worstCaseUsd: UsdAmount
  /** The admission's local day (`YYYY-MM-DD`), as the ledger named it. */
  readonly date: string
  /** The bring-your-own price the reserve admitted with, for the settlement. */
  readonly price?: ModelPricePolicy | undefined
}

/**
Lane L's spend side (src/host/tab/tabLedger.ts through tabSpendGate.ts,
M94): the hard daily budget across windows. `reserve` writes this
request's worst case first and returns its reservation only when it fits
(undefined: at the budget, or a missing, corrupt or unreadable ledger);
`settle` replaces that reservation with the reported usage (zero for a
request never sent; a request that never reports keeps it);
`todayTotalUsd` is what the status bar shows.
*/
export interface TabSpendGate {
  reserve(facts: TabSpendFacts): Promise<TabReservation | undefined>
  settle(reservation: TabReservation, usage: TabReportedUsage): void
  todayTotalUsd(): UsdAmount
  todayRequests(): number
}

/** What the provider hands the engine: the redacted window, its mode and the filters' lines. */
export type TabCompletionSnapshot = TabEngineRequest

/**
Lane C's completion pipeline (src/core/tab/tabEngine.ts, M94): the
typing-through cache, the debounce, the request, and the
filters. The completion is already filtered; undefined means no
suggestion. It is published at the closing tag; `usage` settles when the
request ends, so the ledger stays exact even for a refusal the provider
drops. A sent request is never aborted: cancelling the token drops the
ghost text, never the request.
*/
export type TabCompletionEngine = TabEngine

/** One accept lane K observes (src/core/tab/tabHooks.ts, M94 step 7). */
export interface TabAcceptedEdit {
  /** Absolute path of the edited file. */
  readonly filePath: string
  /** The Tab request's id. */
  readonly generationId: string
  /** The model the suggestion came from. */
  readonly model: string
  /** Actual line text around the accepted insertion. */
  readonly oldLine: string
  readonly newLine: string
  readonly workspaceRoots: readonly string[]
  /** 1-based start/end line and column. */
  readonly range: {
    readonly startLineNumber: number
    readonly startColumn: number
    readonly endLineNumber: number
    readonly endColumn: number
  }
  readonly oldString: string
  readonly newString: string
  /** True when the accept was inferred from typing, not from the command. */
  readonly inferred: boolean
}

/**
Lane K's hook bridge (M94 step 7, after M91 merges): `beforeRead` answers
whether a file's text may enter a request (every failure refuses, and an
oversize payload is refused unrun); `afterEdit` observes an accept and
never blocks. With no hook configuration at all every read is allowed and
every accept is unobserved; a hook file that did not load whole refuses
every read (RVM94KR 1).
*/
export interface TabHookBridge {
  beforeRead(absolutePath: string, content: string, context: TabHookContext): Promise<boolean>
  afterEdit(edit: TabAcceptedEdit): void
  /** Settles the hook configuration in force; a request binds to it at its start (RVM94KR 2). */
  bindPolicy(): Promise<TabHookPolicy>
  /** The hook policy's key now: a request whose bound key moved is dropped. */
  policyKey(): string
  dispose?(): void
}

/** The hook runner as a host hands it over: a ready dispatch, or a loader of the runner. */
export type TabHookDispatch =
  | Omit<TabHooksDeps, 'isWorkspaceTrusted' | 'log'>
  | {
      readonly isHooksEnabled: () => boolean
      readonly load: () => Promise<
        | Pick<
            ExtensionHookRunner,
            'configurationVersion' | 'isReloading' | 'tabHookState' | 'runTab'
          >
        | undefined
      >
    }

/** The last failure's class, fixed technical words (never code or a path). */
export const TAB_FAILURE_KINDS = ['load', 'request'] as const
export type TabFailureKind = (typeof TAB_FAILURE_KINDS)[number]

/**
A `files.exclude` table as VS Code reads it: a switch per glob, or a
condition (`{ "when": "$(basename).ts" }`) that excludes a match only
while the named sibling exists (RVM94HU 14).
*/
export type TabFilesExclude = Readonly<Record<string, boolean | { readonly when: string }>>

/** One document change the provider watches (over `vscode.TextDocumentChangeEvent` in production). */
export interface TabDocumentChange {
  readonly uriString: string
  readonly insertedText: string
  /** The change's range: a pure insertion has start equal to end. */
  readonly startLine: number
  readonly startCharacter: number
  readonly endLine: number
  readonly endCharacter: number
}

/** A document-change event: the provider watches for inferred partial accepts. */
export interface TabTextChangeEvent {
  readonly changes: readonly TabDocumentChange[]
}

/** What a trigger did: served, quiet, or the failure's class. Pure counts for the log. */
export type TabOutcome =
  | { readonly kind: 'served'; readonly mode: 'fast' | 'multiline' }
  | { readonly kind: 'quiet'; readonly reason: TabQuietReason }
  | { readonly kind: 'failed'; readonly failure: TabFailureKind }

/** Every reason the provider sends nothing (Acceptance 3–4 and the seams). */
export const TAB_QUIET_REASONS = [
  'suggest-selection',
  'trigger-setting',
  'snoozed',
  'no-key',
  'paid-off',
  'consent-denied',
  'untrusted',
  'scheme',
  'outside-workspace',
  'language-off',
  'copilot',
  'ineligible-file',
  'budget',
  'no-suggestion',
  'cancelled-before-send',
  'secret-at-cursor',
  // A hook file is present but did not load whole (RVM94KR 1).
  'hooks-invalid',
  // Trust, a Tab setting, files.exclude or the hooks changed under the request (RVM94KR 2–3).
  'policy-changed',
  // M95c part 7: the `provider/model` Tab model names nothing configured, or no output cap is known.
  'unknown-model',
  // M95c part 7: the bring-your-own model has no price card, so nothing can be reserved.
  'unpriced',
] as const
export type TabQuietReason = (typeof TAB_QUIET_REASONS)[number]

/** What the item's command carries: everything the accept hook needs. */
export interface TabAcceptArgs {
  readonly filePath: string
  readonly generationId: string
  readonly model: string
  readonly positionLine: number
  readonly positionCharacter: number
  readonly completion: string
}

/** What the bundle builds its engine and spend gate from (activation's side). */
export interface TabServicesDeps {
  /** The activation bundle's key client stream (M57 keeps it there for M44). */
  readonly stream: TabStream
  /**
  Resolves a bring-your-own `provider/model` Tab model through the
  person's configured providers (M95c part 7), with the agent turn's
  tool-calling gate opted out: a completion sends no tools.
  */
  readonly resolveByo: (ref: string) => Promise<ResolvedModel>
  /**
  The provider's maximum output tokens for a Tab model, from its
  capability record (M94 goal, D121). The provider sends this unless the
  person set `museSpark.tabMaxOutputTokens` lower.
  */
  readonly recordMaxOutputTokens: (model: string) => number
  /** The ledger's folder: global storage's `tab-spend`. */
  readonly ledgerDirectory: string
  /** This window's ledger file name: letters, digits, `_` and `-` only. */
  readonly windowId: string
  /** `museSpark.tabDailyBudgetUsd`, read at each request; 0 is no budget. */
  readonly budgetUsd: () => UsdAmount
  /** A request is about to be sent (PaidUsage counts it). */
  readonly onSent: (model: string) => void
  /** A request reported its usage (PaidUsage prices it). */
  readonly onUsage: (model: string, usage: TabReportedUsage) => void
  /** Today's total moved: the status bar redraws. */
  readonly onTotalChanged: () => void
  /** Hitting the daily budget is never silent: called at most once per local day. */
  readonly onBudgetReached?: (spent: UsdAmount, budget: UsdAmount) => void
  readonly log: Logger
}

/** The engine (lane C) and the spend gate over the ledger (lane L). */
export interface TabEngineServices {
  readonly engine: TabCompletionEngine
  readonly spend: TabSpendGate
}
