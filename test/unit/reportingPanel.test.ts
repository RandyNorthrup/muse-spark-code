import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ReportPanel,
  type ReportPanelDeps,
  type ReportPanelEngine,
} from '../../src/host/reporting/reportPanel'
import { reportEngineLoader } from '../../src/host/reporting/reportEngineBundle'
import { reportPanelLoader } from '../../src/host/reporting/reportPanelBundle'
import { reportScrubber } from '../../src/core/reporting/render/redaction'
import { finalizeReport, verifyReport } from '../../src/core/reporting/render/canonical'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { ReportsHostPort } from '../../src/shared/hostApi/reports'
import type { ReportDocument } from '../../src/shared/reportSchema'
import { reportingHostMessageSchema } from '../../src/webview/reporting/protocol'
import { REPORT_THEME, RENDERERS, renderFixture } from './reportRenderFixtures'
import { FakeWebviewPanel, fakeHostContext } from './helpers/fakes'
import { window as fakeWindow, env, workspace, Uri } from './mocks/vscode'

function panel() {
  const result: unknown = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
  if (!(result instanceof FakeWebviewPanel)) throw new Error('Expected fake report panel')
  return result
}

function setup() {
  const document = renderFixture()
  const reports = {
    run: vi.fn<ReportsHostPort['run']>().mockResolvedValue({ status: 'generated', document }),
    history: vi
      .fn<ReportsHostPort['history']>()
      .mockResolvedValue({ status: 'listed', entries: [] }),
    get: vi.fn<ReportsHostPort['get']>().mockResolvedValue({ status: 'retrieved', document }),
    compare: vi.fn<ReportsHostPort['compare']>(),
  }
  const engine: ReportPanelEngine = {
    reports,
    render: RENDERERS,
    verify: verifyReport,
    scrub: reportScrubber(),
  }
  const attachMarkdown = vi.fn<ReportPanelDeps['attachMarkdown']>().mockResolvedValue(undefined)
  const openProblem = vi.fn<ReportPanelDeps['openProblem']>().mockResolvedValue(undefined)
  const load = vi.fn(() => engine)
  const context = fakeHostContext()
  const ui = new ReportPanel({
    context,
    workspaceKey: 'workspace-fixture',
    engine: load,
    now: () => '2026-10-06T12:00:00Z',
    theme: () => REPORT_THEME,
    attachMarkdown,
    openProblem,
  })
  const state = () =>
    reportingHostMessageSchema.parse(panel().webview.postMessage.mock.calls.at(-1)?.[0])
  const act = async (message: unknown) => {
    panel().webview.messages.fire(message)
    await vi.waitFor(() => {
      expect(state().busy).toBe(false)
    })
  }
  return {
    ui,
    reports,
    document,
    engine,
    attachMarkdown,
    openProblem,
    load,
    context,
    panel,
    state,
    act,
  }
}

