// Authored fixture driver only. Native hosts implement these actions in their
// real editor harness; none of this module ships in a product bundle.
import { contract } from './run.mjs'

export function fakeReport(host = 'jetbrains') {
  const results = []
  for (const backend of contract.backends) {
    for (const scenario of contract.scenarios) {
      const state = {
        text: 'original',
        version: 1,
        dirty: false,
        turns: [],
        responses: 0,
        executions: 0,
        decisions: [],
        refusals: [],
        undoDepth: 0,
        undoTransactions: 0,
        hunks: {},
        diagnostics: [],
        verifyErrors: [],
        checkpoints: 0,
        chargedMicroUsd: 0,
        paidExecutions: 0,
        prompts: [],
        acceptedCompletions: 0,
        settings: {},
        deliveredSequences: [],
      }
      const history = []
      let checkpoint
      let completion
      let isAlways = false
      let nextSeq = 1
      const act = (action) => {
        switch (action.op) {
          case 'send': {
            state.turns.push(action.text)
            state.responses++
            break
          }
          case 'approval': {
            state.decisions.push(action.choice)
            if (action.choice === 'allow') state.executions++
            break
          }
          case 'dirty': {
            state.dirty = action.value
            break
          }
          case 'edit': {
            if (state.dirty) state.refusals.push('MHP_DIRTY_BUFFER')
            else if (state.version === action.version) {
              history.push(state.text)
              state.text = action.text
              state.version++
              state.undoTransactions++
              state.undoDepth = history.length
            } else {
              state.refusals.push('MHP_VERSION_MISMATCH')
            }
            break
          }
          case 'undo': {
            state.text = history.pop()
            state.version++
            state.undoDepth = history.length
            break
          }
          case 'hunk': {
            state.hunks[action.id] = action.choice
            break
          }
          case 'diagnostic': {
            state.diagnostics.push(action)
            break
          }
          case 'verify': {
            state.verifyErrors = state.diagnostics
              .filter((item) => item.severity === 'error')
              .map((item) => item.message)
            break
          }
          case 'checkpoint': {
            checkpoint = state.text
            state.checkpoints++
            break
          }
          case 'restore': {
            state.text = checkpoint
            break
          }
          case 'paid': {
            if (!isAlways) state.prompts.push(action.choice)
            if (action.choice === 'deny') state.refusals.push('PAID_DENIED')
            else if (state.chargedMicroUsd + action.microUsd > 1_000_000)
              state.refusals.push('PAID_BUDGET_EXCEEDED')
            else if (isAlways || action.choice === 'once' || action.choice === 'always') {
              state.chargedMicroUsd += action.microUsd
              state.paidExecutions++
              isAlways = action.choice === 'always' || isAlways
            }
            break
          }
          case 'completion': {
            completion = action.text
            break
          }
          case 'acceptCompletion': {
            state.text += completion
            state.acceptedCompletions++
            break
          }
          case 'setting': {
            state.settings[action.key] = action.value
            break
          }
          case 'readSetting': {
            state.settingValue = state.settings[action.key]
            break
          }
          case 'reload': {
            state.sameSession = true
            state.stateRequested = true
            break
          }
          case 'panel': {
            if (action.seq === nextSeq) {
              state.deliveredSequences.push(action.seq)
              nextSeq++
            } else {
              state.refusals.push('MHP_PANEL_OUT_OF_ORDER')
            }
            break
          }
          default: {
            throw new Error(`UNKNOWN_FIXTURE_ACTION:${action.op}`)
          }
        }
      }
      for (const action of scenario.actions) act(action)
      results.push({ backend, scenario: scenario.id, observations: state, skipped: false })
    }
  }
  return { host, protocol: contract.protocol, results }
}
