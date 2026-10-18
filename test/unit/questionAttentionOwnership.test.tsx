// @vitest-environment jsdom
// Panel-focus ownership for async arrivals (the review's finding on D116):
// a question or approval card, and the legal report's arriving headings,
// move the keyboard only while their surface already holds it. Through the
// real components with the keyboard genuinely elsewhere (`document.hasFocus()`
// false on a fresh document, true via a real focus): no mocks, no fake
// timers, no stand-in for any module under test. The legal dialog's own modal
// takes focus on open, which jsdom cannot undo, so that one test pins the
// window-focus bit itself (restored afterwards) while every focus call stays
// real.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { LegalFinding, LegalScanResult } from '../../src/shared/legal'
import type { LegalFixPreviewMessage, LegalFixResultMessage } from '../../src/shared/legalFix'
import { AttentionDock } from '../../src/webview/components/AttentionDock'
import { LegalReport } from '../../src/webview/components/LegalReport'
import { QuestionDock, type QuestionDockProps } from '../../src/webview/components/QuestionUi'
import { QuestionSurface } from '../../src/webview/components/QuestionSurface'
import type { PendingQuestion } from '../../src/webview/state/uiState'
import { approvalFixture, questionFixture } from './helpers/questions/fixtures'

const noop = (): void => undefined

type Group = QuestionDockProps['questionGroup']

function group(questions: readonly PendingQuestion[]): Group {
  return {
    questions,
    elicitations: [],
    onAnswer: noop,
    onCancel: noop,
    onClarify: noop,
    onAcceptElicitation: noop,
    onDeclineElicitation: noop,
    onCancelElicitation: noop,
    onJump: noop,
  }
}

function waitingQuestion(): PendingQuestion {
  return { ...questionFixture({ state: 'waiting', deferredAt: undefined }) }
}

/** The keyboard is genuinely elsewhere: blur whatever holds it, then prove it. */
function leaveKeyboardElsewhere(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
  expect(document.hasFocus()).toBe(false)
}

/** Hold the keyboard on a real button so the surface owns it; caller removes it. */
function ownKeyboard(): HTMLButtonElement {
  const owned = document.createElement('button')
  owned.textContent = 'owned'
  document.body.append(owned)
  owned.focus()
  expect(document.hasFocus()).toBe(true)
  return owned
}

function dockedQuestion(questionGroup: Group, navigation?: { readonly userInputId: string }) {
  return (
    <QuestionSurface
      sessionId="session-1"
      navigation={
        navigation === undefined ? undefined : { userInputId: navigation.userInputId, sequence: 1 }
      }
      onDismiss={noop}
    >
      <QuestionDock questionGroup={questionGroup} hasApproval={false} isInert={false} />
    </QuestionSurface>
  )
}

const finding: LegalFinding = {
  id: 'F1',
  severity: 'should-fix',
  category: 'dependencyLicense',
  packageName: 'left-pad',
  evidenceSource: 'the installed manifest',
  confidence: 1,
  explanation: 'Copyleft in the shipped bundle.',
  recommendation: 'Replace the dependency.',
  fixable: true,
}

const result: LegalScanResult = {
  version: 1,
  ruleVersion: '1',
  dataVersion: '1',
  scope: '',
  distribution: 'A test distribution.',
  exclusions: [],
  incompleteChecks: [],
  findings: [finding],
}

const preview: LegalFixPreviewMessage = {
  type: 'legalFixPreview',
  previewId: 'p1',
  eligible: ['F1'],
  excluded: [],
  paths: [],
}

const fixResult: LegalFixResultMessage = {
  type: 'legalFixResult',
  previewId: 'p1',
  outcome: 'applied',
  applied: [],
  failed: [],
}

function report(
  previewMessage: LegalFixPreviewMessage | undefined,
  fixResultMessage: LegalFixResultMessage | undefined,
) {
  return (
    <LegalReport
      result={result}
      preview={previewMessage}
      fixResult={fixResultMessage}
      permissionMode="manual"
      onRequestFix={noop}
      onConfirm={noop}
      onRescan={noop}
      onOpenFile={noop}
      onClose={noop}
    />
  )
}

