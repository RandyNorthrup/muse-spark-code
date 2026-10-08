// M107 U–C1/W: mount the production chat entry (main.tsx's mountChat) behind a
// fake VS Code API, and build host resource status text for it.
import { act } from '@testing-library/react'
import { vi } from 'vitest'
import {
  RESOURCE_GIB_BYTES,
  UI_TEXT,
  WEBVIEW_DOCUMENT_ATTRIBUTE,
  WEBVIEW_ROOT_ELEMENT_ID,
} from '../../../src/shared/constants'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../../src/shared/protocol'
import { resourceStatusSchema, type ResourceLevel } from '../../../src/shared/resources'
import { testSettings } from './fakes'

export function resourceStatusText(
  level: ResourceLevel,
  extra: Record<string, unknown> = {},
): string {
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

export const resourceChipName = (level: string): string => `${UI_TEXT.resourceTitle}: ${level}`

/** The id a mounted document's body carries, as the host's HTML writes it (M107). */
export const MOUNTED_DOCUMENT_ID = 'host-issued-document'

/** Each call imports a fresh entry; an earlier root stays with its detached container. */
export async function mountChatEntry() {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  const api = { postMessage, setState: vi.fn(), getState: (): unknown => undefined }
  vi.stubGlobal('acquireVsCodeApi', () => api)
  document.body.innerHTML = `<div id="${WEBVIEW_ROOT_ELEMENT_ID}"></div>`
  document.body.setAttribute(WEBVIEW_DOCUMENT_ATTRIBUTE, MOUNTED_DOCUMENT_ID)
  vi.resetModules()
  await act(async () => {
    await import('../../../src/webview/main')
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
