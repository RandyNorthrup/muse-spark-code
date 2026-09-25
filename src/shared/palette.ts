// The "/" command palette: a registry of actions grouped the way the Claude
// Code panel groups them (Context / Model / Customize / Account & usage /
// Skills / Slash commands / Support), built from the current conversation
// state so rows can show their value, toggle or slider. Pure; the webview
// renders it and routes the chosen action.

import {
  type EffortLevel,
  type ExportFormat,
  ISSUES_URL,
  MUSE_DOCS_URL,
  type PaidFeature,
  type PermissionMode,
  RESUME_SKILL_SELECTORS,
  SKILL_IMPORT_SOURCES,
  SLASH_COMMAND_NAMES,
  type SkillImportSource,
  UI_TEXT,
} from './constants'
import { effortLabel, effortLevelsFor } from './effort'
import { fill, formatNumber } from './l10n/text'
import { paidFeatureName, paidFeaturePrice, usablePaidFeatures } from './paid'
import type { BackendKind, ModelOption, SkillOption } from './protocol'

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
  | { readonly type: 'openAgents' }
  | { readonly type: 'openModelPicker' }
  | { readonly type: 'setEffort'; readonly effort: EffortLevel }
  | { readonly type: 'toggleThinking' }
  | { readonly type: 'openPermissionModes' }
  | { readonly type: 'toggleFocusView' }
  | { readonly type: 'toggleCtrlEnterToSend' }
  | { readonly type: 'openSettings' }
  | { readonly type: 'openKeybindings' }
  | { readonly type: 'signOut' }
  | { readonly type: 'insertSkill'; readonly selector: string }
  | { readonly type: 'compact' }
  | { readonly type: 'manageSkills' }
  | { readonly type: 'importSkills' }
  | { readonly type: 'showMcpServers' }
  | { readonly type: 'showHooks' }
  | { readonly type: 'newWorktree' }
  | { readonly type: 'removeWorktree' }
  | { readonly type: 'exportConversation'; readonly format: ExportFormat }
  | { readonly type: 'openLog' }
  | { readonly type: 'openExternal'; readonly url: string }
  | { readonly type: 'setPaidFeature'; readonly feature: PaidFeature; readonly isOn: boolean }
  | { readonly type: 'none' }