describe('M113 VS Code report tab', () => {
  beforeEach(() => {
    setUiText(EN, 'en')
    fakeWindow.createWebviewPanel.mockClear()
    fakeWindow.createWebviewPanel.mockImplementation(
      (type, title) => new FakeWebviewPanel(type, title),
    )
    fakeWindow.showSaveDialog.mockReset()
    fakeWindow.showQuickPick.mockReset()
    fakeWindow.showInputBox.mockReset()
    env.clipboard.writeText.mockReset()
    env.clipboard.writeText.mockResolvedValue(undefined)
    workspace.fs.writeFile.mockReset()
    workspace.fs.writeFile.mockResolvedValue(undefined)
  })

  it('loads nothing at construction and sends the verified report only after ready', async () => {
    const t = setup()
    expect(t.load).not.toHaveBeenCalled()
    expect(fakeWindow.createWebviewPanel).not.toHaveBeenCalled()
    await t.ui.open('project --full')
    const panel = t.panel()
    expect(panel.viewType).toBe('museSpark.reportingPanel')
    expect(panel.webview.html).toContain('reportingPage.js')
    expect(panel.webview.html).toContain("default-src 'none'")
    expect(panel.webview.html).toContain("script-src 'nonce-")
    expect(fakeWindow.createWebviewPanel.mock.calls[0]?.[3]).toMatchObject({
      enableCommandUris: false,
    })
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
    panel.webview.messages.fire({ type: 'reportingReady' })
    expect(t.state().header).toEqual(t.document.header)
    expect(t.state().html).toContain('Needs you')
    expect(t.reports.run).toHaveBeenCalledWith({
      workspaceKey: 'workspace-fixture',
      options: expect.objectContaining({ kind: 'project', full: true, network: false }),
    })
    panel.webview.messages.fire({ type: 'reportingReady' })
    expect(t.state().html).toContain('Needs you')
  })

  it('copies and attaches renderer Markdown without submitting a model turn', async () => {
    const t = setup()
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    await t.act({ type: 'reportingAction', action: 'copy' })
    const expected = RENDERERS.md(t.document, 'en', REPORT_THEME)
    expect(env.clipboard.writeText).toHaveBeenCalledWith(expected)
    expect(t.state().status).toBe(EN.reportUi.copied)
    await t.act({ type: 'reportingAction', action: 'attach' })
    expect(t.attachMarkdown).toHaveBeenCalledWith(expected)
    expect(t.state().status).toBe(EN.reportUi.attached)
    expect(t.reports.run).toHaveBeenCalledOnce()
  })

  it('saves all four formats only to the dialog URI and writes nothing on cancel', async () => {
    const t = setup()
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    for (const format of ['md', 'html', 'json', 'text'] as const) {
      const uri = Uri.file(`C:/chosen/report.${format}`)
      fakeWindow.showSaveDialog.mockResolvedValueOnce(uri)
      await t.act({ type: 'reportingSave', format })
      expect(workspace.fs.writeFile).toHaveBeenLastCalledWith(
        uri,
        Buffer.from(RENDERERS[format](t.document, 'en', REPORT_THEME)),
      )
    }
    expect(fakeWindow.showSaveDialog.mock.calls.at(-1)?.[0]?.filters).toEqual({ text: ['txt'] })
    fakeWindow.showSaveDialog.mockResolvedValueOnce(undefined)
    await t.act({ type: 'reportingSave', format: 'json' })
    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(4)
  })

  it('rejects malformed actions, foreign history ids and unverified documents', async () => {
    const t = setup()
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    for (const message of [
      null,
      { type: 'sendMessage', text: 'model' },
      { type: 'reportingSave', format: 'exe' },
      { type: 'reportingSave', format: 'md', path: 'C:/unpicked/file.md' },
      { type: 'reportingOpen', id: '../foreign' },
    ]) {
      t.panel().webview.messages.fire(message)
    }
    expect(fakeWindow.showSaveDialog).not.toHaveBeenCalled()
    await t.act({ type: 'reportingOpen', id: 'foreign' })
    expect(t.reports.get).not.toHaveBeenCalled()
    expect(t.state().isError).toBe(true)
    t.reports.run.mockResolvedValueOnce({
      status: 'generated',
      document: { ...t.document, header: { ...t.document.header, scope: 'tampered' } },
    })
    await t.act({ type: 'reportingAction', action: 'refresh' })
    expect(t.state().header).toEqual(t.document.header)
    expect(t.state().isError).toBe(true)
  })

  it('lists scoped history, opens a saved report and refreshes without regenerating history', async () => {
    const t = setup()
    const older = finalizeReport({
      ...t.document,
      header: { ...t.document.header, asOf: '2026-10-05T12:00:00+00:00' },
    })
    expect(verifyReport(older).header.contentHash).toBe(t.document.header.contentHash)
    t.reports.history.mockResolvedValue({
      status: 'listed',
      entries: [{ id: 'older', header: older.header }],
    })
    t.reports.get.mockResolvedValue({ status: 'retrieved', document: older })
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    await t.act({ type: 'reportingAction', action: 'history' })
    expect(t.state().history?.[0]?.id).toBe('older')
    await t.act({ type: 'reportingOpen', id: 'older' })
    expect(t.reports.get).toHaveBeenCalledWith({
      workspaceKey: 'workspace-fixture',
      kind: 'project',
      id: 'older',
    })
    expect(t.reports.run).toHaveBeenCalledOnce()
    expect(t.state().header?.asOf).toBe(older.header.asOf)
    await t.act({ type: 'reportingAction', action: 'refresh' })
    expect(t.reports.run).toHaveBeenCalledTimes(2)
    expect(t.reports.run.mock.calls.at(-1)?.[0].options.asOf).toBe('2026-10-06T12:00:00Z')
  })

  it('compares the immediately older saved report and recognizes unchanged hashes', async () => {
    const t = setup()
    const older = finalizeReport({
      ...t.document,
      header: { ...t.document.header, asOf: '2026-10-05T12:00:00+00:00' },
    })
    t.reports.history.mockResolvedValue({
      status: 'listed',
      entries: [
        { id: 'older', header: older.header },
        { id: 'current', header: t.document.header },
      ],
    })
    t.reports.get.mockResolvedValue({ status: 'retrieved', document: older })
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    await t.act({ type: 'reportingAction', action: 'diff' })
    expect(t.state().status).toContain('No change since')
    expect(t.reports.compare).not.toHaveBeenCalled()
    const changed: ReportDocument = finalizeReport({ ...older, sections: [] })
    t.reports.history.mockResolvedValue({
      status: 'listed',
      entries: [
        { id: 'current', header: t.document.header },
        { id: 'older', header: changed.header },
      ],
    })
    t.reports.get.mockResolvedValue({ status: 'retrieved', document: changed })
    t.reports.compare.mockResolvedValue({
      status: 'compared',
      diff: {
        from: changed.header,
        to: t.document.header,
        sections: [
          {
            id: 'changes',
            label: 'changelog',
            added: t.document.needsYou.rows,
            removed: [],
            changed: [],
            unchangedRows: 0,
          },
        ],
      },
    })
    await t.act({ type: 'reportingAction', action: 'diff' })
    expect(t.reports.compare).toHaveBeenCalledWith({
      workspaceKey: 'workspace-fixture',
      kind: 'project',
      fromId: 'older',
      toId: 'current',
    })
    expect(t.state().diff?.from.contentHash).toBe(changed.header.contentHash)
    expect(t.state().diff?.sections[0]?.added).toEqual(t.document.needsYou.rows)
  })

  it('rejects saved metadata and comparison headers that disagree with the selected history', async () => {
    const t = setup()
    const older = finalizeReport({
      ...t.document,
      header: { ...t.document.header, asOf: '2026-10-05T12:00:00+00:00' },
      sections: [],
    })
    t.reports.history.mockResolvedValue({
      status: 'listed',
      entries: [
        { id: 'current', header: t.document.header },
        { id: 'older', header: older.header },
      ],
    })
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    await t.act({ type: 'reportingAction', action: 'history' })
    await t.act({ type: 'reportingOpen', id: 'older' })
    expect(t.state().isError).toBe(true)
    expect(t.state().header).toEqual(t.document.header)
    await t.act({ type: 'reportingAction', action: 'diff' })
    expect(t.reports.compare).not.toHaveBeenCalled()
    t.reports.get.mockResolvedValue({ status: 'retrieved', document: older })
    t.reports.compare.mockResolvedValue({
      status: 'compared',
      diff: { from: t.document.header, to: t.document.header, sections: [] },
    })
    await t.act({ type: 'reportingAction', action: 'diff' })
    expect(t.state().isError).toBe(true)
    expect(t.state().diff).toBeNull()
  })

  it('sorts saved history by instant, then id, and scrubs source text before display', async () => {
    const t = setup()
    t.reports.history.mockResolvedValue({
      status: 'listed',
      entries: [
        { id: 'z', header: { ...t.document.header, asOf: '2026-10-06T14:00:00+02:00' } },
        { id: 'early', header: { ...t.document.header, asOf: '2026-10-06T13:00:00+02:00' } },
        {
          id: 'a',
          header: {
            ...t.document.header,
            scope: 'owner@example.com',
            asOf: '2026-10-06T12:00:00Z',
          },
        },
      ],
    })
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    await t.act({ type: 'reportingAction', action: 'history' })
    expect(t.state().history?.map((entry) => entry.id)).toEqual(['a', 'z', 'early'])
    expect(JSON.stringify(t.state())).not.toContain('owner@example.com')
  })

  it('rejects a wrong report kind and discards generation completed after disposal', async () => {
    const t = setup()
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    t.reports.run.mockResolvedValueOnce({
      status: 'generated',
      document: finalizeReport({ ...t.document, header: { ...t.document.header, kind: 'usage' } }),
    })
    await t.act({ type: 'reportingAction', action: 'refresh' })
    expect(t.state().header?.kind).toBe('project')
    expect(t.state().isError).toBe(true)
    const pending = Promise.withResolvers<Awaited<ReturnType<ReportsHostPort['run']>>>()
    t.reports.run.mockReturnValueOnce(pending.promise)
    const generating = t.ui.open('usage')
    t.ui.dispose()
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    pending.resolve({
      status: 'generated',
      document: finalizeReport({ ...t.document, header: { ...t.document.header, kind: 'usage' } }),
    })
    await generating
    expect(t.state().header?.kind).toBe('project')
  })

  it('does not write or publish an old operation after its tab closes', async () => {
    const t = setup()
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    const chosen = Promise.withResolvers<ReturnType<typeof Uri.file> | undefined>()
    fakeWindow.showSaveDialog.mockReturnValueOnce(chosen.promise)
    t.panel().webview.messages.fire({ type: 'reportingSave', format: 'md' })
    const old = t.panel()
    t.ui.dispose()
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    chosen.resolve(Uri.file('C:/selected/old.md'))
    await Promise.resolve()
    await Promise.resolve()
    expect(workspace.fs.writeFile).not.toHaveBeenCalled()
    old.webview.messages.fire({ type: 'reportingAction', action: 'copy' })
    expect(env.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('serializes actions and reports clipboard/save failures using fixed localized messages', async () => {
    const t = setup()
    await t.ui.open('project')
    t.panel().webview.messages.fire({ type: 'reportingReady' })
    const copy = Promise.withResolvers<undefined>()
    env.clipboard.writeText.mockReturnValueOnce(copy.promise)
    t.panel().webview.messages.fire({ type: 'reportingAction', action: 'copy' })
    t.panel().webview.messages.fire({ type: 'reportingAction', action: 'attach' })
    expect(t.attachMarkdown).not.toHaveBeenCalled()
    copy.reject(new Error('private source failure'))
    await vi.waitFor(() => {
      expect(t.state().busy).toBe(false)
    })
    expect(t.state().status).toBe(EN.reportUi.copyFailed)
    expect(JSON.stringify(t.context.log.warn.mock.calls)).not.toContain('private source failure')
    fakeWindow.showSaveDialog.mockResolvedValueOnce(Uri.file('C:/picked/report.md'))
    workspace.fs.writeFile.mockRejectedValueOnce(new Error('private file path'))
    await t.act({ type: 'reportingSave', format: 'md' })
    expect(t.state().status).toBe(EN.reportUi.saveFailed)
  })

  it('lists every report kind with its last report and keeps the problem-report action distinct', async () => {
    const t = setup()
    await t.ui.open()
    expect(t.reports.history).toHaveBeenCalledTimes(15)
    expect(fakeWindow.showQuickPick.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: EN.reportKinds.project }),
        expect.objectContaining({ label: EN.reportUi.problem, argumentsText: 'problem' }),
      ]),
    )
    await t.ui.open('problem')
    expect(t.openProblem).toHaveBeenCalledOnce()
    expect(t.reports.run).not.toHaveBeenCalled()
  })

  it('retries missing lazy bundles and accepts only factories from the packaged contract', () => {
    const t = setup()
    const loadBundle = vi
      .fn<() => unknown>()
      .mockReturnValueOnce({ wrong: true })
      .mockReturnValueOnce({ createReportingEngine: () => t.engine })
    const load = reportEngineLoader({
      bundlePath: 'C:/extension/dist/reporting.js',
      log: t.context.log,
      loadBundle,
    })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(load).toThrow(EN.reportUi.generationFailed)
    expect(load().createReportingEngine).toBeTypeOf('function')
    load()
    expect(loadBundle).toHaveBeenCalledTimes(2)
    const panelLoad = reportPanelLoader({
      bundlePath: 'C:/extension/dist/reportingPanel.js',
      log: t.context.log,
      loadBundle: () => ({ createReportPanel: () => t.ui }),
    })
    expect(panelLoad).toThrow(EN.reportUi.generationFailed)
  })
})
