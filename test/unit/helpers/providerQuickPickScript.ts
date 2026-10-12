// The add-provider quick pick's UI port driven from a script: each question
// takes the next scripted answer, and every error and notice it shows is
// kept for the test to read.

import type { ProviderQuickPickUi } from '../../../src/host/models/modelsQuickPick'

interface QuickPickScript {
  readonly pickOne?: (string | undefined)[]
  readonly pickMany?: (readonly string[] | undefined)[]
  readonly inputText?: (string | undefined)[]
  readonly confirmSave?: boolean[]
}

/**
 * A UI that answers from `script` in order: a pick or a text field past its
 * answers is dismissed, and an unscripted save confirmation is declined.
 */
export function scriptedUi(script: QuickPickScript): ProviderQuickPickUi & {
  readonly errors: string[]
  readonly notices: string[]
} {
  const errors: string[] = []
  const notices: string[] = []
  const pickOne = [...(script.pickOne ?? [])]
  const pickMany = [...(script.pickMany ?? [])]
  const inputText = [...(script.inputText ?? [])]
  const confirmSave = [...(script.confirmSave ?? [])]
  return {
    errors,
    notices,
    pickOne: () => Promise.resolve(pickOne.shift()),
    pickMany: () => Promise.resolve(pickMany.shift()),
    inputText: () => Promise.resolve(inputText.shift()),
    confirmSave: () => Promise.resolve(confirmSave.shift() ?? false),
    showError: (message) => {
      errors.push(message)
    },
    showNotice: (message) => {
      notices.push(message)
    },
  }
}
