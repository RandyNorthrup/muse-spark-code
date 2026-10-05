// Tab completions as the activation bundle sees them (M94, PLAN.md D73):
// dist/tab.js, built from tabEntry.ts and required on the first Tab request
// (PLAN.md D6). Only types cross into the activation bundle here: a value
// imported from the Tab side would carry the provider, the status bar, the
// engine (lane C) and the ledger (lane L) back into dist/extension.js, which
// the bundle-split gate refuses. The bundle builds the engine and the spend
// gate itself (`createTabServices`) from what activation hands it: the key
// client's stream, the ledger's folder and this window's id. Activation
// keeps the paid question (lane L's PaidUseConsent) and the tally. Lane K's
// hooks stay an optional dependency until lane K lands.

import type * as vscode from 'vscode'
import type {
  TabEngine,
  TabEngineRequest,
  TabEngineUsage,
  TabStream,
} from '../../core/tab/tabEngine'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { fill } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'

// dist/tab.js beside the running bundle (PLAN.md D6). Lane W's build entry
// writes it; the loader only needs the name.
export const TAB_BUNDLE_FILE = 'tab.js'

// The five commands lane W contributes to package.json (M94 scope). The
// sixth, the item's accept command, stays out of the palette: it only ever
// runs from a suggestion the provider returned.
export const TAB_COMMAND_IDS = {
  turnOn: 'museSpark.tabTurnOn',
  turnOff: 'museSpark.tabTurnOff',
  snooze: 'museSpark.tabSnooze',
  menu: 'museSpark.tabMenu',
  languages: 'museSpark.tabLanguages',
  afterAccept: 'museSpark.tabAfterAccept',
} as const

// `github.copilot.enable` and `museSpark.tabLanguages` share one shape
// (V12): a per-language switch over a `'*'` default. Pure and dependency
// free, so the provider and the status bar share them without value imports
// across the bundle boundary.
export const TAB_LANGUAGE_WILDCARD = '*'

/** Whether Tab suggests in the language: the exact switch, else the wildcard, else on. */
export function isTabLanguageOn(
  languages: Readonly<Record<string, boolean>>,
  languageId: string,
): boolean {
  return languages[languageId] ?? languages[TAB_LANGUAGE_WILDCARD] ?? true
}

export interface CopilotPosture {
  readonly extensionPresent: boolean
  readonly enabledForLanguage: boolean
  readonly aiFeaturesDisabled: boolean
  readonly tabWithCopilot: 'yield' | 'both'
}

/**
 * Whether automatic Tab requests wait while Copilot is on for the language
 * (D73): yielded by default, while a Copilot extension is present,
 * `github.copilot.enable` is on for the language and AI features are not
 * turned off. Whether Copilot actually holds a token cannot be seen (V13).
 */
export function shouldYieldToCopilot(posture: CopilotPosture): boolean {
  return (
    posture.tabWithCopilot === 'yield' &&
    posture.extensionPresent &&
    posture.enabledForLanguage &&
    !posture.aiFeaturesDisabled
  )
}

/** Reads the posture around one language: installed and active, enabled, not disabled. */
export function readCopilotPosture(deps: {
  readonly isCopilotExtensionPresent: () => boolean
  readonly foreignSetting: (section: string, key: string) => unknown
  readonly tabWithCopilot: 'yield' | 'both'
  readonly languageId: string
}): CopilotPosture {
  const table = stringTableOf(deps.foreignSetting('github.copilot', 'enable'))
  const configured = table?.[deps.languageId] ?? table?.[TAB_LANGUAGE_WILDCARD]
  return {
    extensionPresent: deps.isCopilotExtensionPresent(),
    enabledForLanguage: configured !== false,
    aiFeaturesDisabled: deps.foreignSetting('chat', 'disableAIFeatures') === true,
    tabWithCopilot: deps.tabWithCopilot,
  }
}

