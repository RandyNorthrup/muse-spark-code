// @vitest-environment jsdom
// M107 U–C1/W: the chip through the production chat entry (main.tsx's
// mountChat), not only the component: no status, no chip and no chunk;
// a checked status mounts it; its controls reach the host.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RESOURCE_STATUS_MAX_CHARS, UI_TEXT } from '../../src/shared/constants'
import { resourceStatusSchema } from '../../src/shared/resources'
import {
  MOUNTED_DOCUMENT_ID,
  mountChatEntry,
  resourceChipName,
  resourceStatusText,
} from './helpers/resourceChat'

const mounted = vi.hoisted(() => ({ chunkLoads: 0 }))
vi.mock('../../src/webview/resources/ResourceSurface', async (importOriginal) => {
  mounted.chunkLoads++
  return await importOriginal()
})

// Each test imports a fresh entry (vi.resetModules); an earlier one's root
// stays with its detached container, so queries see only the current chat.
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const status = resourceStatusText
const chipName = resourceChipName
const mountChat = mountChatEntry

it('mounts no chip and loads no chunk until the window governor sends a status', async () => {
  const before = mounted.chunkLoads
  const { deliver } = await mountChat()
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.queryByRole('button', { name: chipName(UI_TEXT.resourcePause) })).toBeNull()
  expect(mounted.chunkLoads).toBe(before)
  deliver({ type: 'resourceStatus', status: status('pause') })
  expect(
    await screen.findByRole('button', { name: chipName(UI_TEXT.resourcePause) }),
  ).toBeInTheDocument()
  expect(mounted.chunkLoads).toBe(before + 1)
})

it('posts each popover control to the host through the production port', async () => {
  const { deliver, postMessage } = await mountChat()
  deliver({ type: 'resourceStatus', status: status('pause') })
  const chip = await screen.findByRole('button', { name: chipName(UI_TEXT.resourcePause) })
  const actions: [string, string][] = [
    [UI_TEXT.resourceResumeNow, 'resume'],
    [UI_TEXT.openSettings, 'settings'],
    [UI_TEXT.resourceShow, 'show'],
  ]
  for (const [label, action] of actions) {
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.resourceTitle })
    expect(dialog).toHaveTextContent(UI_TEXT.resourceRelocationNoRoute)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'resourceAction', action })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(chip)
  }
})

it('pulls on mount, opens only for an offer naming this document, and acknowledges it once', async () => {
  // RVM107W1C pull model through the production mountChat path; RVM107W1D:
  // the chip echoes the id the host wrote into its document, never its own.
  const { deliver, postMessage } = await mountChat()
  // An offer to another document (a replaced one) before the chunk loads.
  deliver({ type: 'resourceOpen', seq: 1, nonce: 'another-document' })
  deliver({ type: 'resourceStatus', status: status('throttle') })
  await screen.findByRole('button', { name: chipName(UI_TEXT.resourceThrottle) })
  const pull = await waitFor(() => {
    const message = postMessage.mock.calls.find(([sent]) => sent.type === 'resourcePull')?.[0]
    if (message?.type !== 'resourcePull') throw new Error('the chip did not pull on mount')
    return message
  })
  const { nonce } = pull
  expect(nonce).toMatch(/^[\w-]{16,64}$/)
  expect(nonce).toBe(MOUNTED_DOCUMENT_ID)
  expect(screen.queryByRole('dialog')).toBeNull()
  const acks = () =>
    postMessage.mock.calls.filter(([message]) => message.type === 'resourceOpenAck')
  expect(acks()).toEqual([])
  deliver({ type: 'resourceOpen', seq: 2, nonce })
  const dialog = await screen.findByRole('dialog', { name: UI_TEXT.resourceTitle })
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
  expect(acks()).toEqual([[{ type: 'resourceOpenAck', seq: 2, nonce }]])
  fireEvent.keyDown(dialog, { key: 'Escape' })
  // The same offer again (the host re-offers until it hears the ack) does not reopen.
  deliver({ type: 'resourceOpen', seq: 2, nonce })
  expect(screen.queryByRole('dialog')).toBeNull()
  deliver({ type: 'resourceOpen', seq: 3, nonce })
  expect(await screen.findByRole('dialog', { name: UI_TEXT.resourceTitle })).toBeInTheDocument()
  expect(acks()).toHaveLength(2)
})

it('follows status changes and shows a refused status as unavailable, never an old reading', async () => {
  const { deliver } = await mountChat()
  const refused = chipName(UI_TEXT.resourceUnknown)
  const expectRefused = async () => {
    const chip = await screen.findByRole('button', { name: refused })
    expect(screen.queryByRole('button', { name: chipName(UI_TEXT.resourceThrottle) })).toBeNull()
    fireEvent.click(chip)
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.resourceTitle })
    expect(dialog).toHaveTextContent(UI_TEXT.resourceStatusRefused)
    expect(dialog).not.toHaveTextContent(UI_TEXT.resourceCpu)
    expect(dialog).not.toHaveTextContent('4242')
    fireEvent.keyDown(dialog, { key: 'Escape' })
  }
  deliver({ type: 'resourceStatus', status: status('pause') })
  await screen.findByRole('button', { name: chipName(UI_TEXT.resourcePause) })
  deliver({ type: 'resourceStatus', status: status('throttle') })
  await screen.findByRole('button', { name: chipName(UI_TEXT.resourceThrottle) })
  // Unknown field: the deferred strict check refuses it and says so.
  deliver({ type: 'resourceStatus', status: status('pause', { pid: 4242 }) })
  await expectRefused()
  deliver({ type: 'resourceStatus', status: status('throttle') })
  await screen.findByRole('button', { name: chipName(UI_TEXT.resourceThrottle) })
  // Unreadable text.
  deliver({ type: 'resourceStatus', status: '{not json' })
  await expectRefused()
  deliver({ type: 'resourceStatus', status: status('throttle') })
  await screen.findByRole('button', { name: chipName(UI_TEXT.resourceThrottle) })
  // An oversized envelope is refused at the boundary, visibly: not the last good reading.
  deliver({
    type: 'resourceStatus',
    status: status('pause', { pad: 'x'.repeat(RESOURCE_STATUS_MAX_CHARS) }),
  })
  await expectRefused()
  // The host's own bound sends null: the same refusal.
  deliver({ type: 'resourceStatus', status: status('throttle') })
  await screen.findByRole('button', { name: chipName(UI_TEXT.resourceThrottle) })
  deliver({ type: 'resourceStatus', status: null })
  await expectRefused()
  // A valid status restores readings; a disabled governor shows no chip.
  deliver({
    type: 'resourceStatus',
    status: JSON.stringify(
      resourceStatusSchema.parse({
        level: 'normal',
        settings: { enabled: false },
        sample: null,
        queued: [],
        overrideUntilMs: null,
      }),
    ),
  })
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: /^Resources:/ })).toBeNull()
  })
})
