import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import { UI_TEXT } from '../../src/shared/constants.ts'
import { LazyResourcesSection } from '../../src/webview/usage/LazyResourcesSection.tsx'

// Fake retained view at the usage bridge boundary; M102's real bridge is absent on this base.
const minute = (atMs, cpuPercent, level) => ({
  type: 'resource',
  atMs: Date.UTC(2026, 9, 6, 17) + atMs,
  event: null,
  minute: {
    cpuPercent,
    memoryUsedPercent: 60,
    gpuPercent: null,
    diskBusyPercent: null,
    availableMemory: 'low',
    level,
    thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
  },
  work: [{ kind: 'check', cpuSeconds: 4, peakMemoryBytes: 7000 }],
})
const history = {
  minutes: [
    minute(0, 40, 'normal'),
    minute(60_000, 95, 'throttle'),
    minute(120_000, null, 'pause'),
    minute(240_000, 20, 'normal'),
  ],
  events: [
    {
      type: 'deferred',
      atMs: Date.UTC(2026, 9, 6, 17) + 60_000,
      kind: 'check',
      class: 'background',
    },
  ],
  counts: [{ type: 'deferred', kind: 'check', count: 1 }],
  work: [{ kind: 'check', cpuSeconds: 16, peakMemoryBytes: 7000 }],
}
function mount() {
  globalThis.document.title = UI_TEXT.resourceTitle
  const root = createRoot(globalThis.document.querySelector('#root'))
  root.render(
    createElement(
      'main',
      null,
      createElement('h1', null, UI_TEXT.usageHeading),
      createElement(LazyResourcesSection, { history }),
    ),
  )
  return root
}

export const root = mount()
