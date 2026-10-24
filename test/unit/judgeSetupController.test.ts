// M125 lane W (D107 §8.1): the setup wizard's driver. Scans land on
// the recommendation (or an honest fits-nothing); the Advanced
// choices re-plan; Install streams progress and lands on Done with
// class rows from `eligible` and check rows from the row's coverage;
// illegal commands are ignored and closes abort the work.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  doneCheckRows,
  doneClassRows,
  JudgeSetupController,
} from '../../src/core/judge/setup/controller'
import type { JudgeSetupPorts } from '../../src/core/judge/setup/ports'
import type {
  JudgeSetupCommandMessage,
  JudgeSetupSnapshot,
} from '../../src/shared/judgeSetupSchema'
import type { JudgeModelsTable } from '../../src/shared/judgeModels/schema'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { DIGEST, installTable, PATHS, setupPorts } from './helpers/judgeSetupWorld'

function licensedTable(name: string): JudgeModelsTable {
  const base = installTable()
  return {
    ...base,
    rows: base.rows.map((row, index) =>
      index === 0
        ? {
            ...row,
            licence: { name, needsAccept: true, url: 'https://test.invalid/licence' },
          }
        : row,
    ),
  }
}

function ports(overrides: Partial<JudgeSetupPorts> = {}): JudgeSetupPorts {
  return setupPorts({
    loadTable: () => ({ table: installTable(['loop.stuck', 'triage.needFull']), failures: {} }),
    ...overrides,
  }).ports
}

const send = async (
  controller: JudgeSetupController,
  command: JudgeSetupCommandMessage,
): Promise<{ readonly snapshots: JudgeSetupSnapshot[]; readonly directive: unknown }> => {
  const snapshots: JudgeSetupSnapshot[] = []
  const directive = await controller.command(command, (snapshot) => {
    snapshots.push(snapshot)
  })
  return { snapshots, directive }
}

/** The directive's snapshot, or a failed expectation when it carries none. */
const snapshotOf = (directive: unknown): JudgeSetupSnapshot => {
  if (directive === null || typeof directive !== 'object' || !('snapshot' in directive)) {
    throw new Error('expected a snapshot directive')
  }
  // The guard above proves the snapshot; the cast names it for the step assertions.
  return directive.snapshot as JudgeSetupSnapshot
}