export interface PaletteItem {
  readonly id: string
  readonly label: string
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

/** The backend's name as the palette, the usage dialog and an export show it. */
export function backendLabel(kind: BackendKind): string {
  // Built per call, so the name is the installed table's (PLAN.md D33).
  const labels: Readonly<Record<BackendKind, string>> = {
    museCode: UI_TEXT.backendMuseCode,
    modelApi: UI_TEXT.backendModelApi,
  }
  return labels[kind]
}

const TOKENS_PER_MILLION = 1_000_000
const TOKENS_PER_THOUSAND = 1000
// Thousands are shown to one decimal: 12.3K.
const TOKENS_PER_TENTH_THOUSAND = 100
const TENTHS_PER_UNIT = 10

/** "1M" / "200K" / "12.3K" / "512" for a token count, in the display language's digits. */
export function formatTokenWindow(tokens: number): string {
  if (tokens < TOKENS_PER_THOUSAND) {
    return formatNumber(tokens)
  }
  const thousands = Math.round(tokens / TOKENS_PER_TENTH_THOUSAND) / TENTHS_PER_UNIT
  // 999,950 and up round to a thousand thousands: that is "1M", not "1,000K".
  return thousands < TOKENS_PER_THOUSAND
    ? `${formatNumber(thousands)}K`
    : `${formatNumber(Math.round(tokens / TOKENS_PER_MILLION))}M`
}

/** "200K context": a model's context window. */
export function contextWindowLabel(tokens: number): string {
  return fill(UI_TEXT.modelContextWindow, { tokens: formatTokenWindow(tokens) })
}

function contextSuffix(contextLimit: number | undefined): string {
  return contextLimit === undefined ? '' : ` (${contextWindowLabel(contextLimit)})`
}

function modelValue(context: PaletteContext): string {
  const { currentModel } = context
  return currentModel === undefined
    ? UI_TEXT.hostStarting
    : `${currentModel.modelId}${contextSuffix(currentModel.contextLimit)}`
}

function usageValue(usage: UsageTotals | undefined): string {
  return usage === undefined
    ? '—'
    : fill(UI_TEXT.sessionUsageValue, {
        input: formatTokenWindow(usage.inputTokens),
        output: formatTokenWindow(usage.outputTokens),
      })
}

function continueLabel(source: SkillImportSource): string {
  const labels: Readonly<Record<SkillImportSource, string>> = {
    claude: UI_TEXT.continueClaudeItem,
    codex: UI_TEXT.continueCodexItem,
  }
  return labels[source]
}

/** Muse Code's bundled `resume-claude` / `resume-codex`, where the session lists them (M30). */
function continueItems(skills: readonly SkillOption[] | undefined): readonly PaletteItem[] {
  return SKILL_IMPORT_SOURCES.flatMap((source) => {
    const selector = RESUME_SKILL_SELECTORS[source]
    return skills?.some((skill) => skill.selector === selector) === true
      ? [
          {
            id: `continue:${source}`,
            label: continueLabel(source),
            detail: UI_TEXT.continueDetail,
            action: { type: 'insertSkill', selector } as const,
          },
        ]
      : []
  })
}

/** The CLI's skill commands (M30); the Model API backend reads skill files itself (M10). */
function skillManagementItems(backend: BackendKind | undefined): readonly PaletteItem[] {
  return backend === 'museCode'
    ? [
        {
          id: 'manageSkills',
          label: UI_TEXT.manageSkillsItem,
          detail: UI_TEXT.manageSkillsDetail,
          action: { type: 'manageSkills' },
        },
        {
          id: 'importSkills',
          label: UI_TEXT.importSkillsItem,
          detail: UI_TEXT.importSkillsDetail,
          action: { type: 'importSkills' },
        },
      ]
    : []
}

/** What Muse Code loads from its own settings (M31); the Model API backend loads neither. */
function museConfigItems(backend: BackendKind | undefined): readonly PaletteItem[] {
  return backend === 'museCode'
    ? [
        {
          id: 'mcpServers',
          label: UI_TEXT.mcpItem,
          slashName: SLASH_COMMAND_NAMES.mcp,
          detail: UI_TEXT.mcpItemDetail,
          action: { type: 'showMcpServers' },
        },
        {
          id: 'hooks',
          label: UI_TEXT.hooksItem,
          slashName: SLASH_COMMAND_NAMES.hooks,
          detail: UI_TEXT.hooksItemDetail,
          action: { type: 'showHooks' },
        },
      ]
    : []
}

/**
 * The paid features' toggles (M33, PLAN.md D30), where they can be used: all
 * on the Model API backend, and on Muse Code the key's images and voice when
 * a key is stored (M44). Each names its price, and turning one on asks the
 * host's confirmation first.
 */
function paidItems(context: PaletteContext): readonly PaletteItem[] {
  return usablePaidFeatures(context.backend, context.isKeyStored).map((feature) => {
    const isOn = context.paidFeatures.includes(feature)
    return {
      id: `paid:${feature}`,
      label: fill(UI_TEXT.paidToggleLabel, { feature: paidFeatureName(feature) }),
      detail: paidFeaturePrice(feature),
      widget: { kind: 'toggle', isOn },
      action: { type: 'setPaidFeature', feature, isOn: !isOn },
    }
  })
}

/** "/export" on both backends; Muse Code's own JSON log where it runs (M30). */
function exportItems(backend: BackendKind | undefined): readonly PaletteItem[] {
  const markdown: PaletteItem = {
    id: 'export',
    label: UI_TEXT.exportItem,
    detail: UI_TEXT.exportDetail,
    action: { type: 'exportConversation', format: 'markdown' },
  }
  return backend === 'museCode'
    ? [
        markdown,
        {
          id: 'exportLog',
          label: UI_TEXT.exportLogItem,
          detail: UI_TEXT.exportLogDetail,
          action: { type: 'exportConversation', format: 'sessionLog' },
        },
      ]
    : [markdown]
}

function skillItems(skills: readonly SkillOption[] | undefined): readonly PaletteItem[] {
  if (skills === undefined) {
    return [
      {
        id: 'skills:loading',
        label: UI_TEXT.skillsLoading,
        action: { type: 'none' },
        isDisabled: true,
      },
    ]
  }
  if (skills.length === 0) {
    return [
      {
        id: 'skills:empty',
        label: UI_TEXT.skillsEmpty,
        action: { type: 'none' },
        isDisabled: true,
      },
    ]
  }
  return skills.map((skill) => ({
    id: `skill:${skill.selector}`,
    label: `/${skill.selector}`,
    detail:
      skill.argumentHint === undefined
        ? skill.description
        : `${skill.description} — ${skill.argumentHint}`,
    action: { type: 'insertSkill', selector: skill.selector },
  }))
}

export function buildPalette(context: PaletteContext): readonly PaletteGroup[] {
  return [
    {
      id: 'context',
      title: UI_TEXT.groupContext,
      items: [
        { id: 'attachFile', label: UI_TEXT.attachFile, action: { type: 'attachFile' } },
        { id: 'mentionFile', label: UI_TEXT.mentionFile, action: { type: 'mentionFile' } },
        { id: 'clear', label: UI_TEXT.clearConversation, action: { type: 'clearConversation' } },
        {
          id: 'resume',
          label: UI_TEXT.resumeItem,
          slashName: SLASH_COMMAND_NAMES.resume,
          detail: UI_TEXT.resumeDetail,
          action: { type: 'openHistory' },
        },
        ...continueItems(context.skills),
        // git worktrees (M32): the same on both backends.
        {
          id: 'newWorktree',
          label: UI_TEXT.newWorktreeItem,
          detail: UI_TEXT.newWorktreeDetail,
          action: { type: 'newWorktree' },
        },
        {
          id: 'removeWorktree',
          label: UI_TEXT.removeWorktreeItem,
          detail: UI_TEXT.removeWorktreeDetail,
          action: { type: 'removeWorktree' },
        },
      ],
    },
    {
      id: 'model',
      title: UI_TEXT.groupModel,
      items: [
        {
          id: 'switchModel',
          label: UI_TEXT.switchModel,
          slashName: SLASH_COMMAND_NAMES.model,
          widget: { kind: 'value', text: modelValue(context) },
          action: { type: 'openModelPicker' },
        },
        {
          id: 'effort',
          label: `${UI_TEXT.effortItem} (${effortLabel(context.effort)})`,
          widget: {
            kind: 'slider',
            levels: effortLevelsFor(context.currentModel?.modelId),
            current: context.effort,
          },
          action: { type: 'setEffort', effort: context.effort },
          isSlider: true,
        },
        {
          id: 'thinking',
          label: UI_TEXT.thinkingItem,
          widget: { kind: 'toggle', isOn: context.isThinkingEnabled },
          action: { type: 'toggleThinking' },
        },
      ],
    },
    {
      id: 'customize',
      title: UI_TEXT.groupCustomize,
      items: [
        {
          id: 'permissionMode',
          label: UI_TEXT.permissionModeItem,
          slashName: SLASH_COMMAND_NAMES.permissions,
          widget: { kind: 'value', text: UI_TEXT.permissionModes[context.permissionMode] },
          action: { type: 'openPermissionModes' },
        },
        {
          id: 'focusView',
          label: UI_TEXT.focusViewItem,
          widget: { kind: 'toggle', isOn: context.isFocusView },
          action: { type: 'toggleFocusView' },
        },
        {
          id: 'ctrlEnter',
          label: UI_TEXT.ctrlEnterItem,
          widget: { kind: 'toggle', isOn: context.useCtrlEnterToSend },
          action: { type: 'toggleCtrlEnterToSend' },
        },
        ...museConfigItems(context.backend),
        {
          id: 'settings',
          label: UI_TEXT.openSettings,
          slashName: SLASH_COMMAND_NAMES.config,
          action: { type: 'openSettings' },
        },
        { id: 'keybindings', label: UI_TEXT.openKeybindings, action: { type: 'openKeybindings' } },
      ],
    },
    {
      id: 'account',
      title: UI_TEXT.groupAccount,
      items: [
        {
          id: 'accountUsage',
          label: UI_TEXT.usageItem,
          detail: UI_TEXT.usageItemDetail,
          action: { type: 'openUsage' },
        },
        {
          id: 'usage',
          label: UI_TEXT.sessionUsage,
          widget: { kind: 'value', text: usageValue(context.usage) },
          action: { type: 'none' },
          isDisabled: true,
        },
        {
          id: 'backend',
          label: UI_TEXT.backendItem,
          detail: UI_TEXT.backendDetail,
          widget: {
            kind: 'value',
            text: context.backend === undefined ? '—' : backendLabel(context.backend),
          },
          action: { type: 'openSettings' },
        },
        ...paidItems(context),
        { id: 'signOut', label: UI_TEXT.signOutItem, action: { type: 'signOut' } },
      ],
    },
    {
      id: 'skills',
      title: UI_TEXT.groupSkills,
      items: [...skillManagementItems(context.backend), ...skillItems(context.skills)],
    },
    {
      id: 'slash',
      title: UI_TEXT.groupSlashCommands,
      items: [
        {
          id: 'agents',
          label: UI_TEXT.agentsCommand,
          detail: UI_TEXT.agentsCommandDetail,
          action: { type: 'openAgents' },
        },
        {
          id: 'compact',
          label: UI_TEXT.compactItem,
          detail: UI_TEXT.compactDetail,
          action: { type: 'compact' },
        },
        ...exportItems(context.backend),
        {
          id: 'clearCommand',
          label: UI_TEXT.clearItem,
          detail: UI_TEXT.clearConversation,
          action: { type: 'clearConversation' },
        },
        {
          id: 'logout',
          label: UI_TEXT.logoutItem,
          detail: UI_TEXT.signOutItem,
          action: { type: 'signOut' },
        },
        {
          id: 'usageCommand',
          label: UI_TEXT.usageCommand,
          detail: UI_TEXT.usageCommandDetail,
          action: { type: 'openUsage' },
        },
        {
          id: 'costCommand',
          label: UI_TEXT.costCommand,
          detail: UI_TEXT.costCommandDetail,
          action: { type: 'openUsage' },
        },
      ],
    },
    {
      id: 'support',
      title: UI_TEXT.groupSupport,
      items: [
        { id: 'log', label: UI_TEXT.openLog, action: { type: 'openLog' } },
        {
          id: 'issue',
          label: UI_TEXT.reportIssue,
          action: { type: 'openExternal', url: ISSUES_URL },
        },
        {
          id: 'docs',
          label: UI_TEXT.openDocs,
          action: { type: 'openExternal', url: MUSE_DOCS_URL },
        },
      ],
    },
  ]
}

/** Case-insensitive substring filter over label and detail; empty groups drop. */
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