describe('async arrivals keep the keyboard where it is (D116)', () => {
  it('leaves focus untouched when a question arrives behind a file', () => {
    leaveKeyboardElsewhere()
    const view = render(dockedQuestion(group([])))
    expect(document.activeElement).toBe(document.body)
    // The model's act, not the person's: the card arrives while the surface
    // does not hold the keyboard.
    view.rerender(dockedQuestion(group([waitingQuestion()])))
    expect(document.hasFocus()).toBe(false)
    // Something focusable arrived (its absence would vacate this test), and
    // the keyboard never moved onto it.
    const card = within(view.container).getByRole('group', { name: 'Colour' })
    expect(card).toBeVisible()
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves focus untouched when an approval arrives behind a file', () => {
    leaveKeyboardElsewhere()
    const view = render(
      <QuestionSurface sessionId="session-1" navigation={undefined} onDismiss={noop}>
        <AttentionDock waiting={[]} onDecide={noop} questionGroup={group([])} />
      </QuestionSurface>,
    )
    view.rerender(
      <QuestionSurface sessionId="session-1" navigation={undefined} onDismiss={noop}>
        <AttentionDock waiting={[approvalFixture()]} onDecide={noop} questionGroup={group([])} />
      </QuestionSurface>,
    )
    expect(document.hasFocus()).toBe(false)
    expect(within(view.container).getByRole('button', { name: 'Allow once' })).toBeVisible()
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves focus untouched when a navigated dock card arrives behind a file', () => {
    leaveKeyboardElsewhere()
    const view = render(dockedQuestion(group([waitingQuestion()]), { userInputId: 'q-1' }))
    expect(document.hasFocus()).toBe(false)
    // The navigated card rendered its controls (there is somewhere to steal
    // to), and the keyboard never moved onto them.
    const control = within(view.container).getByLabelText('Other: Colour')
    expect(control).toBeVisible()
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the legal preview and result headings unfocused while the window is unfocused', () => {
    // The review's case: an arrival behind a file — here, a window that does
    // not have system focus — must not take the keyboard. jsdom cannot
    // un-own a document after a real focus (its blur parks focus on the
    // viewport) and this dialog's modal takes focus on open, so the test pins
    // the window-focus bit itself and restores it afterwards; every component
    // stays the real one and every focus call stays real.
    const ownedQuery = document.hasFocus
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
    try {
      const view = render(report(undefined, undefined))
      // The person's own gesture moves the dialog to its preview flow; the
      // keyboard stays where the pinned window says it is.
      fireEvent.click(screen.getByRole('checkbox', { name: /F1/ }))
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.legalPreviewFixes }))
      expect(document.hasFocus()).toBe(false)
      const before = document.activeElement
      // The preview arrives: its heading renders but takes no focus.
      view.rerender(report(preview, undefined))
      const previewHeading = screen.getByText(UI_TEXT.legalFixPreviewTitle)
      expect(previewHeading).toBeVisible()
      expect(document.activeElement).toBe(before)
      // The result arrives: same ownership, same outcome.
      view.rerender(report(preview, fixResult))
      expect(document.hasFocus()).toBe(false)
      expect(document.activeElement).toBe(before)
    } finally {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: ownedQuery })
    }
  })

  it('still focuses an arriving legal result heading while the surface holds the keyboard', () => {
    // The owned control for the result path: opening the dialog is the
    // person's own gesture, so a result that arrived with the open lands on
    // its heading. An unowned arrival is not reachable here: the dialog's
    // modal takes focus on open (that same gesture), and jsdom ownership is
    // one-way afterwards, so nothing later can run while unowned.
    render(report(undefined, fixResult))
    expect(document.hasFocus()).toBe(true)
    expect(screen.getByText(UI_TEXT.legalFixPreviewTitle)).toHaveFocus()
  })

  it('still focuses a navigated dock card while the surface holds the keyboard', () => {
    // The owned control for the navigated-card path (QuestionUi's own guard):
    // the same arrival lands when the keyboard is already here.
    const owned = ownKeyboard()
    try {
      const view = render(dockedQuestion(group([waitingQuestion()]), { userInputId: 'q-1' }))
      expect(view.container.contains(document.activeElement)).toBe(true)
      expect(document.activeElement).not.toBe(owned)
    } finally {
      owned.remove()
    }
  })

  it('still focuses the legal preview heading while the surface holds the keyboard', () => {
    // The owned control for the preview path: opening the dialog is the
    // person's own gesture, so the arriving preview lands on its heading.
    // (Reaching the preview needs the preview flow, which only the dialog's
    // own controls enter; those controls focus in every real DOM, so this
    // path is owned by construction.)
    render(report(preview, undefined))
    expect(document.hasFocus()).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /F1/ }))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.legalPreviewFixes }))
    expect(screen.getByText(UI_TEXT.legalFixPreviewTitle)).toHaveFocus()
  })

  it('still focuses an arriving question while the surface holds the keyboard', () => {
    // The owned control: the same arrival lands when the keyboard is already
    // here, so the unowned tests above can actually fail. Runs last: jsdom
    // keeps ownership once anything has focused.
    const owned = ownKeyboard()
    try {
      const view = render(dockedQuestion(group([waitingQuestion()])))
      expect(view.container.contains(document.activeElement)).toBe(true)
    } finally {
      owned.remove()
    }
  })
})
