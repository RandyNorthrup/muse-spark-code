// Fake-only M107 scenes. The production mount/loader and components are exercised unchanged.
import { createElement, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../../src/webview/App'
import { ResourceTaskRow } from '../../src/webview/resources/ResourceTaskRow'
import { createResourceSurfaceLoader } from '../../src/webview/resources/resourceLoader'
import { windowResourceLoader } from '../../src/webview/resources/windowPort'
import { createUiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'
import {
  RESOURCE_GIB_BYTES,
  RESOURCE_OVERRIDE_MS,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../../src/shared/constants'
import { resourceStatusSchema } from '../../src/shared/resources'
import { installEmbeddedTable } from '../../src/webview/installTable'
import '../../src/webview/styles.css'

const tableError = installEmbeddedTable(globalThis.document)
if (tableError !== undefined) throw tableError
const params = new globalThis.URLSearchParams(globalThis.location.search)
const surface = params.get('surface') ?? 'panel'
// M107 U–C1/W window scenes: throttle, pause, off (governor disabled), refused (schema-refused text).
const windowScene = surface === 'window' ? (params.get('level') ?? 'throttle') : undefined
const level =
  windowScene === undefined
    ? (params.get('level') ?? 'normal')
    : ({ throttle: 'throttle', pause: 'pause' }[windowScene] ?? 'normal')
const state = {
  snapshot: resourceStatusSchema.parse({
    level,
    settings: { gpuMaxPercent: 50, diskBusyMaxPercent: 50, enabled: windowScene !== 'off' },
    sample: {
      atMs: 0,
      cpuPercent: level === 'normal' ? 20 : 100,
      memoryUsedPercent: level === 'normal' ? 40 : 95,
      memoryAvailableBytes: RESOURCE_GIB_BYTES,
      memoryTotalBytes: RESOURCE_GIB_BYTES * 8,
      gpuPercent: null,
      diskBusyPercent: null,
      pressure: null,
    },
    queued:
      level === 'normal'
        ? []
        : [
            { kind: 'check', class: 'foreground', count: 2 },
            { kind: 'worker', class: 'background', count: 1 },
          ],
    overrideUntilMs: params.has('override') ? RESOURCE_OVERRIDE_MS : null,
  }),
}
const listeners = new Set()
const actions = []
const port = {
  getSnapshot: () => state.snapshot,
  subscribe: (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  resume: () => {
    actions.push('resume')
  },
  settings: () => {
    actions.push('settings')
  },
  show: () => {
    actions.push('show')
  },
}
globalThis.window.resourceHarness = {
  actions,
  publish: (next) => {
    state.snapshot = resourceStatusSchema.parse(next)
    for (const listener of listeners) listener()
  },
  current: () => state.snapshot,
}
const load = async () => {
  const module = await import('../../src/webview/resources/ResourceSurface')
  return { default: module.ResourceSurface }
}
export const root = createRoot(globalThis.document.querySelector('#root'))
if (surface === 'companion') {
  const Component = lazy(load)
  root.render(
    createElement(
      'main',
      { className: 'resource-companion' },
      createElement('h1', {}, UI_TEXT.resourceTitle),
      createElement(Suspense, { fallback: null }, createElement(Component, { port })),
    ),
  )
} else if (surface === 'traffic') {
  root.render(
    createElement(
      'main',
      { className: 'resource-companion' },
      createElement('h1', {}, UI_TEXT.resourceTitle),
      createElement(ResourceTaskRow, {
        kind: 'check',
        workClass: 'foreground',
        phase: 'queued',
        runNow: () => {
          actions.push('runNow')
        },
        target: {
          name: 'Mac mini',
          move: () => {
            actions.push('move')
          },
          keepHere: () => {
            actions.push('keepHere')
          },
        },
      }),
    ),
  )
} else {
  const store = createUiStore(initialUiState)
  const deliver = (raw) => {
    const parsed = parseHostToWebviewMessage(raw)
    if (!parsed.ok) throw new Error(parsed.error)
    store.dispatch({ type: 'hostMessage', message: parsed.message, at: 0 })
  }
  deliver({
    type: 'init',
    settings: SETTING_DEFAULTS,
    emptyStateHint: '',
    composerPlaceholder: UI_TEXT.composerPlaceholder,
  })
  deliver({ type: 'authState', status: 'signedIn' })
  deliver({ type: 'agentEvent', event: { type: 'turnStarted', turnId: 'resource-turn' } })
  deliver({
    type: 'agentEvent',
    event: {
      type: 'itemStarted',
      item: {
        itemId: 'resource-item',
        kind: 'agentMessage',
        status: 'inProgress',
        text: UI_TEXT.resourceTitle,
        turnId: 'resource-turn',
      },
    },
  })
  // The chip's pull names its document (M107 pull model); Show answers it.
  let pulledNonce
  const postMessage = (message) => {
    if (message.type === 'resourcePull') pulledNonce = message.nonce
    actions.push(message.type === 'resourceAction' ? message.action : message.type)
  }
  if (windowScene !== undefined) {
    // The production chat path: the host's bounded status text through the
    // strict wire into the store, mountChat's loader, and resourceOpen for Show.
    const text = JSON.stringify(state.snapshot)
    deliver({
      type: 'resourceStatus',
      status:
        windowScene === 'refused' ? `${text.slice(0, -1)},"pid":4242,"command":"npm test"}` : text,
    })
  }
  // Created once, outside render, as mountChat does.
  const resources =
    windowScene === undefined
      ? createResourceSurfaceLoader(port, load)
      : windowResourceLoader(store, postMessage)
  // Show resources: the host's open for this document's own nonce (pull model).
  globalThis.window.resourceHarness.open = () => {
    deliver({ type: 'resourceOpen', seq: 1, nonce: pulledNonce })
  }
  root.render(createElement(App, { store, resources, postMessage }))
}
