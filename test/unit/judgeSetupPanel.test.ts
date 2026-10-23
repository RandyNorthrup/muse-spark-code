// M125 lane W (D107): the wizard's contracts. The panel validates
// every command before the host runs one and every snapshot before
// it renders one; the Models & Agents slice carries only
// installed-or-not plus the model.
import { describe, expect, it } from 'vitest'
import { makeState } from './modelsPanelFixtures.js'
import {
  judgeSetupSlice,
  panelToHostMessageSchema,
  parseModelsPanelState,
} from '../../src/shared/modelsPanel'
import {
  parseJudgeSetupHostToPanel,
  parseJudgeSetupPanelToHost,
} from '../../src/shared/judgeSetupPanel'

const scanSnapshot = {
  step: 'scan',
  running: false,
  summary: ['macOS arm64'],
} as const

describe('wizard panel protocol', () => {
  it('accepts ready, commands and the licence link', () => {
    expect(parseJudgeSetupPanelToHost({ type: 'judgeSetup/ready' })).toMatchObject({ ok: true })
    expect(
      parseJudgeSetupPanelToHost({
        type: 'judgeSetup/command',
        message: { command: 'chooseModel', model: 'qwen3:8b' },
      }),
    ).toMatchObject({ ok: true })
    expect(
      parseJudgeSetupPanelToHost({
        type: 'judgeSetup/openExternal',
        url: 'https://example.com/licence',
      }),
    ).toMatchObject({ ok: true })
  })

  it('refuses unknown, illegal and padded commands', () => {
    expect(
      parseJudgeSetupPanelToHost({ type: 'judgeSetup/command', message: { command: 'launch' } }).ok,
    ).toBe(false)
    expect(
      parseJudgeSetupPanelToHost({
        type: 'judgeSetup/command',
        message: { command: 'back', extra: true },
      }).ok,
    ).toBe(false)
    expect(parseJudgeSetupPanelToHost({ type: 'judgeSetup/ready', extra: true }).ok).toBe(false)
  })

  it('accepts snapshots and closes, and refuses malformed ones', () => {
    expect(
      parseJudgeSetupHostToPanel({ type: 'judgeSetup/snapshot', snapshot: scanSnapshot }),
    ).toMatchObject({ ok: true })
    expect(parseJudgeSetupHostToPanel({ type: 'judgeSetup/closed' })).toMatchObject({ ok: true })
    expect(
      parseJudgeSetupHostToPanel({
        type: 'judgeSetup/snapshot',
        snapshot: { step: 'licence', model: 'm' },
      }).ok,
    ).toBe(false)
  })
})

describe('Judge section setup slice', () => {
  it('names an install and stays silent otherwise', () => {
    expect(judgeSetupSlice(false, undefined)).toEqual({ isInstalled: false })
    expect(judgeSetupSlice(true, 'qwen3:8b')).toEqual({ isInstalled: true, model: 'qwen3:8b' })
    expect(judgeSetupSlice(true, undefined)).toEqual({ isInstalled: false })
  })

  it('parses the slice inside panel state', () => {
    const state = makeState({
      presets: [],
      facets: { providers: [], families: [] },
      judgeSetup: { isInstalled: true, model: 'qwen3:8b' },
    })
    expect(parseModelsPanelState(state).ok).toBe(true)
    expect(parseModelsPanelState({ ...state, judgeSetup: { isInstalled: true } }).ok).toBe(false)
    expect(
      parseModelsPanelState({ ...state, judgeSetup: { isInstalled: false, model: 'qwen3:8b' } }).ok,
    ).toBe(false)
  })

  it('accepts the section management messages', () => {
    for (const type of ['judge/setupOpen', 'judge/setupChange', 'judge/setupRemove']) {
      expect(panelToHostMessageSchema.safeParse({ type }).success).toBe(true)
    }
  })
})
