// M125 lane W (D107 §8.1): the Set Up Local Judge wizard's step
// machine. Pure: which commands each step offers and where each one
// leads. The host runs the scan and the install and pushes fresh
// snapshots; the webview renders steps and sends commands. `cancel`
// and `setUpLater` close from every step; `done` is terminal and
// closes through `cancel` alone — deferring a finished install is
// meaningless, so the Done step offers Close, not Later.
import type { JudgeSetupCommand, JudgeSetupSnapshot } from './judgeSetupSchema'

/** Where a command leaves the wizard: a step, a close, or a host round-trip. */
export type JudgeSetupTransition =
  { readonly to: 'close' } | { readonly to: 'stay' } | { readonly to: 'scan' | 'recommendation' }

/**
The commands a step offers. A running scan and a running install offer
no way forward until they settle — only out. A recommendation that
fits nothing offers no install.
*/
export function setupLegalCommands(snapshot: JudgeSetupSnapshot): readonly JudgeSetupCommand[] {
  switch (snapshot.step) {
    case 'scan': {
      return snapshot.running ? ['cancel', 'setUpLater'] : ['startScan', 'cancel', 'setUpLater']
    }
    case 'recommendation': {
      return snapshot.model === undefined
        ? ['chooseCpuOnly', 'chooseHosted', 'chooseSkip', 'back', 'cancel', 'setUpLater']
        : [
            'startInstall',
            'chooseModel',
            'chooseCpuOnly',
            'chooseHosted',
            'chooseSkip',
            'back',
            'cancel',
            'setUpLater',
          ]
    }
    case 'licence': {
      return ['acceptLicence', 'back', 'cancel', 'setUpLater']
    }
    case 'install': {
      return snapshot.error === undefined
        ? ['cancel', 'setUpLater']
        : ['startInstall', 'back', 'cancel', 'setUpLater']
    }
    case 'done': {
      return ['cancel']
    }
  }
}

/** A `chooseModel` pick names a model the recommendation fits. */
export function isSetupModelPick(
  snapshot: JudgeSetupSnapshot,
  command: JudgeSetupCommand,
  model: string | undefined,
): boolean {
  return (
    command === 'chooseModel' &&
    snapshot.step === 'recommendation' &&
    model !== undefined &&
    snapshot.fitting.includes(model)
  )
}

/**
Where a legal command leaves the wizard. `stay` means the host works
(a scan runs, the recommender re-runs, the install advances) and pushes
the next snapshot; the machine never advances a step on its own.
*/
export function setupTransition(
  snapshot: JudgeSetupSnapshot,
  command: JudgeSetupCommand,
): JudgeSetupTransition {
  if (command === 'cancel' || command === 'setUpLater') return { to: 'close' }
  switch (snapshot.step) {
    case 'scan': {
      return { to: 'stay' }
    }
    case 'recommendation': {
      if (command === 'back') return { to: 'scan' }
      return { to: command === 'chooseHosted' || command === 'chooseSkip' ? 'close' : 'stay' }
    }
    case 'licence': {
      return { to: command === 'back' ? 'recommendation' : 'stay' }
    }
    case 'install': {
      return { to: command === 'back' ? 'recommendation' : 'stay' }
    }
    case 'done': {
      return { to: 'close' }
    }
  }
}
