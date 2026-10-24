import type { TabActivationDeps } from '../../../src/host/vscode/tab/tabBundle'
import type { TabConsentScope } from '../../../src/host/tab/tabConsent'
import { UI_TEXT } from '../../../src/shared/constants'

// D48's question answered from a queue: every Tab fixture asks through
// this, so the asked list and the no-answer failure are the same in
// every suite.
export function queuedTabAsk(
  asked: string[],
  answers: (TabConsentScope | undefined)[],
): (model: string) => Promise<TabConsentScope | undefined> {
  return (model) => {
    asked.push(model)
    return answers.length === 0
      ? Promise.reject(new Error('no queued answer'))
      : Promise.resolve(answers.shift())
  }
}

// The Tab services a quiet fixture leaves unheard, at their silent values.
export function quietTabServices(): Pick<
  TabActivationDeps,
  | 'knownLanguages'
  | 'confirmCopilotDisable'
  | 'disableCopilotFor'
  | 'openAccountUsage'
  | 'runCommand'
  | 'table'
  | 'locale'
> {
  return {
    knownLanguages: () => Promise.resolve([]),
    confirmCopilotDisable: () => Promise.resolve(false),
    disableCopilotFor: () => Promise.resolve(),
    openAccountUsage: () => Promise.resolve(),
    runCommand: () => Promise.resolve(),
    table: () => UI_TEXT,
    locale: () => 'en',
  }
}
