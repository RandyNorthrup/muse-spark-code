import { describe, expect, it } from 'vitest'
import {
  buildPalette,
  filterPalette,
  flattenPalette,
  formatTokenWindow,
  type PaletteContext,
} from '../../src/shared/palette'

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
}

describe('formatTokenWindow', () => {
  it('formats millions, thousands and small counts', () => {
    expect(formatTokenWindow(1_007_997)).toBe('1M')
    expect(formatTokenWindow(200_000)).toBe('200K')
    expect(formatTokenWindow(12_345)).toBe('12.3K')
    expect(formatTokenWindow(512)).toBe('512')
  })
})

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
    expect(loading?.items[0]).toMatchObject({ isDisabled: true, action: { type: 'none' } })
    const empty = buildPalette({ ...context, skills: [] }).find((g) => g.id === 'skills')
    expect(empty?.items[0]).toMatchObject({
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
      '/compact',
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
    expect(filterPalette(groups, 'window').map((g) => g.id)).toEqual(['slash'])
    expect(filterPalette(groups, 'zzz')).toEqual([])
    expect(filterPalette(groups, '  ')).toBe(groups)
  })
})