describe('setup controller', () => {
  beforeEach(() => {
    setUiText(EN, 'en')
  })

  it('opens on an idle scan and scans onto the recommendation', async () => {
    const controller = new JudgeSetupController(PATHS, ports())
    expect(controller.current()).toEqual({ step: 'scan', running: false, summary: [] })
    const { snapshots, directive } = await send(controller, { command: 'startScan' })
    expect(snapshots.map((snapshot) => snapshot.step)).toEqual(['scan'])
    const snapshot = snapshotOf(directive)
    expect(snapshot.step).toBe('recommendation')
    if (snapshot.step !== 'recommendation') throw new Error('unreachable')
    expect(snapshot.model).toBe('tev1:4b')
    expect(snapshot.digest).toBe(DIGEST)
    expect(snapshot.downloadBytes).toBe(4_500_000_000)
    expect(snapshot.backend).toBe('cpu')
    expect(snapshot.p95Ms).toBe(300)
    expect(snapshot.reasons.length).toBeGreaterThan(0)
  })

  it('shows a broken table as a scan error with its retry', async () => {
    const controller = new JudgeSetupController(
      PATHS,
      ports({ loadTable: () => ({ table: undefined, failures: { f: 'missing-file' } }) }),
    )
    const { directive } = await send(controller, { command: 'startScan' })
    expect(directive).toEqual({
      to: 'snapshot',
      snapshot: { step: 'scan', running: false, summary: [], error: 'table-invalid' },
    })
  })

  it('re-plans on the Advanced CPU toggle and ignores an unfitting pick', async () => {
    const controller = new JudgeSetupController(PATHS, ports())
    await send(controller, { command: 'startScan' })
    const toggled = await send(controller, { command: 'chooseCpuOnly' })
    const snapshot = snapshotOf(toggled.directive)
    expect(snapshot.step).toBe('recommendation')
    if (snapshot.step !== 'recommendation') throw new Error('unreachable')
    expect(snapshot.cpuOnly).toBe(true)
    const picked = await send(controller, { command: 'chooseModel', model: 'elsewhere:9b' })
    const after = snapshotOf(picked.directive)
    expect(after.step).toBe('recommendation')
    if (after.step !== 'recommendation') throw new Error('unreachable')
    expect(after.model).toBe('tev1:4b')
  })

  it('installs through progress onto Done with class and check rows', async () => {
    const controller = new JudgeSetupController(PATHS, ports())
    await send(controller, { command: 'startScan' })
    const { snapshots, directive } = await send(controller, { command: 'startInstall' })
    const phases = snapshots.map((snapshot) =>
      snapshot.step === 'install' ? snapshot.phase : snapshot.step,
    )
    expect(phases).toContain('fetch')
    expect(phases).toContain('smoke')
    expect(phases.at(-1)).toBe('smoke')
    const done = snapshotOf(directive)
    expect(done.step).toBe('done')
    if (done.step !== 'done') throw new Error('unreachable')
    expect(done.model).toBe('tev1:4b')
    expect(done.smokeCorrect).toBe(10)
    expect(done.smokeTotal).toBe(10)
    expect(done.classes.map((row) => row.timingClass)).toEqual(['I', 'S', 'B', 'P'])
    expect(done.classes.find((row) => row.timingClass === 'P')).toMatchObject({ on: true })
    expect(done.checks).toHaveLength(11)
    expect(done.checks.find((row) => row.family === 'loop.stuck')).toMatchObject({
      on: true,
      reason: 'Calibrated.',
    })
    expect(done.checks.find((row) => row.family === 'done.unbacked')).toMatchObject({
      on: false,
      reason: 'Not calibrated yet.',
    })
  })

  it('asks the licence before installing a licensed model', async () => {
    const licensed = licensedTable('Test Licence 1.0')
    const controller = new JudgeSetupController(
      PATHS,
      ports({ loadTable: () => ({ table: licensed, failures: {} }) }),
    )
    await send(controller, { command: 'startScan' })
    const asked = await send(controller, { command: 'startInstall' })
    const licence = snapshotOf(asked.directive)
    expect(licence).toEqual({
      step: 'licence',
      model: 'tev1:4b',
      name: 'Test Licence 1.0',
      url: 'https://test.invalid/licence',
    })
    const installed = await send(controller, { command: 'acceptLicence' })
    const done = snapshotOf(installed.directive)
    expect(done.step).toBe('done')
  })

  it('fails the install with its phase and reason, and retries', async () => {
    const failing = ports()
    const controller = new JudgeSetupController(PATHS, {
      ...failing,
      flow: {
        ...failing.flow,
        askSmoke: (questions) =>
          Promise.resolve(questions.map(() => ({ correct: false, latencyMs: 1 }))),
      },
    })
    await send(controller, { command: 'startScan' })
    const { directive } = await send(controller, { command: 'startInstall' })
    const failed = snapshotOf(directive)
    expect(failed).toEqual({
      step: 'install',
      model: 'tev1:4b',
      phase: 'smoke',
      error: 'smoke/smoke-failed',
    })
    const back = await send(controller, { command: 'back' })
    expect(snapshotOf(back.directive).step).toBe('recommendation')
  })

  it('steps back through licence and closes with its directives', async () => {
    const licensed = licensedTable('L')
    const controller = new JudgeSetupController(
      PATHS,
      ports({ loadTable: () => ({ table: licensed, failures: {} }) }),
    )
    await send(controller, { command: 'startScan' })
    await send(controller, { command: 'startInstall' })
    const back = await send(controller, { command: 'back' })
    expect(snapshotOf(back.directive).step).toBe('recommendation')
    const skipped = await send(controller, { command: 'chooseSkip' })
    expect(skipped.directive).toEqual({ to: 'close', openHosted: false })
    const hosted = await send(controller, { command: 'chooseHosted' })
    expect(hosted.directive).toEqual({ to: 'close', openHosted: true })
  })

  it('ignores commands the step does not offer', async () => {
    const controller = new JudgeSetupController(PATHS, ports())
    const { directive } = await send(controller, { command: 'acceptLicence' })
    expect(directive).toEqual({
      to: 'snapshot',
      snapshot: { step: 'scan', running: false, summary: [] },
    })
  })

  it('derives class rows from eligible and check rows from coverage', () => {
    const rows = doneClassRows(300)
    expect(rows.map((row) => row.timingClass)).toEqual(['I', 'S', 'B', 'P'])
    expect(rows.find((row) => row.timingClass === 'P')).toMatchObject({ on: true })
    expect(rows.find((row) => row.timingClass === 'I')?.reason).toContain('p95 300 ms')
    const unknown = doneClassRows(undefined)
    expect(unknown.filter((row) => row.on).map((row) => row.timingClass)).toEqual(['P'])
    expect(unknown.find((row) => row.timingClass === 'I')?.reason).toContain('unknown')
    const checks = doneCheckRows(['loop.stuck'])
    expect(checks).toHaveLength(11)
    expect(checks.filter((row) => row.on).map((row) => row.family)).toEqual(['loop.stuck'])
  })
})
