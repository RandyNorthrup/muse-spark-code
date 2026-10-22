import { expect } from 'vitest'
import { createTeamPanelController, type TeamPanelDeps } from '../../../src/core/team/teamPanel'
import { teamPanelSliceSchema } from '../../../src/shared/teamPanel'
import { teamOffers } from './teamPanelOffers'
import { Usd } from '../../../src/shared/usd'

export function panelRig(overrides: Partial<TeamPanelDeps> = {}) {
  const store = new Map<string, unknown>()
  let seq = 0
  const updateCalls: { key: string; value: unknown }[] = []
  const update = (key: string, value: unknown): Promise<void> => {
    store.set(key, value)
    updateCalls.push({ key, value })
    return Promise.resolve()
  }
  const reloadCalls: number[] = []
  const reload = (): void => {
    reloadCalls.push(1)
  }
  const writeExportCalls: string[] = []
  const writeExport = (text: string): Promise<void> => {
    writeExportCalls.push(text)
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
    updateCalls,
    reload,
    reloadCalls,
    writeExport,
    writeExportCalls,
    deps,
  }
}