/** A foreign setting's string-keyed table, if it parses as one. */
function stringTableOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const table: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  return table
}

/** A request the completion engine (lane C) may bill: facts only, no prices. */
export interface TabSpendFacts {
  /** The request's model, for the tier's rates. */
  readonly model: string
  /** The redacted window's UTF-8 bytes. */
  readonly inputBytes: number
  /** The mode's output cap, reasoning included. */
  readonly maxOutputTokens: number
}

/** Usage a finished request reported (the engine reads the stream's usage). */
export type TabReportedUsage = TabEngineUsage

/** One admitted request's reservation, settled with its own worst case. */
export interface TabReservation {
  readonly model: string
  readonly worstCaseUsd: number
}

/**
 * Lane L's spend side (src/host/tab/tabLedger.ts through tabSpendGate.ts,
 * M94): the hard daily budget across windows. `reserve` writes this
 * request's worst case first and returns its reservation only when it fits
 * (undefined: at the budget, or a missing, corrupt or unreadable ledger);
 * `settle` replaces that reservation with the reported usage (zero for a
 * request never sent; a request that never reports keeps it);
 * `todayTotalUsd` is what the status bar shows.
 */
export interface TabSpendGate {
  reserve(facts: TabSpendFacts): Promise<TabReservation | undefined>
  settle(reservation: TabReservation, usage: TabReportedUsage): void
  todayTotalUsd(): number
  todayRequests(): number
}

/**
 * Lane L's once-per-window question (Q-M94a, PLAN.md D48): Allow once covers
 * this window, Allow always persists for the workspace, Deny snoozes the
 * window. True proceeds, false sends nothing.
 */
export interface TabUseConsent {
  requestUse(): Promise<boolean>
}

/** What the provider hands the engine: the redacted window, its mode and the filters' lines. */
export type TabCompletionSnapshot = TabEngineRequest

/**
 * Lane C's completion pipeline (src/core/tab/tabEngine.ts, M94): the
 * typing-through cache, the debounce and caps, the request, and the
 * filters. The completion is already filtered; undefined means no
 * suggestion. It is published at the closing tag; `usage` settles when the
 * request ends, so the ledger stays exact even for a refusal the provider
 * drops. A sent request is never aborted: cancelling the token drops the
 * ghost text, never the request.
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
  /** 1-based, as Cursor sends them. */
  readonly oldLine: number
  readonly newLine: number
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
 * Lane K's hook bridge (M94 step 7, after M91 merges): `beforeRead` answers
 * whether a file's text may enter a request (every failure refuses, and an
 * oversize payload is refused unrun); `afterEdit` observes an accept and
 * never blocks. Absent until lane K lands: with no hooks configured every
 * read is allowed and every accept unobserved.
 */
export interface TabHookBridge {
  beforeRead(absolutePath: string, content: string): Promise<boolean>
  afterEdit(edit: TabAcceptedEdit): void
}

/** The last failure's class, fixed technical words (never code or a path). */
export const TAB_FAILURE_KINDS = ['load', 'request'] as const
export type TabFailureKind = (typeof TAB_FAILURE_KINDS)[number]

