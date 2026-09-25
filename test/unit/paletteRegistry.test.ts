import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  backendLabel,
  buildPalette,
  filterPalette,
  flattenPalette,
  formatTokenWindow,
  type PaletteContext,
} from '../../src/shared/palette'
import {
  rankSlashCommands,
  type SlashCommand,
  slashCommandsOf,
} from '../../src/shared/slashCommands'

const context: PaletteContext = {
  currentModel: { modelId: 'muse-spark-1.3', contextLimit: 1_007_997 },
  models: [],
  effort: 'xhigh',
  isThinkingEnabled: true,
  permissionMode: 'acceptEdits',
  isFocusView: false,
  useCtrlEnterToSend: true,
  usage: { inputTokens: 12_345, outputTokens: 678 },
  skills: [
    { selector: 'fix-bug', displayName: 'Fix bug', description: 'Fixes a bug' },
    {
      selector: 'acme:deploy',
      displayName: 'Deploy',
      description: 'Deploys',
      argumentHint: '<env>',
    },
  ],
  backend: 'museCode',
  paidFeatures: [],
}

describe('formatTokenWindow', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it('formats millions, thousands and small counts', () => {
    expect(formatTokenWindow(1_007_997)).toBe('1M')
    expect(formatTokenWindow(200_000)).toBe('200K')
    expect(formatTokenWindow(12_345)).toBe('12.3K')
    expect(formatTokenWindow(512)).toBe('512')
    // Just under a million rounds to a thousand thousands: "1M", never "1,000K".
    expect(formatTokenWindow(999_950)).toBe('1M')
    expect(formatTokenWindow(999_949)).toBe('999.9K')
  })

  it('writes the digits the display language writes (M40)', () => {
    setUiText(EN, 'de')
    expect(formatTokenWindow(12_345)).toBe('12,3K')
    expect(formatTokenWindow(200_000)).toBe('200K')
  })
})

describe('the palette in the installed table (M40)', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it('names the backend, the mode, the context window and the usage from the table', () => {
    setUiText(
      {
        ...EN,
        backendModelApi: 'Meta Model API (Schlüssel)',
        permissionModes: { ...EN.permissionModes, acceptEdits: 'Automatisch bearbeiten' },
        modelContextWindow: 'Kontext {tokens}',
        sessionUsageValue: '{input} ein · {output} aus',
      },
      'de',
    )
    expect(backendLabel('modelApi')).toBe('Meta Model API (Schlüssel)')
    const items = buildPalette(context).flatMap((group) => group.items)
    expect(items.find((item) => item.id === 'switchModel')?.widget).toEqual({
      kind: 'value',
      text: 'muse-spark-1.3 (Kontext 1M)',
    })
    expect(items.find((item) => item.id === 'permissionMode')?.widget).toEqual({
      kind: 'value',
      text: 'Automatisch bearbeiten',
    })
    expect(items.find((item) => item.id === 'usage')?.widget).toEqual({
      kind: 'value',
      text: '12,3K ein · 678 aus',
    })
  })
})

/** The Customize group's row ids on a backend (M31). */
function customizeIds(backend: PaletteContext['backend']) {
  return buildPalette({ ...context, backend })
    .find((group) => group.id === 'customize')
    ?.items.map((item) => item.id)
}

/** The Skills group's row ids on a backend (M30). */
function skillIdsOn(backend: PaletteContext['backend']) {
  return buildPalette({ ...context, backend })
    .find((group) => group.id === 'skills')
    ?.items.map((item) => item.id)
}

/** The export actions the slash group offers on a backend (M30). */
function exportActionsOn(backend: PaletteContext['backend']) {
  return buildPalette({ ...context, backend })
    .find((group) => group.id === 'slash')
    ?.items.filter((item) => item.action.type === 'exportConversation')
    .map((item) => item.action)
}

function backendRow(base: PaletteContext, backend: PaletteContext['backend']) {
  return buildPalette({ ...base, backend })
    .find((group) => group.id === 'account')
    ?.items.find((item) => item.id === 'backend')
}

