// @vitest-environment jsdom
// M107 U–C1/W: the chip through the production chat entry (main.tsx's
// mountChat), not only the component: no status, no chip and no chunk;
// a checked status mounts it; its controls reach the host.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  RESOURCE_GIB_BYTES,
  RESOURCE_STATUS_MAX_CHARS,
  UI_TEXT,
  WEBVIEW_ROOT_ELEMENT_ID,
} from '../../src/shared/constants'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { resourceStatusSchema, type ResourceLevel } from '../../src/shared/resources'
import { testSettings } from './helpers/fakes'

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

function status(level: ResourceLevel, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...resourceStatusSchema.parse({
      level,
      settings: {},
      sample: {
        atMs: 0,
        cpuPercent: 99,
        memoryUsedPercent: 50,
        memoryAvailableBytes: RESOURCE_GIB_BYTES,
        memoryTotalBytes: 8 * RESOURCE_GIB_BYTES,
        gpuPercent: null,
        diskBusyPercent: null,
        pressure: null,
      },
      queued: [{ kind: 'check', class: 'background', count: 2 }],
      overrideUntilMs: null,
      relocation: 'noRoute',
    }),
    ...extra,
  })
}

async function mountChat() {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  const api = { postMessage, setState: vi.fn(), getState: (): unknown => undefined }
  vi.stubGlobal('acquireVsCodeApi', () => api)
  document.body.innerHTML = `<div id="${WEBVIEW_ROOT_ELEMENT_ID}"></div>`
  vi.resetModules()
  await act(async () => {
    await import('../../src/webview/main')
  })
  const deliver = (message: unknown) => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: message }))
    })
  }
  deliver({
    type: 'init',
    emptyStateHint: '',
    composerPlaceholder: '',
    settings: testSettings,
  } satisfies HostToWebviewMessage)
  deliver({ type: 'authState', status: 'signedIn' } satisfies HostToWebviewMessage)
  return { postMessage, deliver }
}

const chipName = (level: string) => `${UI_TEXT.resourceTitle}: ${level}`

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

it('opens the popover for Show resources, even when asked before the chunk loaded', async () => {
  const { deliver } = await mountChat()
  deliver({ type: 'resourceStatus', status: status('throttle') })
  deliver({ type: 'resourceOpen' })
  const dialog = await screen.findByRole('dialog', { name: UI_TEXT.resourceTitle })
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  deliver({ type: 'resourceOpen' })
  expect(await screen.findByRole('dialog', { name: UI_TEXT.resourceTitle })).toBeInTheDocument()
})

it('follows status changes and shows nothing for a status its schema refuses', async () => {
  const { deliver } = await mountChat()
  deliver({ type: 'resourceStatus', status: status('pause') })
  await screen.findByRole('button', { name: chipName(UI_TEXT.resourcePause) })
  deliver({ type: 'resourceStatus', status: status('throttle') })
  expect(
    await screen.findByRole('button', { name: chipName(UI_TEXT.resourceThrottle) }),
  ).toBeInTheDocument()
  // Unknown field: the deferred strict check refuses it and no reading is shown.
  deliver({ type: 'resourceStatus', status: status('pause', { pid: 4242 }) })
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: /^Resources:/ })).toBeNull()
  })
  deliver({ type: 'resourceStatus', status: '{not json' })
  expect(screen.queryByRole('button', { name: /^Resources:/ })).toBeNull()
  // An oversized message is dropped at the boundary; the last good status stays.
  deliver({ type: 'resourceStatus', status: status('throttle') })
  await screen.findByRole('button', { name: chipName(UI_TEXT.resourceThrottle) })
  deliver({
    type: 'resourceStatus',
    status: status('pause', { pad: 'x'.repeat(RESOURCE_STATUS_MAX_CHARS) }),
  })
  expect(screen.getByRole('button', { name: chipName(UI_TEXT.resourceThrottle) })).toBeVisible()
  // A disabled governor shows no chip.
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