/** The provider's dependencies: activation-side values plus the lane seams. */
export interface TabProviderDeps {
  /** The validated Tab settings, read live (machine-scoped, D73). */
  readonly settings: () => {
    readonly tabModel: string
    readonly tabLanguages: Readonly<Record<string, boolean>>
    readonly tabMultiline: 'auto' | 'onInvoke' | 'never'
    readonly tabTrigger: 'automatic' | 'onInvoke'
    readonly tabWithCopilot: 'yield' | 'both'
  }
  /** The paid gate's answer for `tab` (M33): the setting on and the price accepted. */
  readonly isPaidOn: () => boolean
  /** A Model API key is stored, as last read (M44): never read here, never asked for. */
  readonly isKeyStored: () => boolean
  /** The trusted-workspace posture (D13). */
  readonly isTrusted: () => boolean
  /** The snooze tabStatus.ts keeps; while set the provider stays quiet. */
  readonly isSnoozed: () => boolean
  /** `rootRelativePath` over `vscode.Uri` (PLAN.md D27): undefined outside the folders. */
  readonly relativeInWorkspace: (uri: TabUri) => string | undefined
  /** Non-`museSpark` configuration the yield reads (`github.copilot`, `chat`). */
  readonly foreignSetting: (section: string, key: string) => unknown
  /** Whether a Copilot extension is installed and active (`extensions.getExtension`). */
  readonly isCopilotExtensionPresent: () => boolean
  /** `files.exclude` for the file's scope, as VS Code configured it. */
  readonly filesExclude: (uri: TabUri) => Readonly<Record<string, boolean>>
  /** Whether an ignore file exists at an absolute path (`fs.existsSync` in production). */
  readonly ignoreFileExists: (absolutePath: string) => boolean
  /** Runs git with `args` in `cwd` and resolves stdout; rejects on any failure. */
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** Absolute workspace folder paths, innermost first for the file. */
  readonly workspaceRoots: (absolutePath: string) => readonly string[]
  /** Clears the caller's ignore cache when an ignore file changes (a file watcher in production). */
  readonly onIgnoreFilesChanged: (clear: () => void) => { dispose(): void }
  /** Watches document changes for the inferred partial accept (`workspace.onDidChangeTextDocument`). */
  readonly onDidChangeTextDocument: (listener: (event: TabTextChangeEvent) => void) => {
    dispose(): void
  }
  /** Lane C's engine (the M94 integration branch injects it). */
  readonly engine: TabCompletionEngine
  /** Lane L's ledger (the M94 integration branch injects it). */
  readonly spend: TabSpendGate
  /** Lane L's once-per-window question (the M94 integration branch injects it). */
  readonly consent: TabUseConsent
  /** Lane K's hooks (absent until lane K lands). */
  readonly hooks?: TabHookBridge | undefined
  /** The outcome of each trigger: the status bar follows it. */
  readonly onOutcome: (outcome: TabOutcome) => void
  readonly log: Logger
}

/**
 * Over `vscode.Uri` in production (type-only: erased, so the activation
 * bundle carries none of the Tab side). Tests hand in the mock's `FakeUri`.
 */
export type TabUri = vscode.Uri

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
] as const
export type TabQuietReason = (typeof TAB_QUIET_REASONS)[number]

