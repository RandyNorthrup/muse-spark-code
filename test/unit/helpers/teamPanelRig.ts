import { expect } from 'vitest'
import { createTeamPanelController, type TeamPanelDeps } from '../../../src/core/team/teamPanel'
import { teamPanelSliceSchema } from '../../../src/shared/teamPanel'
import { teamOffers } from './teamPanelOffers'
import { Usd } from '../../../src/shared/usd'

export function panelRig(overrides: Partial<TeamPanelDeps> = {}) {
  const store = new Map<string, unknown>()
  let seq = 0
  // The ports below are observed through their real effects: state writes
  // land in the store, reloads count, the export text is kept. No watcher.
  let reloads = 0
  let exported: string | undefined
  const update = (key: string, value: unknown) => {
    store.set(key, value)
    return Promise.resolve()
  }
  const reload = () => {
    reloads += 1
  }
  const writeExport = (text: string) => {
    exported = text
    return Promise.resolve()
  }
  const deps: TeamPanelDeps = {
    isEnabled: () => true,
    isTrusted: () => true,
    state: { get: (key) => store.get(key), update },
    offers: () => Promise.resolve(teamOffers()),
    defaultRef: () => 'main/main',
    maxWorkers: () => 8,
    remainingDailyBudgetUsd: () => Usd.from(100).toAmount(),
    records: () => [],
    newId: () => `entry-${String(++seq)}`,
    reload,
    confirmInPlace: () => Promise.resolve(true),
    confirmOrchestrator: () => Promise.resolve(),
    writeExport,
    readImport: () => Promise.resolve(undefined),
    ...overrides,
  }
  const controller = createTeamPanelController(deps)
  const read = async () => {
    const value = await controller.read()
    if (value === undefined) throw new Error('Missing test slice')
    expect(teamPanelSliceSchema.safeParse(value).success).toBe(true)
    return value
  }
  return {
    controller,
    read,
    store,
    update,
    reload,
    writeExport,
    exportedText: () => exported,
    reloads: () => reloads,
    deps,
  }
}