describe('buildPalette', () => {
  it('lays out the seven Claude Code groups in order', () => {
    expect(buildPalette(context).map((group) => group.title)).toEqual([
      'Context',
      'Model',
      'Customize',
      'Account & usage',
      'Skills',
      'Slash commands',
      'Support',
    ])
  })

  it('shows the current model, effort slider, toggles and mode as widgets', () => {
    const groups = buildPalette(context)
    const items = groups.flatMap((group) => group.items)
    expect(items.find((item) => item.id === 'switchModel')?.widget).toEqual({
      kind: 'value',
      text: 'muse-spark-1.3 (1M context)',
    })
    expect(items.find((item) => item.id === 'effort')).toMatchObject({
      label: 'Effort (Extra high)',
      widget: {
        kind: 'slider',
        levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        current: 'xhigh',
      },
      isSlider: true,
    })
    expect(items.find((item) => item.id === 'permissionMode')?.action).toEqual({
      type: 'openPermissionModes',
    })
    expect(items.find((item) => item.id === 'thinking')?.widget).toEqual({
      kind: 'toggle',
      isOn: true,
    })
    expect(items.find((item) => item.id === 'ctrlEnter')?.widget).toEqual({
      kind: 'toggle',
      isOn: true,
    })
    expect(items.find((item) => item.id === 'permissionMode')?.widget).toEqual({
      kind: 'value',
      text: 'Edit automatically',
    })
    expect(items.find((item) => item.id === 'usage')?.widget).toEqual({
      kind: 'value',
      text: '12.3K in · 678 out',
    })
  })

  it('turns skills into slash rows with their argument hint', () => {
    const skills = buildPalette(context).find((group) => group.id === 'skills')
    expect(skills?.items).toEqual([
      {
        id: 'manageSkills',
        label: 'Manage skills…',
        detail: 'Turn Muse Code’s skills on or off',
        action: { type: 'manageSkills' },
      },
      {
        id: 'importSkills',
        label: 'Import skills…',
        detail: 'Copy your Claude Code or Codex skills into Muse Code',
        action: { type: 'importSkills' },
      },
      {
        id: 'skill:fix-bug',
        label: '/fix-bug',
        detail: 'Fixes a bug',
        action: { type: 'insertSkill', selector: 'fix-bug' },
      },
      {
        id: 'skill:acme:deploy',
        label: '/acme:deploy',
        detail: 'Deploys — <env>',
        action: { type: 'insertSkill', selector: 'acme:deploy' },
      },
    ])
  })

  it('explains an unloaded or empty skill list with a disabled row', () => {
    const loading = buildPalette({ ...context, skills: undefined }).find((g) => g.id === 'skills')
    expect(loading?.items.at(-1)).toMatchObject({ isDisabled: true, action: { type: 'none' } })
    const empty = buildPalette({ ...context, skills: [] }).find((g) => g.id === 'skills')
    expect(empty?.items.at(-1)).toMatchObject({
      label: 'No skills available in this workspace',
      isDisabled: true,
    })
  })

  it('describes a missing model and usage honestly', () => {
    const groups = buildPalette({ ...context, currentModel: undefined, usage: undefined })
    const items = groups.flatMap((group) => group.items)
    expect(items.find((item) => item.id === 'switchModel')?.widget).toEqual({
      kind: 'value',
      text: 'Starting Muse Code…',
    })
    expect(items.find((item) => item.id === 'usage')?.widget).toEqual({ kind: 'value', text: '—' })
    const noLimit = buildPalette({
      ...context,
      currentModel: { modelId: 'm', contextLimit: undefined },
    })
    expect(noLimit[1]?.items[0]?.widget).toEqual({ kind: 'value', text: 'm' })
  })

  it('offers Resume in the Context group, opening the History dialog', () => {
    const context_group = buildPalette(context).find((group) => group.id === 'context')
    expect(context_group?.items.find((item) => item.id === 'resume')).toMatchObject({
      label: 'Resume',
      action: { type: 'openHistory' },
    })
  })

  it('shows the backend in use under Account & usage, opening the settings', () => {
    expect(backendRow(context, 'museCode')).toMatchObject({
      label: 'Backend',
      widget: { kind: 'value', text: 'Muse Code (your Muse subscription)' },
      action: { type: 'openSettings' },
    })
    expect(backendRow(context, 'modelApi')?.widget).toEqual({
      kind: 'value',
      text: 'Meta Model API (your key, pay as you go)',
    })
    expect(backendRow(context, undefined)?.widget).toEqual({ kind: 'value', text: '—' })
  })

  it('opens the Account & usage dialog from its row and from /usage and /cost', () => {
    const groups = buildPalette(context)
    const account = groups.find((group) => group.id === 'account')
    expect(account?.items[0]).toMatchObject({
      label: 'Account & usage…',
      action: { type: 'openUsage' },
    })
    const slash = groups.find((group) => group.id === 'slash')
    expect(slash?.items.map((item) => item.label)).toEqual([
      '/agents',
      '/compact',
      '/export',
      'Export session log…',
      '/clear',
      '/logout',
      '/usage',
      '/cost',
    ])
    expect(slash?.items.at(-2)?.action).toEqual({ type: 'openUsage' })
    expect(slash?.items.at(-1)?.action).toEqual({ type: 'openUsage' })
    expect(filterPalette(groups, '/cost').flatMap((group) => group.items.map((i) => i.id))).toEqual(
      ['costCommand'],
    )
  })

  it('offers worktrees in the Context group on both backends (M32)', () => {
    for (const backend of ['museCode', 'modelApi', undefined] as const) {
      const rows = buildPalette({ ...context, backend })
        .find((group) => group.id === 'context')
        ?.items.filter((item) => item.id.endsWith('Worktree'))
        .map((item) => item.action)
      expect(rows, String(backend)).toEqual([{ type: 'newWorktree' }, { type: 'removeWorktree' }])
    }
  })

  it('offers the MCP and hooks views on Muse Code only, beside the settings (M31)', () => {
    expect(customizeIds('museCode')).toEqual([
      'permissionMode',
      'focusView',
      'ctrlEnter',
      'mcpServers',
      'hooks',
      'settings',
      'keybindings',
    ])
    expect(customizeIds('modelApi')).not.toContain('mcpServers')
    expect(customizeIds(undefined)).not.toContain('hooks')
  })

  it('offers skill management on Muse Code only, where the CLI owns skills (M30)', () => {
    expect(skillIdsOn('museCode')?.slice(0, 2)).toEqual(['manageSkills', 'importSkills'])
    expect(skillIdsOn('modelApi')).toEqual(['skill:fix-bug', 'skill:acme:deploy'])
    expect(skillIdsOn(undefined)).toEqual(['skill:fix-bug', 'skill:acme:deploy'])
  })

  it('offers to continue Claude Code or Codex work where the session lists the skill (M30)', () => {
    const contextRows = (skills: PaletteContext['skills']) =>
      buildPalette({ ...context, skills })
        .find((group) => group.id === 'context')
        ?.items.filter((item) => item.id.startsWith('continue:'))
    expect(contextRows(context.skills)).toEqual([])
    expect(contextRows(undefined)).toEqual([])
    const both = [
      { selector: 'resume-codex', displayName: 'resume-codex', description: 'c' },
      { selector: 'resume-claude', displayName: 'resume-claude', description: 'c' },
    ]
    expect(contextRows(both)).toEqual([
      {
        id: 'continue:claude',
        label: 'Continue a Claude Code session',
        detail: 'Pick up unfinished work in this conversation',
        action: { type: 'insertSkill', selector: 'resume-claude' },
      },
      {
        id: 'continue:codex',
        label: 'Continue a Codex session',
        detail: 'Pick up unfinished work in this conversation',
        action: { type: 'insertSkill', selector: 'resume-codex' },
      },
    ])
    expect(contextRows([both[0]!])?.map((item) => item.id)).toEqual(['continue:codex'])
  })

  it('exports Markdown on both backends and Muse Code’s session log on Muse Code (M30)', () => {
    expect(exportActionsOn('museCode')).toEqual([
      { type: 'exportConversation', format: 'markdown' },
      { type: 'exportConversation', format: 'sessionLog' },
    ])
    expect(exportActionsOn('modelApi')).toEqual([
      { type: 'exportConversation', format: 'markdown' },
    ])
  })

  it('routes every enabled row to a real action', () => {
    const rows = flattenPalette(buildPalette(context))
    for (const item of rows) {
      expect(item.action.type, item.id).not.toBe('none')
    }
  })
})

