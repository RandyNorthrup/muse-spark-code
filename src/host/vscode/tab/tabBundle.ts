import { Usd, isPositiveUsd, type UsdAmount } from '../../../shared/usd'
// Tab completions as the activation bundle sees them (M94, PLAN.md D73):
// dist/tab.js, built from tabEntry.ts and required on the first Tab request
// (PLAN.md D6). Only types cross from the lazy side into activation: a value
// imported from that side would carry the provider, the
// engine (lane C) and the ledger (lane L) back into dist/extension.js, which
// the bundle-split gate refuses. The bundle builds the engine and the spend
// gate itself (`createTabServices`) from what activation hands it: the key
// client's stream, the ledger's folder and this window's id. The provider
// builds lane L's paid question from the handed deps on its first request,
// and lane K's guard and dispatch bridge are constructed inside the lazy
// Tab bundle. Activation keeps the tally.

import type * as vscode from 'vscode'
import type { TabHookContext, TabHookPolicy, TabHooksDeps } from '../../../core/tab/tabHooks'
import type { ExtensionHookRunner } from '../../extensionHooksRunner'
import type {
  TabEngine,
  TabEngineRequest,
  TabEngineUsage,
  TabStream,
} from '../../../core/tab/tabEngine'
import { COMMAND_IDS } from '../../../shared/constants'
import type { UiText } from '../../../shared/l10n/en'
import type { Logger } from '../../logger'
import type { TabConsentDeps, TabConsentScope } from '../../tab/tabConsent'
import type { ModelPricePolicy, ResolvedModel } from '../../../core/backends/modelapi/modelPolicy'
import type { TabByoQuote } from '../../../shared/paid'
import type { TabByoResolutions } from '../../tab/tabByo'
import { tabLoader } from '../../tab/tabLoader'
import { createTabSnooze, type TabSnooze, type TabSnoozeStore } from '../../tab/tabSnooze'

// dist/tab.js beside the running bundle (PLAN.md D6). Lane W's build entry
// writes it; the loader only needs the name.
export const TAB_BUNDLE_FILE = 'tab.js'

// The five commands lane W contributes to package.json (M94 scope). The
// sixth, the item's accept command, stays out of the palette: it only ever
// runs from a suggestion the provider returned.
export const TAB_COMMAND_IDS = {
  turnOn: COMMAND_IDS.tabTurnOn,
  turnOff: COMMAND_IDS.tabTurnOff,
  snooze: COMMAND_IDS.tabSnooze,
  menu: COMMAND_IDS.tabMenu,
  languages: COMMAND_IDS.tabLanguages,
  afterAccept: 'museSpark.tabAfterAccept',
} as const

/**
Consent's deps as activation hands them over (the price fingerprint is
the bundle's own): D48's question takes the request's model and, for a
bring-your-own model, its provider's card to quote (M95c part 7).
*/
export type TabConsentQuestionDeps = Omit<TabConsentDeps, 'priceOf' | 'ask'> & {
  readonly ask: (model: string, byo?: TabByoQuote) => Promise<TabConsentScope | undefined>
}

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

/** The last failure's class, fixed technical words (never code or a path). */
export const TAB_FAILURE_KINDS = ['load', 'request'] as const
export type TabFailureKind = (typeof TAB_FAILURE_KINDS)[number]

