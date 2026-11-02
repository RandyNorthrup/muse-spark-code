/** @vitest-environment jsdom */
import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import { nodeDiagnosticsSchema } from '../../../src/shared/node'
import type { NodeMethodName } from '../../../src/shared/hostApi/nodeMethods'
import { NodePageError } from '../../../src/webview/bridges/nodePort'
import { cleanupNodeUi, mountNodeUi } from '../helpers/nodeUi'

const DAY = Date.UTC(2026, 9, 30, 12, 0, 0)

function respond(method: NodeMethodName): Promise<unknown> {
  if (method === 'node/files/list') return Promise.resolve({ entries: [], nextCursor: null })
  if (method === 'node/diagnostics/read') {
    return Promise.resolve(
      nodeDiagnosticsSchema.parse({
        health: [{ component: 'node', ready: true, detail: 'ready' }],
        export: { on: false },
        dropped: 0,
        unreadable: 0,
        metrics: [
          {
            component: 'node',
            name: 'cpu.time',
            buckets: [{ minute: DAY, count: 2, avg: 4, min: 1, max: 9 }],
          },
        ],
        logs: [{ at: DAY, component: 'node', severity: 9, message: 'started' }],
        traces: [],
        crashes: [],
      }),
    )
  }
  return Promise.reject(new NodePageError('unavailable'))
}

afterEach(cleanupNodeUi)

async function openDiagnostics() {
  const mounted = await mountNodeUi(respond)
  fireEvent.click(mounted.ui.getByRole('button', { name: UI_TEXT.nodeLabels.diagnostics }))
  // The loader's own heading renders before the snapshot arrives; the
  // Health heading proves the read settled.
  await mounted.ui.findByRole('heading', { name: UI_TEXT.nodeDiagnostics.healthTitle })
  return mounted
}

describe('node diagnostics surface', () => {
  it('loads the lazy page on first visit and renders the snapshot', async () => {
    const { ui, request } = await openDiagnostics()
    expect(ui.getByRole('heading', { name: UI_TEXT.nodeDiagnostics.healthTitle })).not.toBeNull()
    expect(ui.getByText(UI_TEXT.nodeDiagnostics.ready)).not.toBeNull()
    expect(ui.getByText(UI_TEXT.nodeDiagnostics.exportOff)).not.toBeNull()
    expect(ui.getByText('started')).not.toBeNull()
    expect(request.calls.filter(([method]) => method === 'node/diagnostics/read')).toHaveLength(1)
  })

  it('re-reads the snapshot on refresh', async () => {
    const { ui, request } = await openDiagnostics()
    fireEvent.click(ui.getByRole('button', { name: UI_TEXT.nodeWorkspace.refresh }))
    await ui.findByText(UI_TEXT.nodeDiagnostics.exportOff)
    expect(request.calls.filter(([method]) => method === 'node/diagnostics/read')).toHaveLength(2)
  })

  it('says the refusal when the read is refused', async () => {
    const mounted = await mountNodeUi((method) =>
      method === 'node/files/list'
        ? Promise.resolve({ entries: [], nextCursor: null })
        : Promise.reject(new NodePageError('locked')),
    )
    fireEvent.click(mounted.ui.getByRole('button', { name: UI_TEXT.nodeLabels.diagnostics }))
    await mounted.ui.findByRole('alert')
    expect(mounted.ui.getByRole('alert').textContent).toBe(UI_TEXT.nodeErrors.locked)
  })
})