describe('filterPalette', () => {
  it('matches label or detail case-insensitively and drops empty groups', () => {
    const groups = buildPalette(context)
    const filtered = filterPalette(groups, 'DEPLOY')
    expect(filtered.map((group) => group.id)).toEqual(['skills'])
    expect(filtered[0]?.items.map((item) => item.id)).toEqual(['skill:acme:deploy'])
    expect(filterPalette(groups, 'free the window').map((g) => g.id)).toEqual(['slash'])
    expect(filterPalette(groups, 'zzz')).toEqual([])
    expect(filterPalette(groups, '  ')).toBe(groups)
  })
})

// M38: the prompt's "/" list.
describe('slashCommandsOf', () => {
  it('lists the rows with a slash name and the skills, each name once, never a disabled row', () => {
    const commands = slashCommandsOf(buildPalette(context))
    const names = commands.map((command) => command.name)
    expect(names).toEqual([
      'resume',
      'model',
      'permissions',
      'mcp',
      'hooks',
      'config',
      'fix-bug',
      'acme:deploy',
      'agents',
      'compact',
      'export',
      'clear',
      'logout',
      'usage',
      'cost',
    ])
    // A row named for the prompt describes itself by its label.
    expect(commands.find((command) => command.name === 'model')).toMatchObject({
      detail: 'Switch model…',
      action: { type: 'openModelPicker' },
    })
    expect(commands.find((command) => command.name === 'compact')?.detail).toBe(
      'Summarise older context to free the window',
    )
    expect(commands.find((command) => command.name === 'acme:deploy')?.action).toEqual({
      type: 'insertSkill',
      selector: 'acme:deploy',
    })
    // Before the session lists skills, the disabled note is no command.
    const loading = slashCommandsOf(buildPalette({ ...context, skills: undefined }))
    expect(loading.map((command) => command.name)).not.toContain(
      'Start a conversation to load skills',
    )
    expect(loading.every((command) => command.action.type !== 'none')).toBe(true)
  })
})