/** The provider's handle: registration plus the accept command's entry. */
export interface TabProviderHandle {
  dispose(): void
  /**
   * The item command's handler (`TAB_COMMAND_IDS.afterAccept`), registered
   * once by the shim. Foreign args are ignored (a stale accept).
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
  readonly todaySpend: () => { readonly totalUsd: number; readonly requests: number }
  /** Whether the day's budget is reached (lane L, via the shim). */
  readonly isBudgetReached: () => boolean
  readonly model: () => string
  readonly budgetUsd: () => number
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

/** The snooze the status bar keeps and the provider reads. */
export interface TabSnooze {
  /** True while a timed or until-restart snooze covers now. */
  isSnoozed(nowMs: number): boolean
  /** Whole minutes left, for the status text. */
  minutesLeft(nowMs: number): number | undefined
  /** Snooze every window until `nowMs + minutes`, kept in global state. */
  snoozeMinutes(minutes: number, nowMs: number): Promise<void>
  /** Snooze this window until it closes. */
  snoozeUntilRestart(): void
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

/** The snooze's store: the global-state end plus the clock. */
export interface TabSnoozeStore {
  /** The timed snooze's end the global state keeps, if it parses. */
  readSnoozedUntil(): number | undefined
  writeSnoozedUntil(endMs: number | undefined): Promise<void>
  nowMs(): number
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
  /** The ledger's folder: global storage's `tab-spend`. */
  readonly ledgerDirectory: string
  /** This window's ledger file name: letters, digits, `_` and `-` only. */
  readonly windowId: string
  /** `museSpark.tabDailyBudgetUsd`, read at each request. */
  readonly budgetUsd: () => number
  /** A request is about to be sent (PaidUsage counts it). */
  readonly onSent: (model: string) => void
  /** A request reported its usage (PaidUsage prices it). */
  readonly onUsage: (model: string, usage: TabReportedUsage) => void
  /** Today's total moved: the status bar redraws. */
  readonly onTotalChanged: () => void
  readonly log: Logger
}

/** The engine (lane C) and the spend gate over the ledger (lane L), built in the bundle. */
export interface TabServices {
  readonly engine: TabCompletionEngine
  readonly spend: TabSpendGate
}

/** What tabEntry.ts exports: the services, the snooze, the provider, the status and the menu commands. */
export interface TabBundle {
  createTabServices(deps: TabServicesDeps): TabServices
  createTabSnooze(store: TabSnoozeStore): TabSnooze
  createTabProvider(deps: TabProviderDeps & TabBundleTable): TabProviderHandle
  createTabStatus(deps: TabStatusDeps & TabBundleTable): TabStatusHandle
  snoozeTabCommand(snooze: TabSnooze, table: UiText, locale: string): Promise<void>
  tabLanguagesCommand(deps: TabLanguagesCommandDeps & TabBundleTable): Promise<void>
}

/** Whether a required module exports the Tab bundle's entries. */
export function isTabBundle(value: unknown): value is TabBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createTabServices' in value &&
    typeof value.createTabServices === 'function' &&
    'createTabSnooze' in value &&
    typeof value.createTabSnooze === 'function' &&
    'createTabProvider' in value &&
    typeof value.createTabProvider === 'function' &&
    'createTabStatus' in value &&
    typeof value.createTabStatus === 'function' &&
    'snoozeTabCommand' in value &&
    typeof value.snoozeTabCommand === 'function' &&
    'tabLanguagesCommand' in value &&
    typeof value.tabLanguagesCommand === 'function'
  )
}

