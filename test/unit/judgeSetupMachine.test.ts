// M125 lane W (D107 §8.1): the wizard's step machine. Every step
// offers a way out; a running scan or install offers no way forward;
// a recommendation that fits nothing offers no install; the machine
// never advances a step on its own — the host pushes snapshots.
import { describe, expect, it } from 'vitest'
import { isSetupModelPick, setupLegalCommands, setupTransition } from '../../src/shared/judgeSetup'
import type { JudgeSetupSnapshot } from '../../src/shared/judgeSetupSchema'

const scan = (isRunning: boolean): JudgeSetupSnapshot => ({
  step: 'scan',
  running: isRunning,
  summary: [],
})
const recommendation = (model: string | undefined): JudgeSetupSnapshot => ({
  step: 'recommendation',
  ...(model !== undefined && { model }),
  backend: 'cpu',
  classes: [],
  fitting: model === undefined ? [] : [model, 'other-model'],
  reasons: [],
  cpuOnly: false,
  hosted: false,
})
const licence = (): JudgeSetupSnapshot => ({
  step: 'licence',
  model: 'm',
  name: 'test licence',
})
const install = (error: string | undefined): JudgeSetupSnapshot => ({
  step: 'install',
  model: 'm',
  phase: 'fetch',
  ...(error !== undefined && { error }),
})
const done = (): JudgeSetupSnapshot => ({
  step: 'done',
  model: 'm',
  backend: 'cpu',
  classes: [],
  checks: [],
  smokeCorrect: 10,
  smokeTotal: 10,
})

describe('judge setup machine', () => {
  it('offers a way out of every step', () => {
    for (const snapshot of [
      scan(false),
      recommendation('m'),
      licence(),
      install(undefined),
      done(),
    ]) {
      expect(setupLegalCommands(snapshot)).toContain('cancel')
    }
    for (const snapshot of [scan(false), recommendation('m'), licence(), install(undefined)]) {
      expect(setupLegalCommands(snapshot)).toContain('setUpLater')
    }
  })

  it('holds forward motion while work runs', () => {
    expect(setupLegalCommands(scan(true))).toEqual(['cancel', 'setUpLater'])
    expect(setupLegalCommands(install(undefined))).toEqual(['cancel', 'setUpLater'])
    expect(setupLegalCommands(install('failed'))).toContain('startInstall')
    expect(setupLegalCommands(scan(false))).toContain('startScan')
  })

  it('offers no install when nothing fits', () => {
    expect(setupLegalCommands(recommendation(undefined))).not.toContain('startInstall')
    expect(setupLegalCommands(recommendation(undefined))).not.toContain('chooseModel')
    expect(setupLegalCommands(recommendation('m'))).toContain('startInstall')
  })

  it('accepts only fitting Advanced picks', () => {
    const snapshot = recommendation('m')
    expect(isSetupModelPick(snapshot, 'chooseModel', 'other-model')).toBe(true)
    expect(isSetupModelPick(snapshot, 'chooseModel', 'elsewhere')).toBe(false)
    expect(isSetupModelPick(snapshot, 'chooseModel', undefined)).toBe(false)
    expect(isSetupModelPick(scan(false), 'chooseModel', 'm')).toBe(false)
    expect(isSetupModelPick(snapshot, 'back', 'other-model')).toBe(false)
  })

  it('closes, steps back, or waits for the host — never ahead alone', () => {
    expect(setupTransition(scan(false), 'cancel')).toEqual({ to: 'close' })
    expect(setupTransition(scan(true), 'setUpLater')).toEqual({ to: 'close' })
    expect(setupTransition(scan(false), 'startScan')).toEqual({ to: 'stay' })
    expect(setupTransition(recommendation('m'), 'back')).toEqual({ to: 'scan' })
    expect(setupTransition(recommendation('m'), 'chooseHosted')).toEqual({ to: 'close' })
    expect(setupTransition(recommendation('m'), 'chooseSkip')).toEqual({ to: 'close' })
    expect(setupTransition(recommendation('m'), 'startInstall')).toEqual({ to: 'stay' })
    expect(setupTransition(recommendation('m'), 'chooseCpuOnly')).toEqual({ to: 'stay' })
    expect(setupTransition(licence(), 'back')).toEqual({ to: 'recommendation' })
    expect(setupTransition(licence(), 'acceptLicence')).toEqual({ to: 'stay' })
    expect(setupTransition(install('failed'), 'back')).toEqual({ to: 'recommendation' })
    expect(setupTransition(install('failed'), 'startInstall')).toEqual({ to: 'stay' })
    expect(setupTransition(done(), 'cancel')).toEqual({ to: 'close' })
  })
})