/** The provider's dependencies: activation-side values plus the lane seams. */
export interface TabProviderDeps {
  /** The validated Tab settings, read live (machine-scoped, D73). */
  readonly settings: () => {
    readonly tabModel: string
    readonly tabMaxOutputTokens: number
    readonly tabLanguages: Readonly<Record<string, boolean>>
    readonly tabMultiline: 'auto' | 'onInvoke' | 'never'
    readonly tabTrigger: 'automatic' | 'onInvoke'
    readonly tabWithCopilot: 'yield' | 'both'
  }
  /**
  The provider's maximum output tokens for a Tab model, from its
  capability record (activation's side, so the record machinery stays
  out of the lazy bundle).
  */
  readonly recordMaxOutputTokens: (model: string) => number
  /** Bring-your-own Tab models (M95c part 7): resolved per request through the configured providers. */
  readonly byo: TabByoResolutions
  /** The paid gate's answer for `tab` (M33): the setting on and the price accepted. */
  readonly isPaidOn: () => boolean
  /** A Model API key is stored, as last read (M44): never read here, never asked for. */
  readonly isKeyStored: () => boolean
  /** The trusted-workspace posture (D13). */
  readonly isTrusted: () => boolean
  /** The snooze tabStatus.ts keeps; while set the provider stays quiet. */
  readonly isSnoozed: () => boolean
  /**
  Resolves an absolute path through links (`canonicalPath` in production);
  rejects when it cannot. A file whose target leaves its workspace folder,
  or whose target is private, is never read (RVM94HU 12).
  */
  readonly realPath: (absolutePath: string) => Promise<string>
  /** Non-`museSpark` configuration the yield reads (`github.copilot`, `chat`). */
  readonly foreignSetting: (section: string, key: string) => unknown
  /** Whether a Copilot extension is installed and active (`extensions.getExtension`). */
  readonly isCopilotExtensionPresent: () => boolean
  /** `files.exclude` for the file's scope, as VS Code configured it (conditions kept). */
  readonly filesExclude: (uri: TabUri) => TabFilesExclude
  /**
  Whether a file exists at an absolute path: the ignore files, and the
  sibling a `files.exclude` `when` condition names.
  */
  readonly ignoreFileExists: (absolutePath: string) => boolean
  /** Runs git with `args` in `cwd` and resolves stdout; rejects on any failure. */
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** Absolute workspace folder paths, innermost first for the file. */
  readonly workspaceRoots: (absolutePath: string) => readonly string[]
  /** Clears the caller's ignore cache when an ignore file changes (a file watcher in production). */
  readonly onIgnoreFilesChanged: (clear: () => void) => { dispose(): void }
  /**
  Watches document changes for the inferred partial accept
  (`workspace.onDidChangeTextDocument`, subscribed raw; the provider
  projects the event inside the lazy bundle).
  */
  readonly onDidChangeTextDocument: (listener: (event: vscode.TextDocumentChangeEvent) => void) => {
    dispose(): void
  }
  /** Recently edited paths and line numbers; text is read only after eligibility. */
  readonly recentEdits?:
    (() => readonly { readonly uri: TabUri; readonly line: number }[]) | undefined
  /** Lane C's engine (the M94 integration branch injects it). */
  readonly engine: TabCompletionEngine
  /** Lane L's ledger (the M94 integration branch injects it). */
  readonly spend: TabSpendGate
  /**
  Lane L's once-per-window question: the provider builds it from these deps
  (the price fingerprint is the bundle's own). Activation hands them over;
  nothing is asked before the first request.
  */
  readonly consentDeps: TabConsentQuestionDeps
  /** An injected bridge; production constructs it in the lazy Tab bundle. */
  readonly hooks?: TabHookBridge | undefined
  readonly hookDispatch?:
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
    | undefined
  /** The outcome of each trigger: the status bar follows it. */
  readonly onOutcome: (outcome: TabOutcome) => void
  readonly log: Logger
}

/**
Over `vscode.Uri` in production (type-only: erased, so the activation
bundle carries none of the Tab side). Tests hand in the mock's `FakeUri`.
*/
export type TabUri = vscode.Uri

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

/** The provider's handle: the provider the shim registers, plus the accept command's entry. */
export interface TabProviderHandle {
  /**
  The provider itself. The shim holds the one registration and delegates
  to it, so dist/tab.js loads on the first request (D73, RVM94HU 7).
  */
  readonly provider: vscode.InlineCompletionItemProvider
  dispose(): void
  /**
  The item command's handler (`TAB_COMMAND_IDS.afterAccept`), registered
  once by the shim. Foreign args are ignored (a stale accept).
  */
  acceptNotified(args: unknown): void
}

