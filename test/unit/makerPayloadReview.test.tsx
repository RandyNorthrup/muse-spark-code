// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { MachineWizard } from '../../src/webview/maker/MachineWizard'
import { ApprovalDialog } from '../../src/webview/maker/ApprovalDialog'
import { PayloadReview } from '../../src/webview/maker/PayloadReview'
import { MakerSurface } from '../../src/webview/maker/MakerSurface'
import {
  installMakerBrowser,
  uiApproval,
  uiBridge,
  MAKER_UI_STATE,
  MAKER_UI_ID,
} from './helpers/makerUi'

const browser = { visible: vi.fn<ReturnType<typeof installMakerBrowser>>() }
beforeEach(() => {
  browser.visible = installMakerBrowser()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setUiText(EN, 'en')
})
const hash = (content: string) => createHash('sha256').update(content).digest('hex')

it.each([30, 6000])(
  'keyboard focus wrap cannot approve unseen lines (%s lines)',
  async (length) => {
    const payload = Array.from({ length }, () => 'G1 X1').join('\n')
    const answer = vi.fn()
    const rendered = vi.fn()
    const request = { ...uiApproval(), payload, digest: hash(payload) }
    render(<ApprovalDialog request={request} onAnswer={answer} onRendered={rendered} stop={null} />)
    const send = screen.getByRole('button', { name: UI_TEXT.makerSendOnce })
    await waitFor(() => {
      expect(rendered).toHaveBeenCalledWith(request.digest)
    })
    const close = screen.getByRole('button', { name: UI_TEXT.usageClose })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('region'))
    expect(send).toBeDisabled()
    fireEvent.keyDown(document.activeElement ?? close, { key: 'Enter' })
    fireEvent.click(send)
    expect(answer).not.toHaveBeenCalled()
    act(() => {
      browser.visible([0, length - 1])
    })
    expect(send).toBeDisabled()
    act(() => {
      browser.visible()
    })
    expect(send).toBeEnabled()
    fireEvent.click(send)
    expect(answer).toHaveBeenCalledExactlyOnceWith('allow_once')
  },
)
it('screen-reader traversal visits every line and Next page focuses payload', async () => {
  const payload = Array.from({ length: 30 }, () => 'G1 X1').join('\n')
  const request = { ...uiApproval(), payload, digest: hash(payload) }
  render(<ApprovalDialog request={request} onAnswer={vi.fn()} onRendered={vi.fn()} stop={null} />)
  const send = screen.getByRole('button', { name: UI_TEXT.makerSendOnce })
  const lines = document.querySelectorAll<HTMLElement>('.maker-payload > span')
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerNextPage }))
  const focus = document.activeElement
  expect(
    focus instanceof HTMLElement && focus.parentElement?.classList.contains('maker-payload'),
  ).toBe(true)
  expect(send).toBeDisabled()
  for (const line of lines) fireEvent.focus(line)
  await waitFor(() => expect(send).toBeEnabled())
  expect(screen.getByRole('status')).toHaveTextContent('30 of 30 lines reviewed')
})
it('receipts bind DOM bytes on paint, replacement, appearance and visibility return', async () => {
  const receipt = vi.fn()
  const { rerender } = render(<PayloadReview content={'G1 X1\n\nG1 X2\n'} onRendered={receipt} />)
  await waitFor(() => {
    expect(receipt).toHaveBeenLastCalledWith(hash('G1 X1\n\nG1 X2\n'))
  })
  rerender(<PayloadReview content="G1 X200" onRendered={receipt} />)
  await waitFor(() => {
    expect(receipt).toHaveBeenLastCalledWith(hash('G1 X200'))
  })
  receipt.mockClear()
  document.documentElement.setAttribute('lang', 'de')
  await waitFor(() => {
    expect(receipt).toHaveBeenCalledOnce()
  })
  receipt.mockClear()
  document.body.className = 'vscode-light'
  await waitFor(() => {
    expect(receipt).toHaveBeenCalledOnce()
  })
  receipt.mockClear()
  document.dispatchEvent(new Event('visibilitychange'))
  await waitFor(() => {
    expect(receipt).toHaveBeenCalledOnce()
  })
  const pre = screen.getByRole('region')
  pre.textContent = 'G1 X999'
  await waitFor(() => {
    expect(receipt).toHaveBeenLastCalledWith(hash('G1 X999'))
  })
})
it('the A to B receipt sequence irrevocably rejects a pending approval', () => {
  const { store, post } = uiBridge()
  store.receive(MAKER_UI_STATE)
  const payload = Array.from({ length: 34 }, () => 'G1 X1').join('\n')
  const request = { ...uiApproval(), payload, digest: hash(payload) }
  store.receive({ v: 1, type: 'makerApproval', request })
  store.previewRendered(request.id, request.digest)
  store.previewRendered(request.id, hash(payload.replaceAll('X1', 'X200')))
  store.previewRendered(request.id, request.digest)
  expect(store.answer(request.id, 'allow_once')).toBe(false)
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'makerAnswer',
      answer: expect.objectContaining({ decision: 'reject_once' }),
    }),
  )
  store.dispose()
})
it('the read-only payload view posts the V id and freshly computed digest', async () => {
  const { store, post } = uiBridge()
  store.receive(MAKER_UI_STATE)
  store.receive({
    v: 1,
    type: 'makerPreview',
    preview: { kind: 'payload', id: MAKER_UI_ID, title: 'Payload', content: 'G1 X200' },
  })
  render(<MakerSurface store={store} />)
  await waitFor(() => {
    expect(post).toHaveBeenCalledWith({
      v: 1,
      type: 'makerPreviewRendered',
      id: MAKER_UI_ID,
      digest: hash('G1 X200'),
    })
  })
  store.dispose()
})

it('serial hex receipts bind decoded bytes, including non-printable bytes', async () => {
  const receipt = vi.fn()
  render(<PayloadReview content="00ff" encoding="hex" onRendered={receipt} />)
  await waitFor(() => {
    expect(receipt).toHaveBeenCalledWith(
      createHash('sha256')
        .update(Uint8Array.from([0, 255]))
        .digest('hex'),
    )
  })
})
it('translated categories keep their original wire values', () => {
  setUiText({ ...EN, makerCategoryPrinter: '3D-Drucker', makerCategoryRobot: 'Roboter' }, 'de')
  render(<MachineWizard stop={null} send={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByRole('option', { name: '3D-Drucker' })).toHaveValue('printer')
  expect(screen.getByRole('option', { name: 'Roboter' })).toHaveValue('robot')
})

it('covered payload lines do not count as reviewed', async () => {
  const request = uiApproval()
  const rendered = vi.fn()
  render(<ApprovalDialog request={request} onAnswer={vi.fn()} onRendered={rendered} stop={null} />)
  await waitFor(() => {
    expect(rendered).toHaveBeenCalledWith(request.digest)
  })
  const send = screen.getByRole('button', { name: UI_TEXT.makerSendOnce })
  const point = vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
  act(() => {
    browser.visible()
  })
  expect(send).toBeDisabled()
  point.mockRestore()
  act(() => {
    browser.visible()
  })
  await waitFor(() => expect(send).toBeEnabled())
})
