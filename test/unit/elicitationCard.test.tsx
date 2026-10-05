// @vitest-environment jsdom
// MCP form controls and the real reducer, using the negotiated spec's fields.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ElicitationCard } from '../../src/webview/components/ElicitationCard'
import type { PendingElicitation } from '../../src/webview/state/uiState'
import { hasPendingRequest, initialUiState, uiReducer } from '../../src/webview/state/uiState'
import { webviewStateOf } from '../../src/webview/state/snapshot'
import { UI_TEXT } from '../../src/shared/constants'

const FORM: PendingElicitation = {
  elicitationId: 'e1',
  server: 'srv',
  message: 'Choose your profile',
  fields: [
    { name: 'email', title: 'Email', type: 'string', format: 'email', required: true },
    { name: 'age', title: 'Age', type: 'integer', minimum: 1, maximum: 2, required: false },
    {
      name: 'colour',
      title: 'Colour',
      type: 'string',
      enum: ['r', 'b'],
      enumNames: ['Red', 'Blue'],
      required: true,
    },
    { name: 'robot', title: 'Robot', type: 'boolean', required: true },
  ],
}

function show(form = FORM) {
  const callbacks = { onAccept: vi.fn(), onDecline: vi.fn(), onCancel: vi.fn() }
  const view = render(<ElicitationCard form={form} {...callbacks} />)
  return { ...callbacks, ...view }
}

function fillForm() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
    target: { value: 'private@example.com' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'Red' }))
}

describe('MCP elicitation card', () => {
  it('labels every control and enum group and validates format and bounds', () => {
    const t = show()
    const send = screen.getByRole('button', { name: UI_TEXT.elicitationSend })
    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Robot' })).toBeTruthy()
    expect(send.hasAttribute('disabled')).toBe(true)
    fillForm()
    fireEvent.change(screen.getByRole('textbox', { name: 'Age' }), { target: { value: '3' } })
    expect(send.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Age' }).getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(screen.getByRole('textbox', { name: 'Age' }), { target: { value: '2' } })
    fireEvent.click(send)
    expect(t.onAccept).toHaveBeenCalledWith('e1', {
      email: 'private@example.com',
      age: 2,
      colour: 'r',
      robot: false,
    })
  })

  it('submits with the form keyboard path and cancels with Escape', () => {
    const t = show()
    fillForm()
    fireEvent.submit(screen.getByRole('form'))
    expect(t.onAccept).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Email' }), { key: 'Escape' })
    expect(t.onCancel).toHaveBeenCalledWith('e1')
  })

  it('declines and cancels without forwarding draft values', () => {
    const t = show()
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.elicitationDecline }))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.elicitationCancel }))
    expect(t.onDecline).toHaveBeenCalledWith('e1')
    expect(t.onCancel).toHaveBeenCalledWith('e1')
    expect(t.onAccept).not.toHaveBeenCalled()
  })

  it('locks submitted forms until a host refusal unlocks them', () => {
    const t = show({ ...FORM, isSubmitted: true })
    fireEvent.submit(screen.getByRole('form'))
    fireEvent.keyDown(screen.getByRole('form'), { key: 'Escape' })
    expect(t.onAccept).not.toHaveBeenCalled()
    expect(t.onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('form').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('textbox', { name: 'Email' }).closest('fieldset')?.disabled).toBe(true)
    t.rerender(
      <ElicitationCard
        form={{ ...FORM, isSubmitted: false }}
        onAccept={t.onAccept}
        onDecline={t.onDecline}
        onCancel={t.onCancel}
      />,
    )
    fillForm()
    fireEvent.submit(screen.getByRole('form'))
    expect(t.onAccept).toHaveBeenCalledTimes(1)
  })

  it('isolates enum radio names across concurrent cards', () => {
    const t = show()
    const other = { ...FORM, elicitationId: 'e2' }
    render(
      <ElicitationCard form={other} onAccept={vi.fn()} onDecline={vi.fn()} onCancel={vi.fn()} />,
    )
    const radios = screen.getAllByRole('radio', { name: 'Red' })
    expect(radios[0]?.getAttribute('name')).not.toBe(radios[1]?.getAttribute('name'))
    t.unmount()
  })
})

function requested() {
  return uiReducer(initialUiState, {
    type: 'hostMessage',
    at: 1,
    message: {
      type: 'agentEvent',
      event: { type: 'elicitationRequested', ...FORM, fields: [...FORM.fields], itemId: 'tool1' },
    },
  })
}

describe('elicitation reducer and persistence', () => {
  it('keeps drafts out of persistence and clears the form on settlement', () => {
    const state = requested()
    expect(state.transcript[0]).toMatchObject({ elicitation: { elicitationId: 'e1' } })
    expect(hasPendingRequest(state)).toBe(true)
    const locked = uiReducer(state, { type: 'elicitationSubmitted', elicitationId: 'e1' })
    expect(locked.transcript[0]).toMatchObject({ elicitation: { isSubmitted: true } })
    const settled = uiReducer(locked, {
      type: 'hostMessage',
      at: 2,
      message: {
        type: 'agentEvent',
        event: { type: 'elicitationSettled', elicitationId: 'e1', action: 'accept' },
      },
    })
    expect(settled.transcript[0]).toMatchObject({ elicitation: undefined })
    expect(hasPendingRequest(settled)).toBe(false)
    expect(JSON.stringify(webviewStateOf(state, true))).not.toContain('private@example.com')
    expect(JSON.stringify(webviewStateOf(settled, true))).not.toContain('private@example.com')
  })
})