export interface TabLoaderDeps {
  /** dist/tab.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required on the first Tab request and kept from then on. */
export function tabLoader(deps: TabLoaderDeps): () => TabBundle {
  return lazyBundleLoader({
    ...deps,
    log: {
      trace: (message) => {
        deps.log.trace(message)
      },
      info: (message) => {
        deps.log.info(message)
      },
      warn: (message) => {
        deps.log.warn(message)
      },
      // Paths never reach the log (Acceptance 20): fixed words, as the
      // import bundle's loader keeps them.
      error: (message) => {
        deps.log.error(
          message.includes('does not export')
            ? 'The Tab bundle does not export the Tab'
            : 'The Tab bundle could not be loaded',
        )
      },
    },
    isBundle: isTabBundle,
    label: 'Tab bundle',
    // No Tab-specific "unavailable" string is in lane 0's table: the sentence
    // is the table's own, and the {kind} slot it provides takes the fixed
    // technical class (AGENTS.md rule 5 allows the spliced technical detail).
    unavailable: () => fill(UI_TEXT.tabStatusError, { kind: 'load' }),
  })
}

/**
 * Defers the secret read (`refreshKeyPresence`, PLAN.md D73) to the first
 * view, panel, command or Tab request: the first call runs the refresh, the
 * rest are the cached flag's. Activation with no view or panel and Tab off
 * then reads no secret, starts no process and requires no lazy bundle.
 */
export function deferredRefresh(refresh: () => void): () => void {
  let isStarted = false
  return () => {
    if (isStarted) {
      return
    }
    isStarted = true
    refresh()
  }
}

// --- The activation shim (the Tab region of src/extension.ts delegates here) ---
//
// With the setting off: no bundle load, no request, no secret read, no
// process. The five user commands register always (cheap, synchronous,
// secret-free); the bundle, the provider, the status bar and the accept
// command load only for an explicit Tab command or while the setting is on.
// The bundle builds the engine and the spend gate (`createTabServices`);
// the paid question stays in activation with the paid features.

// Extension-private global state (never machine-wide configuration): the
// timed snooze's end, in epoch milliseconds, shared by every window.
export const TAB_SNOOZE_STATE_KEY = 'museSpark.tabSnoozedUntil'

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
    readonly tabLanguages: Readonly<Record<string, boolean>>
    readonly tabMultiline: 'auto' | 'onInvoke' | 'never'
    readonly tabTrigger: 'automatic' | 'onInvoke'
    readonly tabWithCopilot: 'yield' | 'both'
    readonly tabDailyBudgetUsd: number
  }
  /** The paid gate's answer for `tab`: the setting on and the price accepted. */
  readonly isPaidOn: () => boolean
  /** A Model API key is stored, as last read: never read here, never asked for. */
  readonly isKeyStored: () => boolean
  readonly isTrusted: () => boolean
  /** The deferred secret read: runs once, on the first enable or Tab command. */
  readonly ensureKeyPresence: () => void
  readonly updateSetting: TabStatusDeps['updateSetting']
  /** Registers one command; the shim pushes the disposable to subscriptions. */
  readonly registerCommand: (
    id: string,
    run: (...args: readonly unknown[]) => unknown,
  ) => { dispose(): void }
  readonly relativeInWorkspace: (uri: TabUri) => string | undefined
  /** Non-`museSpark` configuration the yield reads (`github.copilot`, `chat`). */
  readonly foreignSetting: (section: string, key: string) => unknown
  /** Whether a Copilot extension is installed and active. */
  readonly isCopilotExtensionPresent: () => boolean
  /** `files.exclude` for the file's scope, as VS Code configured it. */
  readonly filesExclude: (uri: TabUri) => Readonly<Record<string, boolean>>
  /** Absolute workspace folder paths holding the file, innermost first. */
  readonly workspaceRoots: (absolutePath: string) => readonly string[]
  /** Whether an ignore file exists at an absolute path. */
  readonly ignoreFileExists: (absolutePath: string) => boolean
  /** Runs git with `args` in `cwd` and resolves stdout; rejects on any failure. */
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** Clears the ignore cache when an ignore file changes. */
  readonly onIgnoreFilesChanged: (clear: () => void) => { dispose(): void }
  /** Watches document changes for the inferred partial accept. */
  readonly onDidChangeTextDocument: (listener: (event: TabTextChangeEvent) => void) => {
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
  readonly services: Omit<TabServicesDeps, 'budgetUsd' | 'onTotalChanged' | 'log'>
  /**
   * Lane L's once-per-window question (Q-M94a, D48): the first request asks
   * with the price and the daily budget; nothing is sent before the answer.
   */
  readonly consent: TabUseConsent
  /** Lane K's hooks (absent until lane K lands). */
  readonly hooks?: TabHookBridge | undefined
}

interface ActiveTab {
  readonly provider: TabProviderHandle
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
  readonly isActive: () => boolean
  dispose(): void
}

