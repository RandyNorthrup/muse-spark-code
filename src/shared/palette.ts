// The "/" command palette: a registry of actions grouped the way the Claude
// Code panel groups them (Context / Model / Customize / Account & usage /
// Skills / Slash commands / Support), built from the current conversation
// state so rows can show their value, toggle or slider. Pure; the webview
// renders it and routes the chosen action.

import {
  type EffortLevel,
  ISSUES_URL,
  MUSE_DOCS_URL,
  PERMISSION_MODE_LABELS,
  type PermissionMode,
  UI_TEXT,
} from './constants'
import { effortLabel, effortLevelsFor } from './effort'
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
  | { readonly type: 'openLog' }
  | { readonly type: 'openExternal'; readonly url: string }
  | { readonly type: 'none' }

export interface PaletteItem {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly widget?: PaletteWidget
  readonly action: PaletteAction
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
}

const BACKEND_LABELS: Readonly<Record<BackendKind, string>> = {
  museCode: UI_TEXT.backendMuseCode,
  modelApi: UI_TEXT.backendModelApi,
}

const TOKENS_PER_MILLION = 1_000_000
const TOKENS_PER_THOUSAND = 1000
const KILO_DECIMALS = 1

/** "1M" / "200K" / "512" for a token count. */
export function formatTokenWindow(tokens: number): string {
  if (tokens >= TOKENS_PER_MILLION) {
    return `${String(Math.round(tokens / TOKENS_PER_MILLION))}M`
  }
  const thousands = (tokens / TOKENS_PER_THOUSAND).toFixed(KILO_DECIMALS).replace(/\.0$/, '')
  return tokens >= TOKENS_PER_THOUSAND ? `${thousands}K` : String(tokens)
}

function contextSuffix(contextLimit: number | undefined): string {
  return contextLimit === undefined
    ? ''
    : ` (${formatTokenWindow(contextLimit)} ${UI_TEXT.modelContextSuffix})`
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
    : `${formatTokenWindow(usage.inputTokens)} in · ${formatTokenWindow(usage.outputTokens)} out`
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
          detail: UI_TEXT.resumeDetail,
          action: { type: 'openHistory' },
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
          widget: { kind: 'value', text: PERMISSION_MODE_LABELS[context.permissionMode] },
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
        { id: 'settings', label: UI_TEXT.openSettings, action: { type: 'openSettings' } },
        { id: 'keybindings', label: UI_TEXT.openKeybindings, action: { type: 'openKeybindings' } },
      ],
    },
    {
      id: 'account',
      title: UI_TEXT.groupAccount,
      items: [
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
            text: context.backend === undefined ? '—' : BACKEND_LABELS[context.backend],
          },
          action: { type: 'openSettings' },
        },
        { id: 'signOut', label: UI_TEXT.signOutItem, action: { type: 'signOut' } },
      ],
    },
    { id: 'skills', title: UI_TEXT.groupSkills, items: skillItems(context.skills) },
    {
      id: 'slash',
      title: UI_TEXT.groupSlashCommands,
      items: [
        {
          id: 'compact',
          label: UI_TEXT.compactItem,
          detail: UI_TEXT.compactDetail,
          action: { type: 'compact' },
        },
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