/** What the item's command carries: everything the accept hook needs. */
export interface TabAcceptArgs {
  readonly filePath: string
  readonly generationId: string
  readonly model: string
  readonly positionLine: number
  readonly positionCharacter: number
  readonly completion: string
}

/** A machine-scoped Tab setting the menu writes (D73: no workspace widening). */
export const TAB_WRITABLE_SETTINGS = [
  'modelApiTab',
  'tabMultiline',
  'tabLanguages',
  'tabWithCopilot',
] as const
export type TabWritableSetting = (typeof TAB_WRITABLE_SETTINGS)[number]
export type TabSettingValue =
  boolean | 'auto' | 'onInvoke' | 'never' | 'yield' | 'both' | Readonly<Record<string, boolean>>

/** The status bar's dependencies: readers for every state D73 names. */
export interface TabStatusDeps {
  /** Whether the feature is on with its price accepted (the item shows only then). */
  readonly isOn: () => boolean
  readonly isKeyStored: () => boolean
  readonly isTrusted: () => boolean
  /** The active editor's language, for the language-off state. */
  readonly activeLanguageId: () => string | undefined
  /** Non-`museSpark` configuration the yield reads (`github.copilot`, `chat`). */
  readonly foreignSetting: (section: string, key: string) => unknown
  /** Whether a Copilot extension is installed and active. */
  readonly isCopilotExtensionPresent: () => boolean
  /** What Tab does where GitHub Copilot also suggests (`yield` or `both`). */
  readonly tabWithCopilot: () => 'yield' | 'both'
  /** Today's ledger total and request count (lane L, via the shim). */
  readonly todaySpend: () => { readonly totalUsd: UsdAmount; readonly requests: number }
  /** Whether the day's budget is reached (lane L, via the shim). */
  readonly isBudgetReached: () => boolean
  readonly model: () => string
  readonly budgetUsd: () => UsdAmount
  /** The snooze tabStatus.ts keeps (timed across windows, until-restart here). */
  readonly snooze: TabSnooze
  /** Writes a machine-scoped setting (Global target, never the workspace). */
  readonly updateSetting: (key: TabWritableSetting, value: TabSettingValue) => Promise<void>
  /** The `tabLanguages` table, for the Languages command. */
  readonly tabLanguages: () => Readonly<Record<string, boolean>>
  /** Every language VS Code knows (`languages.getLanguages`). */
  readonly knownLanguages: () => Promise<readonly string[]>
  /** The Copilot-disable confirmation; true writes `github.copilot.enable` for the language. */
  readonly confirmCopilotDisable: (languageId: string) => Promise<boolean>
  /** Writes `github.copilot.enable` off for the language (user settings, after confirmation). */
  readonly disableCopilotFor: (languageId: string) => Promise<void>
  /** Runs a command by id (the menu acts through the shim's registrations). */
  readonly runCommand: (command: string) => Promise<void>
  /** Opens Account & usage (the panel's view, where lane U adds the Tab row). */
  readonly openAccountUsage: () => Promise<void>
  /** The installed display table (D33: read when it runs, never at load). */
  readonly table: () => UiText
}

/** The status bar's handle: refresh on the shim's events, dispose with it. */
export interface TabStatusHandle {
  /** Re-reads every state and redraws the item. */
  refresh(): void
  /** The menu, run from the item's command registered once by the shim. */
  showMenu(): Promise<void>
  /** The provider's outcomes land here (spend, failures). */
  noteOutcome(outcome: TabOutcome): void
  dispose(): void
}

/** The installed display table each bundle entry takes (D33). */
export interface TabBundleTable {
  readonly uiTable: UiText
  readonly locale: string
}