/** The shim: commands always, the bundle only while the setting is on. */
export function createTabActivation(deps: TabActivationDeps): TabActivation {
  const load = tabLoader({
    bundlePath: deps.bundlePath,
    log: deps.log,
    loadBundle: deps.loadBundle,
  })
  let active: ActiveTab | undefined

  function ensureLoaded(): ActiveTab | undefined {
    if (active !== undefined) {
      return active
    }
    if (!deps.isTabSettingOn()) {
      return undefined
    }
    deps.ensureKeyPresence()
    const bundle = load()
    const uiTable = deps.table()
    const locale = deps.locale()
    // The engine (lane C) and the ledger's spend gate (lane L) live in the
    // bundle; the status bar redraws when today's total moves.
    const { engine, spend } = bundle.createTabServices({
      ...deps.services,
      budgetUsd: () => deps.tabSettings().tabDailyBudgetUsd,
      onTotalChanged: () => {
        active?.status.refresh()
      },
      log: deps.log,
    })
    const consent = deps.consent
    const snooze = bundle.createTabSnooze(deps.snoozeStore)
    const status = bundle.createTabStatus({
      isOn: deps.isTabSettingOn,
      isKeyStored: deps.isKeyStored,
      isTrusted: deps.isTrusted,
      activeLanguageId: deps.activeLanguageId,
      foreignSetting: deps.foreignSetting,
      isCopilotExtensionPresent: deps.isCopilotExtensionPresent,
      tabWithCopilot: () => deps.tabSettings().tabWithCopilot,
      todaySpend: () => ({
        totalUsd: spend.todayTotalUsd(),
        requests: spend.todayRequests(),
      }),
      isBudgetReached: () => spend.todayTotalUsd() >= deps.tabSettings().tabDailyBudgetUsd,
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
      uiTable,
      locale,
    })
    const settingsOf = (): ReturnType<TabProviderDeps['settings']> => {
      const settings = deps.tabSettings()
      return {
        tabModel: settings.tabModel,
        tabLanguages: settings.tabLanguages,
        tabMultiline: settings.tabMultiline,
        tabTrigger: settings.tabTrigger,
        tabWithCopilot: settings.tabWithCopilot,
      }
    }
    const provider = bundle.createTabProvider({
      settings: settingsOf,
      isPaidOn: deps.isPaidOn,
      isKeyStored: deps.isKeyStored,
      isTrusted: deps.isTrusted,
      isSnoozed: () => snooze.isSnoozed(Date.now()),
      relativeInWorkspace: deps.relativeInWorkspace,
      foreignSetting: deps.foreignSetting,
      isCopilotExtensionPresent: deps.isCopilotExtensionPresent,
      filesExclude: deps.filesExclude,
      workspaceRoots: deps.workspaceRoots,
      ignoreFileExists: deps.ignoreFileExists,
      runGit: deps.runGit,
      onIgnoreFilesChanged: deps.onIgnoreFilesChanged,
      onDidChangeTextDocument: deps.onDidChangeTextDocument,
      engine,
      spend,
      consent,
      hooks: deps.hooks,
      onOutcome: (outcome) => {
        // Deny snoozes the window (Q-M94a): set it before the status redraws.
        if (outcome.kind === 'quiet' && outcome.reason === 'consent-denied') {
          snooze.snoozeUntilRestart()
        }
        status.noteOutcome(outcome)
      },
      log: deps.log,
      uiTable,
      locale,
    })
    const handle: ActiveTab = {
      provider,
      status,
      snooze,
      showMenu: () => status.showMenu(),
      runSnooze: () => bundle.snoozeTabCommand(snooze, uiTable, locale),
      runLanguages: () =>
        bundle.tabLanguagesCommand({
          languages: deps.knownLanguages,
          tabLanguages: () => deps.tabSettings().tabLanguages,
          updateSetting: deps.updateSetting,
          uiTable,
          locale,
        }),
      accept: (args) => {
        provider.acceptNotified(args)
      },
      dispose: () => {
        provider.dispose()
        status.dispose()
      },
    }
    active = handle
    return handle
  }

  function teardown(): void {
    if (active === undefined) {
      return
    }

    active.dispose()
    active = undefined
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
      await ensureLoaded()?.showMenu()
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
      if (active !== undefined) {
        return
      }
      // The loader already logged its fixed words; the next change retries.
      try {
        ensureLoaded()
      } catch {
        teardown()
      }
    },
    refreshStatus: () => {
      active?.status.refresh()
    },
    isActive: () => active !== undefined,
    dispose: () => {
      teardown()
      for (const command of commands) {
        command.dispose()
      }
    },
  }
}
