import { describe, expect, it, vi } from 'vitest'
import { createReportsHost } from '../../src/runtime/reporting/reportsEntry'
import { reportsMethods } from '../../src/shared/hostApi/reports'
import { REPORT_AS_OF, reportsHarness } from './helpers/reporting/runtime'
import { REPORT_FORMATS, UI_TEXT } from '../../src/shared/constants'
import { RENDERERS, REPORT_THEME } from './reportRenderFixtures'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { compareReports } from '../../src/core/reporting/diff'
import type { ReportsServices } from '../../src/runtime/reporting/reportsCommand'
import { reportsBridge } from './helpers/reporting/bridge'
import { reportDocument } from './helpers/reporting/snapshot'

const workspaceKey = 'workspace-1'
const options = {
  kind: 'project' as const,
  asOf: REPORT_AS_OF,
  scope: '',
  full: false,
  network: false,
  failOn: [],
}

function bridge(services?: ReportsServices) {
  const h = reportsHarness()
  const authorize = vi.fn<(key: string) => Promise<boolean>>(() => Promise.resolve(true))
  const open = vi.fn<(text: string, format: string) => Promise<void>>(() => Promise.resolve())
  const port = createReportsHost({
    ...h.deps,
    ...(services !== undefined && { services }),
    workspaceKey,
    authorize,
    open,
  })
  return { ...h, port, authorize, open }
}