/** The Languages command's dependencies (over the shim's readers and writers). */
export interface TabLanguagesCommandDeps {
  /** Every language VS Code knows (`languages.getLanguages`). */
  readonly languages: () => Promise<readonly string[]>
  readonly tabLanguages: () => Readonly<Record<string, boolean>>
  readonly updateSetting: TabStatusDeps['updateSetting']
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

/** The engine (lane C) and the spend gate over the ledger (lane L), built in the bundle. */
export interface TabServices {
  readonly recentEdits?:
    (() => readonly { readonly uri: TabUri; readonly line: number }[]) | undefined
  readonly engine: TabCompletionEngine
  readonly spend: TabSpendGate
}

/**
Defers the secret read (`refreshKeyPresence`, PLAN.md D73) to the first
view, panel, command or Tab request: the first call runs the refresh, and
every call answers its one promise, so a Tab request can wait for the
read instead of finding no key. Activation with no view, panel or Tab
request then reads no secret, starts no process and requires no lazy
bundle.
*/
export function deferredRefresh(refresh: () => Promise<void> | void): () => Promise<void> {
  let started: Promise<void> | undefined
  return () => {
    started ??= Promise.resolve(refresh())
    return started
  }
}

// --- The activation shim (the Tab region of src/extension.ts delegates here) ---
//
// With the setting off: no registration, no bundle load, no request, no
// secret read, no process. The five user commands register always (cheap,
// synchronous, secret-free). With it on (the default), the shim registers
// the one inline completion provider and sets `museSpark.tabOn` at once,
// but the secret read and dist/tab.js wait for the first request or Tab
// command (D73, RVM94HU 7). The bundle builds the engine and the spend gate
// (`createTabServices`); the paid question stays in activation.

// Extension-private global state (never machine-wide configuration): the
// timed snooze's end, in epoch milliseconds, shared by every window.
export const TAB_SNOOZE_STATE_KEY = 'museSpark.tabSnoozedUntil'

// Extension-private workspace state: Tab's one Always record, its model and
// price (RVM94KR2). The earlier model-only key is never read: a grant it sat
// beside asks once again.
export const TAB_CONSENT_STATE_KEY = 'museSpark.tabConsent'

// The ledger's folder under the extension's global storage (D73:
// `tab-spend/<date>/<window>.json`).
export const TAB_LEDGER_DIR = 'tab-spend'

export interface TabActivationDeps {
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
  /** `museSpark.modelApiTab`, as the settings reader validated it. */
  readonly isTabSettingOn: () => boolean
  readonly tabSettings: () => {
    readonly tabModel: string
    readonly tabMaxOutputTokens: number
    readonly tabLanguages: Readonly<Record<string, boolean>>
    readonly tabMultiline: 'auto' | 'onInvoke' | 'never'
    readonly tabTrigger: 'automatic' | 'onInvoke'
    readonly tabWithCopilot: 'yield' | 'both'
    readonly tabDailyBudgetUsd: UsdAmount
  }
  /** The paid gate's answer for `tab`: the setting on and the price accepted. */
  readonly isPaidOn: () => boolean
  /** A Model API key is stored, as last read: never read here, never asked for. */
  readonly isKeyStored: () => boolean
  readonly isTrusted: () => boolean
  /** The deferred secret read: runs once, on the first Tab request or command; settles when read. */
  readonly ensureKeyPresence: () => Promise<void>
  readonly updateSetting: TabStatusDeps['updateSetting']
  /** Registers one command; the shim pushes the disposable to subscriptions. */
  readonly registerCommand: (
    id: string,
    run: (...args: readonly unknown[]) => unknown,
  ) => { dispose(): void }
  /** Resolves an absolute path through links; rejects when it cannot. */
  readonly realPath: (absolutePath: string) => Promise<string>
  /** Non-`museSpark` configuration the yield reads (`github.copilot`, `chat`). */
  readonly foreignSetting: (section: string, key: string) => unknown
  /** Whether a Copilot extension is installed and active. */
  readonly isCopilotExtensionPresent: () => boolean
  /** `files.exclude` for the file's scope, as VS Code configured it (conditions kept). */
  readonly filesExclude: (uri: TabUri) => TabFilesExclude
  /**
  Registers the one inline completion provider for `file` documents
  (`languages.registerInlineCompletionItemProvider` in production).
  */
  readonly registerProvider: (provider: vscode.InlineCompletionItemProvider) => {
    dispose(): void
  }
  /** Sets the `museSpark.tabOn` context key the Alt+\ binding reads. */
  readonly setTabOnContext: (isOn: boolean) => void
  /** Absolute workspace folder paths holding the file, innermost first. */
  readonly workspaceRoots: (absolutePath: string) => readonly string[]
  /** Whether an ignore file exists at an absolute path. */
  readonly ignoreFileExists: (absolutePath: string) => boolean
  /** Runs git with `args` in `cwd` and resolves stdout; rejects on any failure. */
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** Clears the ignore cache when an ignore file changes. */
  readonly onIgnoreFilesChanged: (clear: () => void) => { dispose(): void }
  /** Watches document changes for the inferred partial accept (subscribed raw). */
  readonly onDidChangeTextDocument: (listener: (event: vscode.TextDocumentChangeEvent) => void) => {
    dispose(): void
  }
  readonly activeLanguageId: () => string | undefined
  readonly knownLanguages: () => Promise<readonly string[]>
  readonly confirmCopilotDisable: (languageId: string) => Promise<boolean>
  readonly disableCopilotFor: (languageId: string) => Promise<void>
  readonly openAccountUsage: () => Promise<void>
  /** Runs a command by id (the status menu acts through the shim's registrations). */
  readonly runCommand: (command: string) => Promise<void>
  /** The installed display table and locale (D33: read when they run). */
  readonly table: () => UiText
  readonly locale: () => string
  readonly snoozeStore: TabSnoozeStore
  /** What the bundle's engine and spend gate are built from (the budget and log are added here). */
  readonly recentEdits?: TabProviderDeps['recentEdits']
  readonly services: Omit<TabServicesDeps, 'budgetUsd' | 'onTotalChanged' | 'log'>
  /** Today's ledger total moved: Account & usage follows (RVM94HU 23). */
  readonly onTodayTotalChanged?: (() => void) | undefined
  /**
  Lane L's once-per-window question (Q-M94a, D48): the first request asks
  with the price and the daily budget; nothing is sent before the answer.
  The provider builds it from these deps inside the lazy bundle.
  */
  readonly consentDeps: TabConsentQuestionDeps
  /** An injected bridge; production constructs it in the lazy Tab bundle. */
  readonly hooks?: TabHookBridge | undefined
  readonly hookDispatch?: TabProviderDeps['hookDispatch']
  /** Creates the status bar item (`createTabStatusItem` in production). */
  readonly createStatus: (deps: TabStatusDeps, showMenu: () => Promise<void>) => TabStatusHandle
  /**
  Hitting the daily budget is never silent: one notice per day naming the
  spend, the budget and how to raise it, with a direct way into Settings.
  */
  readonly notifyBudgetReached: (spent: UsdAmount, budget: UsdAmount) => void
}

/**
What the lazy bundle wires a loaded Tab from: activation's readers, the
armed status and snooze, and the resolved table and locale. Activation
passes its own deps through (`{ ...deps, status, snooze, uiTable,
locale }`); the bundle picks what it wires.
*/
export interface TabLoadedWiring {
  readonly statusDeps: TabStatusDeps
  readonly tabSettings: TabActivationDeps['tabSettings']
  readonly isPaidOn: TabActivationDeps['isPaidOn']
  readonly isKeyStored: TabActivationDeps['isKeyStored']
  readonly isTrusted: TabActivationDeps['isTrusted']
  readonly realPath: TabActivationDeps['realPath']
  readonly foreignSetting: TabActivationDeps['foreignSetting']
  readonly isCopilotExtensionPresent: TabActivationDeps['isCopilotExtensionPresent']
  readonly filesExclude: TabActivationDeps['filesExclude']
  readonly workspaceRoots: TabActivationDeps['workspaceRoots']
  readonly ignoreFileExists: TabActivationDeps['ignoreFileExists']
  readonly runGit: TabActivationDeps['runGit']
  readonly onIgnoreFilesChanged: TabActivationDeps['onIgnoreFilesChanged']
  readonly onDidChangeTextDocument: TabActivationDeps['onDidChangeTextDocument']
  readonly recentEdits?: TabActivationDeps['recentEdits']
  readonly knownLanguages: TabActivationDeps['knownLanguages']
  readonly updateSetting: TabActivationDeps['updateSetting']
  readonly services: TabActivationDeps['services']
  readonly onTodayTotalChanged?: TabActivationDeps['onTodayTotalChanged']
  readonly consentDeps: TabActivationDeps['consentDeps']
  readonly hooks?: TabActivationDeps['hooks']
  readonly hookDispatch?: TabActivationDeps['hookDispatch']
  readonly notifyBudgetReached: TabActivationDeps['notifyBudgetReached']
  readonly log: TabActivationDeps['log']
  readonly status: TabStatusHandle
  readonly snooze: TabSnooze
  readonly uiTable: UiText
  readonly locale: string
}

/** A loaded Tab: the provider, the spend gate and the command runners. */
export interface TabLoadedHandle {
  readonly provider: TabProviderHandle
  readonly spend: TabSpendGate
  showMenu(): Promise<void>
  runSnooze(): Promise<void>
  runLanguages(): Promise<void>
  accept(args: unknown): void
  dispose(): void
}

interface ActiveTab {
  readonly provider: TabProviderHandle
  readonly spend: TabSpendGate
  readonly status: TabStatusHandle
  readonly snooze: TabSnooze
  readonly showMenu: () => Promise<void>
  readonly runSnooze: () => Promise<void>
  readonly runLanguages: () => Promise<void>
  readonly accept: (args: unknown) => void
  dispose(): void
}

export interface TabActivation {
  /** Matches the running Tab to the setting: enables, or tears down. */
  refresh(): void
  /** Redraws the status bar (settings, editors and spend move under it). */
  refreshStatus(): void
  /** Whether dist/tab.js is loaded and its provider, status bar and services run. */
  readonly isActive: () => boolean
  /** Whether the one provider registration stands (the setting is on). */
  readonly isRegistered: () => boolean
  /** Today's cross-window ledger total once the bundle runs; undefined before (RVM94HU 23). */
  readonly todayTotalUsd: () => UsdAmount | undefined
  dispose(): void
}

/** The shim: commands always, the registration while the setting is on, the bundle on first use. */
export function createTabActivation(deps: TabActivationDeps): TabActivation {
  const load = tabLoader({
    bundlePath: deps.bundlePath,
    log: deps.log,
    loadBundle: deps.loadBundle,
  })
  let active: ActiveTab | undefined
  const snooze = createTabSnooze(deps.snoozeStore)
  let status: TabStatusHandle | undefined

  let registration: { dispose(): void } | undefined

  const statusDeps: TabStatusDeps = {
    isOn: deps.isTabSettingOn,
    isKeyStored: deps.isKeyStored,
    isTrusted: deps.isTrusted,
    activeLanguageId: deps.activeLanguageId,
    foreignSetting: deps.foreignSetting,
    isCopilotExtensionPresent: deps.isCopilotExtensionPresent,
    tabWithCopilot: () => deps.tabSettings().tabWithCopilot,
    todaySpend: () => ({
      totalUsd: active?.spend.todayTotalUsd() ?? Usd.from(0).toAmount(),
      requests: active?.spend.todayRequests() ?? 0,
    }),
    // 0 is no budget: nothing is ever reached, so the bar never warns.
    isBudgetReached: () => {
      const budget = deps.tabSettings().tabDailyBudgetUsd
      return (
        isPositiveUsd(budget) &&
        Usd.from(active?.spend.todayTotalUsd() ?? 0).compare(Usd.from(budget)) >= 0
      )
    },
    model: () => deps.tabSettings().tabModel,
    budgetUsd: () => deps.tabSettings().tabDailyBudgetUsd,
    snooze,
    updateSetting: deps.updateSetting,
    tabLanguages: () => deps.tabSettings().tabLanguages,
    knownLanguages: deps.knownLanguages,
    confirmCopilotDisable: deps.confirmCopilotDisable,
    disableCopilotFor: deps.disableCopilotFor,
    runCommand: (command) => deps.runCommand(command),
    openAccountUsage: deps.openAccountUsage,
    table: deps.table,
  }

  function ensureLoaded(): ActiveTab | undefined {
    if (active !== undefined) {
      return active
    }
    if (!deps.isTabSettingOn()) {
      return undefined
    }
    void deps.ensureKeyPresence()
    const bundle = load()
    const currentStatus = status
    if (currentStatus === undefined) {
      throw new Error('Tab status is not armed')
    }
    // The wiring lives in the lazy bundle; the shim only passes its deps
    // through on the first request.
    const loaded = bundle.createTabLoaded({
      ...deps,
      statusDeps,
      status: currentStatus,
      snooze,
      uiTable: deps.table(),
      locale: deps.locale(),
    })
    const handle: ActiveTab = {
      provider: loaded.provider,
      spend: loaded.spend,
      status: currentStatus,
      snooze,
      showMenu: () => loaded.showMenu(),
      runSnooze: () => loaded.runSnooze(),
      runLanguages: () => loaded.runLanguages(),
      accept: (args) => {
        loaded.accept(args)
      },
      dispose: () => {
        loaded.dispose()
      },
    }
    active = handle
    return handle
  }

  /**
  The one registration, delegating to the bundle's provider: the first
  request waits for the secret read, then loads dist/tab.js. A bundle that
  cannot load answers nothing (the loader logged why) and is tried again on
  the next request.
  */
  const delegating: vscode.InlineCompletionItemProvider = {
    provideInlineCompletionItems: async (document, position, context, token) => {
      await deps.ensureKeyPresence()
      let loaded: ActiveTab | undefined
      try {
        loaded = ensureLoaded()
      } catch {
        return []
      }
      return loaded === undefined
        ? []
        : await loaded.provider.provider.provideInlineCompletionItems(
            document,
            position,
            context,
            token,
          )
    },
  }

  function arm(): void {
    if (registration !== undefined) {
      return
    }
    status = deps.createStatus(statusDeps, async () => {
      await ensureLoaded()?.showMenu()
      status?.refresh()
    })
    registration = deps.registerProvider(delegating)
    deps.setTabOnContext(true)
  }

  function teardown(): void {
    registration?.dispose()
    const wasOn = registration !== undefined || active !== undefined
    registration = undefined
    active?.dispose()
    active = undefined
    status?.dispose()
    status = undefined
    if (wasOn) {
      // The Alt+\ binding goes with Tab (RVM94HU 8).
      deps.setTabOnContext(false)
    }
  }

  // The five user commands: always registered, secret-free and process-free.
  // The bundle loads only for an explicit Tab command or while the setting
  // is on; the accept command answers only while the provider runs.
  const commands = [
    deps.registerCommand(TAB_COMMAND_IDS.turnOn, async () => {
      await deps.updateSetting('modelApiTab', true)
    }),
    deps.registerCommand(TAB_COMMAND_IDS.turnOff, async () => {
      await deps.updateSetting('modelApiTab', false)
    }),
    deps.registerCommand(TAB_COMMAND_IDS.snooze, async () => {
      await ensureLoaded()?.runSnooze()
    }),
    deps.registerCommand(TAB_COMMAND_IDS.menu, async () => {
      await status?.showMenu()
    }),
    deps.registerCommand(TAB_COMMAND_IDS.languages, async () => {
      await ensureLoaded()?.runLanguages()
    }),
    deps.registerCommand(TAB_COMMAND_IDS.afterAccept, (...args: readonly unknown[]) => {
      active?.accept(args.at(0))
    }),
  ]

  return {
    refresh: () => {
      if (!deps.isTabSettingOn()) {
        teardown()
        return
      }
      // Registered at once, loaded on the first request (D73).
      arm()
    },
    refreshStatus: () => {
      status?.refresh()
    },
    isActive: () => active !== undefined,
    isRegistered: () => registration !== undefined,
    todayTotalUsd: () => active?.spend.todayTotalUsd(),
    dispose: () => {
      teardown()
      for (const command of commands) {
        command.dispose()
      }
    },
  }
}
