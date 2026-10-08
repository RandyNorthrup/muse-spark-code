// The "/" command palette: a registry of actions grouped the way the Claude
// Code panel groups them (Context / Model / Customize / Account & usage /
// Skills / Slash commands / Support), built from the current conversation
// state so rows can show their value, toggle or slider. Pure; the webview
// renders it and routes the chosen action.

import {
  type EffortLevel,
  type ExportFormat,
  type PaidFeature,
  type PermissionMode,
} from './constants'
import type { BackendKind, ModelOption, SkillOption } from './protocol'
import type { ReviewRequest } from './reviewCommand'

export type PaletteWidget =
  | { readonly kind: 'value'; readonly text: string }
  | { readonly kind: 'toggle'; readonly isOn: boolean }
  | {
      readonly kind: 'slider'
      /** The tiers the current model serves, lowest first. */
      readonly levels: readonly EffortLevel[]
      readonly current: EffortLevel
    }

export type PaletteAction =
  | { readonly type: 'attachFile' }
  | { readonly type: 'mentionFile' }
  | { readonly type: 'clearConversation' }
  | { readonly type: 'openHistory' }
  | { readonly type: 'openUsage' }
  | { readonly type: 'openUsagePage' }
  | { readonly type: 'openAgents' }
  | { readonly type: 'openModelPicker' }
  /** The models view's footer rows (M95): the provider quick-pick, the Models & Agents panel. */
  | { readonly type: 'addModelProvider' }
  | { readonly type: 'manageModels' }
  | { readonly type: 'setEffort'; readonly effort: EffortLevel }
  | { readonly type: 'toggleThinking' }
  | { readonly type: 'openPermissionModes' }
  | { readonly type: 'toggleFocusView' }
  | { readonly type: 'toggleCtrlEnterToSend' }
  | { readonly type: 'openSettings' }
  | { readonly type: 'openKeybindings' }
  | { readonly type: 'signOut' }
  | { readonly type: 'insertSkill'; readonly selector: string }
  /** `/goal ` in the prompt, for the objective (M45). */
  | { readonly type: 'startGoal' }
  | { readonly type: 'startLoop' }
  /** Scheduled prompts v2 (M115): the surface's list, editor and timeline. */
  | { readonly type: 'openScheduleList' }
  | { readonly type: 'openScheduleEditor' }
  | { readonly type: 'openScheduleTimeline' }
  | { readonly type: 'startHook' }
  | { readonly type: 'compact' }
  /** `/handoff …` in the prompt, for the new conversation's goal (M74). */
  | { readonly type: 'startHandoff' }
  | { readonly type: 'manageSkills' }
  | { readonly type: 'importSkills' }
  | { readonly type: 'importFromAgents' }
  | { readonly type: 'showMcpServers' }
  | { readonly type: 'showHooks' }
  | { readonly type: 'showMemory' }
  /** The saved plans (M79), listed by the host to open or implement. */
  | { readonly type: 'showPlans' }
  | { readonly type: 'newWorktree' }
  | { readonly type: 'removeWorktree' }
  /** Commit, push and pull requests in the panel (M71). */
  | { readonly type: 'gitAction'; readonly action: 'openCommit' | 'push' | 'openPullRequest' }
  | { readonly type: 'openPullRequestInConversation' }
  | { readonly type: 'exportConversation'; readonly format: ExportFormat }
  /** "Import session…" (M84): resume a portable JSON file on the Model API backend. */
  | { readonly type: 'importSession' }
  /** "Open share file…" (M84): a portable JSON file read-only in the panel. */
  | { readonly type: 'openShareFile' }
  /** M118-P-REACT-BRIDGE: supplied only after the host binds these actions. */
  | { readonly type: 'shareChat' }
  | { readonly type: 'promptCommand'; readonly command: 'library' | 'use' | 'share' }
  | { readonly type: 'openLog' }
  /** "Report an issue…" (M93, PLAN.md D72): the scrubbed report's preview, never a bare link. */
  | { readonly type: 'openReport' }
  /** Deterministic reports (M113); W routes this action to the host command. */
  | { readonly type: 'showReport' }
  /** "What's New" (M99): the release notes of this version in an editor tab. */
  | { readonly type: 'showWhatsNew' }
  | { readonly type: 'openHelp' }
  | { readonly type: 'openExternal'; readonly url: string }
  | { readonly type: 'setPaidFeature'; readonly feature: PaidFeature; readonly isOn: boolean }
  /** `/review ` in the prompt, for what to review (M70). */
  | { readonly type: 'startReview' }
  /** `/legal ` in the prompt, for the read-only legal scan (M97). */
  | { readonly type: 'startLegalScan' }
  /** A review preset (M70): the request as the host takes it. */
  | { readonly type: 'review'; readonly request: ReviewRequest }
  /** The review pane over the conversation's changes (M70). */
  | { readonly type: 'openReviewPane' }
  | { readonly type: 'none' }

export interface PaletteItem {
  readonly id: string
  readonly label: string
  /** Absent only on the loading/empty notes and externally supplied rows. */
  readonly tip?: string | undefined
  readonly detail?: string
  readonly widget?: PaletteWidget
  readonly action: PaletteAction
  /**
   * The row's name in the prompt's "/" list (M38), without the slash, for a
   * row whose label is not already `/name`: Claude Code's names where it has
   * one.
   */
  readonly slashName?: string
  /** Slider rows step their value on Left/Right instead of activating. */
  readonly isSlider?: boolean
  readonly isDisabled?: boolean
}

export interface PaletteGroup {
  readonly id: string
  readonly title: string
  readonly items: readonly PaletteItem[]
}

export interface UsageTotals {
  readonly inputTokens: number
  readonly outputTokens: number
}

export interface PaletteContext {
  readonly arePromptCommandsBound?: boolean
  /** W injects bound schedule actions; absent until the surface is available. */
  readonly schedules?: {
    readonly create: PaletteAction
    readonly list: PaletteAction
    readonly timeline: PaletteAction
  }
  /** M117: W supplies the local composer handler before offering this command. */
  readonly estimateAvailable?: boolean
  readonly currentModel:
    { readonly modelId: string; readonly contextLimit: number | undefined } | undefined
  readonly models: readonly ModelOption[]
  readonly effort: EffortLevel
  readonly isThinkingEnabled: boolean
  readonly permissionMode: PermissionMode
  readonly isFocusView: boolean
  readonly useCtrlEnterToSend: boolean
  readonly usage: UsageTotals | undefined
  /** undefined while the session has not been started, so nothing is known. */
  readonly skills: readonly SkillOption[] | undefined
  /** The backend in use (M7); undefined until the host has decided. */
  readonly backend: BackendKind | undefined
  /** The paid features that are on (M33, PLAN.md D30). */
  readonly paidFeatures: readonly PaidFeature[]
  /** A Model API key is stored (M44): the Muse Code backend offers the key's features. */
  readonly isKeyStored: boolean
}

export { backendLabel, formatTokenWindow } from './paletteFormatting'

export function filterPalette(
  groups: readonly PaletteGroup[],
  query: string,
): readonly PaletteGroup[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return groups
  }
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(needle) ||
          (item.detail?.toLowerCase().includes(needle) ?? false),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

/** Every enabled row in display order, for keyboard navigation. */
export function flattenPalette(groups: readonly PaletteGroup[]): readonly PaletteItem[] {
  return groups.flatMap((group) => group.items.filter((item) => item.isDisabled !== true))
}

export { slashCommandsOf } from './slashCommands'