describe('MHP 1.2 reports through native and companion bridges', () => {
  it('validates all five method families on fake JCEF, WebView2, SWT, companion, TUI and desktop callers', async () => {
    for (const surface of ['JCEF', 'WebView2', 'SWT', 'companion', 'TUI', 'desktop']) {
      const fixture = reportsHarness()
      const h = bridge({
        ...fixture.deps.services,
        compare: (from, to) => ({ from: from.header, to: to.header, sections: [] }),
      })
      const request = reportsBridge(h.port)
      expect(
        await request('reports/run', JSON.stringify({ workspaceKey, options })),
        surface,
      ).toMatchObject({ status: 'generated' })
      expect(
        await request('reports/history', JSON.stringify({ workspaceKey, kind: 'project' })),
      ).toMatchObject({ status: 'listed' })
      expect(
        await request(
          'reports/get',
          JSON.stringify({ workspaceKey, kind: 'project', id: 'saved-1' }),
        ),
      ).toMatchObject({ status: 'retrieved' })
      expect(
        await request(
          'reports/compare',
          JSON.stringify({ workspaceKey, kind: 'project', fromId: 'saved-1', toId: 'saved-2' }),
        ),
      ).toMatchObject({ status: 'compared' })
      const run = await h.port.run({ workspaceKey, options })
      expect(reportsMethods['reports/run'].result.safeParse(run).success, surface).toBe(true)
      expect(run.status).toBe('generated')
      const list = await h.port.history({ workspaceKey, kind: 'project' })
      expect(list.status).toBe('listed')
      expect(await h.port.get({ workspaceKey, kind: 'project', id: 'saved-1' })).toMatchObject({
        status: 'retrieved',
      })
      if (run.status !== 'generated') throw new Error('Expected generated report')
      expect(
        await request(
          'reports/open',
          JSON.stringify({ document: run.document, format: surface === 'TUI' ? 'text' : 'html' }),
        ),
      ).toMatchObject({ status: 'opened' })
      expect(h.open).toHaveBeenCalledTimes(1)
    }
  })

  it('authorizes workspace/kind/id before touching storage and rejects path-like keys', async () => {
    const h = bridge()
    for (const key of ['foreign-workspace', '../outside', String.raw`..\outside`]) {
      expect(await h.port.history({ workspaceKey: key, kind: 'project' })).toMatchObject({
        status: 'failed',
      })
      expect(await h.port.get({ workspaceKey: key, kind: 'project', id: 'saved-1' })).toMatchObject(
        { status: 'failed' },
      )
      expect(
        await h.port.compare({
          workspaceKey: key,
          kind: 'project',
          fromId: 'saved-1',
          toId: 'saved-2',
        }),
      ).toMatchObject({ status: 'failed' })
    }
    h.authorize.mockResolvedValue(false)
    expect(await h.port.run({ workspaceKey, options })).toMatchObject({ status: 'failed' })
    expect(await h.port.open({ document: h.document, format: 'html' })).toMatchObject({
      status: 'failed',
    })
    expect(h.history.list).not.toHaveBeenCalled()
    expect(h.history.get).not.toHaveBeenCalled()
    expect(h.generate).not.toHaveBeenCalled()
    expect(h.open).not.toHaveBeenCalled()
  })

  it('refuses a cancelled run before awaiting authorization or generation', async () => {
    const abort = new AbortController()
    abort.abort()
    const h = reportsHarness({ signal: abort.signal })
    const authorize = vi.fn(() => Promise.resolve(true))
    const port = createReportsHost({
      ...h.deps,
      workspaceKey,
      authorize,
      open: () => Promise.resolve(),
    })
    expect(await port.run({ workspaceKey, options })).toEqual({
      status: 'failed',
      reason: UI_TEXT.reportUi.generationFailed,
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(h.generate).not.toHaveBeenCalled()
  })

  it('compares saved inputs only, with the same authorization and verified headers', async () => {
    const h = reportsHarness()
    const compare = vi.fn<NonNullable<ReportsServices['compare']>>((before, after) => ({
      from: before.header,
      to: after.header,
      sections: [],
    }))
    const b = bridge({ ...h.deps.services, compare })
    expect(
      await b.port.compare({ workspaceKey, kind: 'project', fromId: 'saved-1', toId: 'saved-2' }),
    ).toMatchObject({
      status: 'compared',
      diff: { from: h.document.header, to: h.document.header },
    })
    expect(h.history.get.mock.calls).toHaveLength(2)
    expect(h.generate).not.toHaveBeenCalled()
    expect(b.authorize).toHaveBeenCalledTimes(3)
    compare.mockImplementation((before, after) => ({
      from: { ...before.header, scope: 'wrong' },
      to: after.header,
      sections: [],
    }))
    expect(
      await b.port.compare({ workspaceKey, kind: 'project', fromId: 'saved-1', toId: 'saved-2' }),
    ).toMatchObject({ status: 'failed' })
  })

  it('rejects missing/foreign/tampered saved reports, invalid bridge payloads, and revocation during generation', async () => {
    const h = bridge()
    expect(await h.port.get({ workspaceKey, kind: 'session', id: 'saved-1' })).toMatchObject({
      status: 'failed',
    })
    h.history.get.mockRejectedValue(new Error('CANARY-storage-error'))
    expect(await h.port.get({ workspaceKey, kind: 'project', id: 'missing' })).toEqual({
      status: 'failed',
      reason: UI_TEXT.reportUi.generationFailed,
    })
    const tampered = { ...h.document, header: { ...h.document.header, scope: 'CANARY-unverified' } }
    expect(await h.port.open({ document: tampered, format: 'html' })).toMatchObject({
      status: 'failed',
    })
    expect(
      await h.port.run({ workspaceKey, options: { ...options, asOf: 'yesterday' } }),
    ).toMatchObject({ status: 'failed' })
    h.authorize.mockResolvedValueOnce(true).mockResolvedValue(false)
    expect(await h.port.run({ workspaceKey, options })).toMatchObject({ status: 'failed' })
    expect(h.history.save).not.toHaveBeenCalled()
    expect(h.open).not.toHaveBeenCalled()
  })

  it('opens each format using the same renderer and rejects unredacted data', async () => {
    const h = bridge()
    const request = reportsBridge(h.port)
    for (const format of REPORT_FORMATS) {
      expect(
        await request('reports/open', JSON.stringify({ document: h.document, format })),
      ).toMatchObject({
        status: 'opened',
      })
      expect(h.open.mock.lastCall).toEqual([
        RENDERERS[format](h.document, 'en', REPORT_THEME),
        format,
      ])
    }
    const clean = finalizeReport({
      ...h.document,
      header: { ...h.document.header, scope: 'portable' },
    })
    expect(
      await h.port.open({
        document: { ...clean, header: { ...clean.header, scope: 'CANARY' } },
        format: 'html',
      }),
    ).toMatchObject({ status: 'failed' })
    expect(h.open).toHaveBeenCalledTimes(4)
    h.open.mockRejectedValue(new Error('Unsupported host format'))
    expect(
      await request('reports/open', JSON.stringify({ document: h.document, format: 'html' })),
    ).toEqual({
      status: 'failed',
      reason: UI_TEXT.reportUi.generationFailed,
    })
  })

  it('refuses a document when authorization is revoked while history saving awaits', async () => {
    const h = reportsHarness({ keepHistory: true })
    const saving = Promise.withResolvers<undefined>()
    h.history.save.mockImplementation(() => saving.promise)
    const authorize = vi.fn(() => Promise.resolve(true))
    const port = createReportsHost({
      ...h.deps,
      workspaceKey,
      authorize,
      open: vi.fn(),
    })
    const running = port.run({ workspaceKey, options })
    await vi.waitFor(() => {
      expect(h.history.save).toHaveBeenCalledTimes(1)
    })
    authorize.mockResolvedValue(false)
    saving.resolve(undefined)
    expect(await running).toEqual({ status: 'failed', reason: UI_TEXT.reportUi.generationFailed })
  })

  it('refuses a document when cancellation occurs while history saving awaits', async () => {
    const abort = new AbortController()
    const h = reportsHarness({ keepHistory: true, signal: abort.signal })
    const saving = Promise.withResolvers<undefined>()
    h.history.save.mockImplementation(() => saving.promise)
    const port = createReportsHost({
      ...h.deps,
      workspaceKey,
      authorize: () => Promise.resolve(true),
      open: vi.fn(),
    })
    const running = port.run({ workspaceKey, options })
    await vi.waitFor(() => {
      expect(h.history.save).toHaveBeenCalledTimes(1)
    })
    abort.abort()
    saving.resolve(undefined)
    expect(await running).toEqual({ status: 'failed', reason: UI_TEXT.reportUi.generationFailed })
  })

  it('rejects unredacted history headers before returning bridge replies', async () => {
    const fixture = reportsHarness()
    const h = bridge({
      ...fixture.deps.services,
      history: {
        ...fixture.history,
        list: () =>
          Promise.resolve([
            {
              id: 'saved-1',
              header: { ...fixture.document.header, scope: '/home/CANARY/workspace' },
            },
          ]),
      },
    })
    expect(await h.port.history({ workspaceKey, kind: 'project' })).toMatchObject({
      status: 'failed',
    })
  })

  it('compares reports whose decoded cells already hold redaction marks', async () => {
    const fixture = reportsHarness()
    const marked = reportDocument()
    marked.sections[0]!.rows[0]!.cells['state'] = {
      type: 'text',
      value: 'password: "[redacted]"',
    }
    const saved = new Map([
      ['saved-1', finalizeReport(reportDocument())],
      ['saved-2', finalizeReport(marked)],
    ])
    const h = bridge({
      ...fixture.deps.services,
      history: {
        ...fixture.history,
        list: () =>
          Promise.resolve([...saved].map(([id, document]) => ({ id, header: document.header }))),
        get: vi.fn((_kind: string, id: string) => Promise.resolve(saved.get(id)!)),
      },
      compare: compareReports,
    })
    expect(await h.port.get({ workspaceKey, kind: 'project', id: 'saved-2' })).toMatchObject({
      status: 'retrieved',
    })
    expect(
      await h.port.compare({ workspaceKey, kind: 'project', fromId: 'saved-1', toId: 'saved-2' }),
    ).toMatchObject({ status: 'compared' })
  })

  it('rejects unredacted comparison text before returning bridge replies', async () => {
    const fixture = reportsHarness()
    const h = bridge({
      ...fixture.deps.services,
      compare: (from, to) => ({
        from: from.header,
        to: to.header,
        sections: [
          {
            id: 'project',
            label: 'status',
            added: [
              {
                key: 'row',
                cells: { status: { type: 'text', value: '/home/CANARY/workspace' } },
                sourceIds: [],
              },
            ],
            removed: [],
            changed: [],
            unchangedRows: 0,
          },
        ],
      }),
    })
    expect(
      await h.port.compare({ workspaceKey, kind: 'project', fromId: 'saved-1', toId: 'saved-2' }),
    ).toMatchObject({ status: 'failed' })
  })
})