function slashCommand(name: string, detail?: string): SlashCommand {
  return { name, detail, action: { type: 'compact' } }
}

describe('rankSlashCommands', () => {
  const commands = [
    slashCommand('usage', 'Show account usage'),
    slashCommand('compact', 'Summarise older context'),
    slashCommand('engineering:standup'),
    slashCommand('code-review'),
    slashCommand('clear', 'Clear conversation'),
    slashCommand('describe-this'),
  ]
  const rank = (query: string) => rankSlashCommands(commands, query).map((entry) => entry.name)

  it('puts name prefixes first, then word starts, then anywhere in the name, then the description', () => {
    // "account" and "conversation" hold it: description matches come last.
    expect(rank('co')).toEqual(['code-review', 'compact', 'clear', 'usage'])
    expect(rank('st')).toEqual(['engineering:standup'])
    expect(rank('s')).toEqual(['engineering:standup', 'describe-this', 'usage', 'clear', 'compact'])
    expect(rank('this')).toEqual(['describe-this'])
  })

  it('ignores case and leaves out what matches nothing', () => {
    expect(rank('CL')).toEqual(['clear'])
    expect(rank('zzz')).toEqual([])
  })
})

/** The palette's paid-feature toggles (M33). */
function paidRows(groups: ReturnType<typeof buildPalette>) {
  return groups.flatMap((group) => group.items).filter((item) => item.id.startsWith('paid:'))
}

describe('buildPalette: paid features (M33, PLAN.md D30)', () => {
  it('offers no paid toggle on the Muse Code backend, where none is used', () => {
    expect(paidRows(buildPalette(context))).toEqual([])
  })

  it('offers each paid feature as a toggle naming its price on the Model API backend', () => {
    const rows = paidRows(
      buildPalette({ ...context, backend: 'modelApi', paidFeatures: ['imageGeneration'] }),
    )
    expect(rows.map((row) => [row.label, row.detail, row.widget, row.action])).toEqual([
      [
        'Web search (paid)',
        '$2.50 per 1,000 searches',
        { kind: 'toggle', isOn: false },
        { type: 'setPaidFeature', feature: 'webSearch', isOn: true },
      ],
      [
        'Images (paid)',
        '$0.01 per image',
        { kind: 'toggle', isOn: true },
        { type: 'setPaidFeature', feature: 'imageGeneration', isOn: false },
      ],
      [
        'Muse Voice (paid)',
        '$0.18 per hour of audio',
        { kind: 'toggle', isOn: false },
        { type: 'setPaidFeature', feature: 'voice', isOn: true },
      ],
    ])
  })
})
