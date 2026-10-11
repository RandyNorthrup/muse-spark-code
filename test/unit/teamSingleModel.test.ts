// Lane T: the single-model check (PLAN.md M96 acceptance 47). Every case
// names its reason; breaking the gate (answering "team" whenever the switch
// is on) fails the team-mode cases below and the golden test's baselines.

import { describe, expect, it } from 'vitest'
import {
  decideTeamConversationMode,
  readTeamWorkspaceHint,
  readTeamConversationMode,
  storeTeamConversationMode,
  TEAM_WORKSPACE_KEYS,
  type TeamConversationDecision,
} from '../../src/core/team/singleModel'
import type { TeamCustomEntryRef, TeamDecisionSource } from '../../src/core/team/teamSeams'

const ORCHESTRATOR = 'muse-spark-1.3'

function entry(
  entryId: string,
  modelId: string,
  options: Partial<TeamCustomEntryRef> = {},
): TeamCustomEntryRef {
  return {
    entryId,
    modelId,
    kind: 'engine',
    billsKey: false,
    isAvailable: true,
    ...options,
  }
}

function source(options: Partial<TeamDecisionSource> & { ready?: readonly string[] } = {}): {
  source: TeamDecisionSource
  decision: TeamConversationDecision
} {
  const ready = new Set(options.ready ?? ['e1'])
  const full: TeamDecisionSource = {
    teamSwitchOn: true,
    soloTemplate: false,
    orchestratorModelId: ORCHESTRATOR,
    customEntries: [],
    isSameModel: (a, b) => a === b,
    isEntryReady: (entryId) => ready.has(entryId),
    teamWorkersOn: false,
    ...options,
  }
  return { source: full, decision: decideTeamConversationMode(full) }
}

describe('decideTeamConversationMode', () => {
  it('stays single-model when the team switch is off', () => {
    const { decision } = source({
      teamSwitchOn: false,
      customEntries: [entry('e1', 'other-model')],
    })
    expect(decision).toEqual({ mode: 'single-model', reason: 'team-off' })
  })

  it('stays single-model on the Solo template', () => {
    const { decision } = source({
      soloTemplate: true,
      customEntries: [entry('e1', 'other-model')],
    })
    expect(decision).toEqual({ mode: 'single-model', reason: 'solo' })
  })

  it('stays single-model with nothing configured (only Default)', () => {
    const { decision } = source({ customEntries: [] })
    expect(decision).toEqual({ mode: 'single-model', reason: 'nothing-configured' })
  })

  it('stays single-model on duplicate models, whatever the caps or provider', () => {
    const { decision } = source({
      customEntries: [
        entry('e1', ORCHESTRATOR, { kind: 'musecode' }),
        entry('e2', ORCHESTRATOR, { kind: 'engine', billsKey: true }),
      ],
      ready: ['e1', 'e2'],
      teamWorkersOn: true,
    })
    expect(decision).toEqual({ mode: 'single-model', reason: 'duplicate-models' })
  })

  it('dedupes through sameModel, not string equality', () => {
    const { decision } = source({
      customEntries: [entry('e1', 'MUSE-SPARK-1.3 ')],
      // Lane R's sameModel normalises ids; a plain comparison would call this distinct.
      isSameModel: (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase(),
    })
    expect(decision).toEqual({ mode: 'single-model', reason: 'duplicate-models' })
  })

  it('stays single-model when only key entries exist while teamWorkers is off', () => {
    const { decision } = source({
      customEntries: [entry('e1', 'other-model', { billsKey: true })],
      teamWorkersOn: false,
    })
    expect(decision).toEqual({ mode: 'single-model', reason: 'key-entries-off' })
  })

  it('stays single-model when every custom entry is unavailable', () => {
    const { decision } = source({
      customEntries: [entry('e1', 'other-model', { isAvailable: false })],
    })
    expect(decision).toEqual({ mode: 'single-model', reason: 'unavailable' })
  })

  it('stays single-model when no distinct entry is observably loaded', () => {
    const { decision } = source({
      customEntries: [entry('e1', 'other-model')],
      ready: [],
    })
    expect(decision).toEqual({ mode: 'single-model', reason: 'not-loaded' })
  })

  it('runs the team for one distinct, available, ready entry', () => {
    const { decision } = source({ customEntries: [entry('e1', 'other-model')] })
    expect(decision).toEqual({ mode: 'team', reason: 'ready' })
  })

  it('runs the team for a key entry while teamWorkers is on and its probe succeeds', () => {
    const { decision } = source({
      customEntries: [entry('e1', 'other-model', { billsKey: true })],
      teamWorkersOn: true,
    })
    expect(decision).toEqual({ mode: 'team', reason: 'ready' })
  })

  it('ignores an unknown entry in the probe results', () => {
    const { decision } = source({
      customEntries: [entry('e1', 'other-model')],
      // Only an unrelated entry reports ready: e1 has no result yet.
      ready: ['other'],
    })
    expect(decision).toEqual({ mode: 'single-model', reason: 'not-loaded' })
  })
})

describe('readTeamWorkspaceHint', () => {
  it('reports no team when nothing is stored', () => {
    expect(readTeamWorkspaceHint({ get: () => undefined })).toEqual({
      soloTemplate: false,
      hasStoredTeam: false,
    })
  })

  it('reports Solo from the stored template', () => {
    const state = {
      get: (key: string) => (key === TEAM_WORKSPACE_KEYS.team ? { template: 'Solo' } : undefined),
    }
    expect(readTeamWorkspaceHint(state)).toEqual({ soloTemplate: true, hasStoredTeam: true })
  })

  it('never turns the team on by itself', () => {
    const state = {
      get: (key: string) =>
        key === TEAM_WORKSPACE_KEYS.team ? { template: 'Full team' } : undefined,
    }
    expect(readTeamWorkspaceHint(state)).toEqual({ soloTemplate: false, hasStoredTeam: true })
  })
})

describe('conversation mode storage', () => {
  it('keeps each session decision and treats unknown sessions as single-model', async () => {
    let stored: unknown
    const state = {
      get: () => stored,
      update: (_key: string, value: unknown) => {
        stored = value
        return Promise.resolve()
      },
    }
    expect(readTeamConversationMode(state, 'old')).toBe('single-model')
    await storeTeamConversationMode(state, 'team-session', 'team')
    await storeTeamConversationMode(state, 'solo-session', 'single-model')
    expect(readTeamConversationMode(state, 'team-session')).toBe('team')
    expect(readTeamConversationMode(state, 'solo-session')).toBe('single-model')
    expect(readTeamConversationMode(state, 'old')).toBe('single-model')
    stored = { old: 'invalid' }
    expect(readTeamConversationMode(state, 'old')).toBe('single-model')
  })
})
